import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';

const setTransactions = vi.fn();
vi.mock('@/stores/walletStore', () => ({ default: { setTransactions: (...args: unknown[]) => setTransactions(...args) } }));
vi.mock('@/utils/debug', () => ({ debugLog: () => undefined }));

// The real loading store: under vitest it is neither the background nor a
// browser context, so its setters only mutate `loadingState`.
import LoadingState, { loadingState } from '@/stores/loading';
import { TransactionsLoader } from './walletLoader';

let sequence = 0;
let db: Dexie;
let loader: TransactionsLoader;

/**
 * fake-indexeddb answers a read within one macrotask, which would hide the
 * ordering under test. The loader's reads wait on this gate; a test closes it
 * to hold a read in flight.
 */
let gate: Promise<void> = Promise.resolve();
let openGate: () => void = () => undefined;
function closeGate() {
  gate = new Promise(resolve => { openGate = resolve; });
}

/**
 * Each pass ends by awaiting setUtxosAndAddresses. A test that fills
 * `holdPasses` parks each pass there until it resolves that pass by hand.
 */
let holdPasses = false;
const parkedPasses: Array<() => void> = [];

const tx = (hash: string) => ({ tx_hash: hash, tx_timestamp: 1, utxo: { inputs: [], outputs: [] } });

async function until(condition: () => boolean, what: string) {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe('TransactionsLoader: loadingTxs covers the whole pass, from the read', () => {
  beforeEach(async () => {
    setTransactions.mockReset();
    holdPasses = false;
    parkedPasses.length = 0;
    loadingState.loadingTxs = false;
    loadingState.syncPending = false;
    db = new Dexie(`transactions-loader-spec-${++sequence}`);
    db.version(1).stores({ transactions: 'tx_hash' });
    gate = Promise.resolve();
    await db.open();
    // The loader's read is issued at once (so Dexie observes it) but its result
    // is held at the gate.
    const gatedDb = {
      table: (name: string) => ({
        toArray: () => {
          const rows = db.table(name).toArray();
          return gate.then(() => rows);
        },
      }),
    } as unknown as Dexie;
    loader = new TransactionsLoader(async () => gatedDb, {
      baseAddress: '',
      stakeAddress: '',
      chain: 'Cardano',
      network: 'Mainnet',
      isEnterpriseAddress: () => false,
      networkId: () => 1,
      setUtxosAndAddresses: () =>
        holdPasses ? new Promise<void>(resolve => { parkedPasses.push(resolve); }) : Promise.resolve(),
    });
    await loader.load();
    await until(() => !loadingState.loadingTxs, 'the initial pass');
  });

  afterEach(async () => {
    loader.unsubscribe();
    await db.delete();
  });

  it('is already raised one macrotask after a commit, before the read returns', async () => {
    // websocket.service releases syncPending one macrotask after the sync
    // handler's commit. Raised on emission, loadingTxs was still false then, so
    // the release beat the rows into the store.
    closeGate();
    await db.table('transactions').put(tx('t1'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(loadingState.loadingTxs).toBe(true);
    expect(setTransactions).not.toHaveBeenCalledWith([expect.objectContaining({ tx_hash: 't1' })]);
    openGate();
    await until(() => !loadingState.loadingTxs, 'the pass to finish');
    expect(setTransactions).toHaveBeenLastCalledWith([expect.objectContaining({ tx_hash: 't1' })]);
  });

  it('holds a syncPending release until the committed row is in the store', async () => {
    const token = LoadingState.setSyncPending(true);
    closeGate();
    await db.table('transactions').put(tx('t1'));
    // What clearSyncPendingWhenApplied does once onSync has resolved.
    setTimeout(() => LoadingState.setSyncPending(false, token), 0);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(loadingState.syncPending).toBe(true);
    openGate();

    let rowsWhenReleased: unknown = null;
    await until(() => {
      if (!loadingState.syncPending && rowsWhenReleased === null) {
        rowsWhenReleased = setTransactions.mock.calls.at(-1)?.[0] ?? [];
      }
      return !loadingState.syncPending;
    }, 'the release');
    expect(rowsWhenReleased).toEqual([expect.objectContaining({ tx_hash: 't1' })]);
  });

  it('is not dropped by an older pass that finishes while a newer read is in flight', async () => {
    // Dexie does not wait for an async subscriber: a second commit starts a new
    // read while the first pass is still running. The first pass finishing must
    // not announce rows only the second pass will put in the store.
    holdPasses = true;
    await db.table('transactions').put(tx('t1'));
    await until(() => parkedPasses.length === 1, 'the first pass to park');
    await db.table('transactions').put(tx('t2'));
    await until(() => parkedPasses.length === 2, 'the second pass to park');

    parkedPasses[0]();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(loadingState.loadingTxs).toBe(true);

    parkedPasses[1]();
    await until(() => !loadingState.loadingTxs, 'the second pass to finish');
    expect(setTransactions).toHaveBeenLastCalledWith([
      expect.objectContaining({ tx_hash: 't1' }),
      expect.objectContaining({ tx_hash: 't2' }),
    ]);
  });

  it('is dropped on unsubscribe, so an abandoned read cannot leave it raised', async () => {
    closeGate();
    await db.table('transactions').put(tx('t1'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(loadingState.loadingTxs).toBe(true);
    loader.unsubscribe();
    expect(loadingState.loadingTxs).toBe(false);
    openGate();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(loadingState.loadingTxs).toBe(false);
  });
});
