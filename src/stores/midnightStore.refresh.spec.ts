// Issue 1471: after a chain reset, the views show the last balances and history
// the wallet knew ("Refreshing"), never the rebuild's zero or empty state, and
// swap to the rebuilt state in one step.
//
// The background half (resetChainState keeps a snapshot) runs on this module's
// store; the browser half is receiveMidnightBroadcast, fed the same fields the
// background broadcasts, serialized as the port serializes them.
import { beforeEach, describe, expect, it } from 'vitest';
import { midnightActions, midnightStore, receiveMidnightBroadcast, resetMidnightBroadcastForTests } from './midnightStore';
import type { MidnightStore } from './midnightStore';
import type { MidnightBalances, MidnightTransaction } from '@/chains/midnight/midnightTypes';

const IDENTITY = { network: 'midnight-preprod', generation: 2, genesisHash: `0x${'ab'.repeat(32)}` };
const EMPTY: MidnightBalances = { shieldedTokens: {}, nightShielded: 0n, nightUnshielded: 0n, nightRegistered: 0n, dust: 0n, dustGenerating: 0n };
const row = (hash: string, amount: bigint, timestamp: number): MidnightTransaction => ({
  hash, type: 'receive', token: 'NIGHT', amount, counterparty: '', timestamp, status: 'confirmed', fee: 0n, isShielded: false,
});
const OLD_TX = row('aa'.repeat(32), 5_000_000n, 1_000);
const FUNDED: MidnightBalances = { ...EMPTY, nightUnshielded: 5_000_000n, dust: 7n };

/** What the port carries: BigInts as strings, as broadcastFromBackground serializes them. */
const wire = (updates: Partial<MidnightStore>) =>
  JSON.parse(JSON.stringify(updates, (_k, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Map ? [...v.entries()] : v))) as Partial<MidnightStore>;

function onScreen(balances: MidnightBalances, transactions: MidnightTransaction[]) {
  Object.assign(midnightStore, { balances: { ...balances }, transactions: [...transactions], dustState: null, refreshSnapshot: null, refreshing: null });
}

/** Run resetChainState as the background would, and return the broadcast it sends. */
function resetBroadcast(): Partial<MidnightStore> {
  midnightActions.resetChainState(IDENTITY, { reason: 'upgrade' });
  const { refreshSnapshot, refreshing, balances, transactions, utxos, dustState, networkStatus } = midnightStore;
  return wire({ refreshSnapshot, refreshing, balances, transactions, utxos, dustState, networkStatus });
}

beforeEach(() => {
  resetMidnightBroadcastForTests();
  onScreen(EMPTY, []);
  midnightStore.tip = { hash: 'h', height: 1_234_567, timestamp: 1_700_000_000_000 };
});

describe('resetChainState on a funded wallet', () => {
  it('keeps what was on screen, with the block it is from', () => {
    onScreen(FUNDED, [OLD_TX]);
    midnightActions.resetChainState(IDENTITY, { reason: 'upgrade' });
    expect(midnightStore.balances.nightUnshielded).toBe(0n);
    expect(midnightStore.refreshSnapshot?.balances.nightUnshielded).toBe(5_000_000n);
    expect(midnightStore.refreshSnapshot?.transactions).toHaveLength(1);
    expect(midnightStore.refreshSnapshot?.tip.height).toBe(1_234_567);
    expect(midnightStore.refreshing).toMatchObject({ reason: 'upgrade', stalled: false, progress: null });
  });

  it('a second reset during the rebuild keeps the first snapshot, not the partial state', () => {
    onScreen(FUNDED, [OLD_TX]);
    midnightActions.resetChainState(IDENTITY);
    midnightStore.balances = { ...EMPTY, nightUnshielded: 1n };
    midnightActions.resetChainState({ ...IDENTITY, generation: 3 });
    expect(midnightStore.refreshSnapshot?.balances.nightUnshielded).toBe(5_000_000n);
  });

  it('a wallet with nothing on screen gets no snapshot: its empty state is the real one', () => {
    midnightActions.resetChainState(IDENTITY);
    expect(midnightStore.refreshSnapshot).toBeNull();
    expect(midnightStore.refreshing).toBeNull();
  });
});

describe('what a view renders through the rebuild', () => {
  it('resetChainState followed by partial sync messages never renders a zero balance or an empty history', () => {
    onScreen(FUNDED, [OLD_TX]);
    const reset = resetBroadcast();

    // The view, still showing the funded wallet, receives the reset.
    onScreen(FUNDED, [OLD_TX]);
    receiveMidnightBroadcast(reset);
    const seen: bigint[] = [midnightStore.balances.nightUnshielded];
    const rows: number[] = [midnightStore.transactions.length];

    // Partial rebuild: an empty UTxO snapshot, a small first receive, history one row at a time.
    for (const partial of [
      { balances: { ...EMPTY } },
      { transactions: [], utxos: [] },
      { balances: { ...EMPTY, nightUnshielded: 1_000_000n } },
      { transactions: [row('bb'.repeat(32), 1_000_000n, 500)] },
      { dustState: null },
    ] as Array<Partial<MidnightStore>>) {
      receiveMidnightBroadcast(wire(partial));
      seen.push(midnightStore.balances.nightUnshielded);
      rows.push(midnightStore.transactions.length);
    }
    expect(seen.every((v) => v === 5_000_000n)).toBe(true);
    expect(rows.every((n) => n === 1)).toBe(true);
    expect(midnightStore.refreshing?.reason).toBe('upgrade');
  });

  it('swaps in the rebuilt state in one step when the refresh ends', () => {
    onScreen(FUNDED, [OLD_TX]);
    const reset = resetBroadcast();
    onScreen(FUNDED, [OLD_TX]);
    receiveMidnightBroadcast(reset);
    receiveMidnightBroadcast(wire({ balances: { ...EMPTY, nightUnshielded: 1_000_000n } }));

    const rebuilt = [row('cc'.repeat(32), 2_000_000n, 2_000), OLD_TX];
    receiveMidnightBroadcast(wire({
      refreshSnapshot: null, refreshing: null, balances: { ...EMPTY, nightUnshielded: 7_000_000n }, transactions: rebuilt, dustState: null,
    }));
    expect(midnightStore.refreshing).toBeNull();
    expect(midnightStore.balances.nightUnshielded).toBe(7_000_000n);
    expect(midnightStore.transactions.map((t) => t.hash)).toEqual(rebuilt.map((t) => t.hash));
  });

  it('an end message without the values applies the newest ones that arrived meanwhile', () => {
    onScreen(FUNDED, [OLD_TX]);
    const reset = resetBroadcast();
    onScreen(FUNDED, [OLD_TX]);
    receiveMidnightBroadcast(reset);
    receiveMidnightBroadcast(wire({ balances: { ...EMPTY, nightUnshielded: 6_000_000n } }));
    receiveMidnightBroadcast(wire({ refreshSnapshot: null, refreshing: null }));
    expect(midnightStore.balances.nightUnshielded).toBe(6_000_000n);
  });

  it('a wallet that really is empty shows its empty state once the rebuild ends', () => {
    onScreen(FUNDED, [OLD_TX]);
    const reset = resetBroadcast();
    onScreen(FUNDED, [OLD_TX]);
    receiveMidnightBroadcast(reset);
    receiveMidnightBroadcast(wire({ refreshSnapshot: null, refreshing: null, balances: { ...EMPTY }, transactions: [], dustState: null }));
    expect(midnightStore.balances.nightUnshielded).toBe(0n);
    expect(midnightStore.transactions).toEqual([]);
  });
});

describe('custom tokens and private figures', () => {
  const USDM = 'ab'.repeat(32);
  const utxo = (value: bigint) => ({
    owner: 'me', tokenType: USDM, value, intentHash: 'i', outputIndex: 0, initialNonce: 'n', registeredForDustGeneration: false,
  });

  it('keeps the UTxOs on screen too, so tokens such as USDM never vanish mid-rebuild', () => {
    onScreen(FUNDED, [OLD_TX]);
    midnightStore.utxos = [utxo(9n)];
    const reset = wire({ ...(midnightActions.resetChainState(IDENTITY), {}), refreshSnapshot: midnightStore.refreshSnapshot,
      refreshing: midnightStore.refreshing, utxos: midnightStore.utxos, balances: midnightStore.balances });
    expect(midnightStore.refreshSnapshot?.utxos).toHaveLength(1);
    onScreen(FUNDED, [OLD_TX]);
    midnightStore.utxos = [utxo(9n)];
    receiveMidnightBroadcast(reset);
    receiveMidnightBroadcast(wire({ utxos: [] }));
    expect(midnightStore.utxos.map((u) => u.value)).toEqual([9n]);
  });

  it('a shielded-only wallet keeps its private figures past the rebuild until the scan says synced', () => {
    const shielded = { ...EMPTY, nightShielded: 4_000_000n };
    const privateRow = row('dd'.repeat(32), 4_000_000n, 900);
    privateRow.isShielded = true;
    onScreen(shielded, [privateRow]);
    midnightActions.resetChainState(IDENTITY);
    midnightStore.privateSyncStatus = 'idle';
    midnightActions.endRefresh();
    expect(midnightStore.balances.nightShielded).toBe(4_000_000n);
    expect(midnightStore.transactions.map((t) => t.hash)).toEqual([privateRow.hash]);

    onScreen(shielded, [privateRow]);
    midnightActions.resetChainState(IDENTITY);
    midnightStore.privateSyncStatus = 'synced';
    midnightActions.endRefresh();
    expect(midnightStore.balances.nightShielded).toBe(0n);
  });
});

describe('the background actions', () => {
  it('endRefresh drops the snapshot; a stall and progress are status only', () => {
    onScreen(FUNDED, [OLD_TX]);
    midnightActions.resetChainState(IDENTITY);
    midnightActions.setRefreshStatus({ stalled: true, progress: 40 });
    expect(midnightStore.refreshing).toMatchObject({ stalled: true, progress: 40 });
    midnightActions.endRefresh();
    expect(midnightStore.refreshSnapshot).toBeNull();
    expect(midnightStore.refreshing).toBeNull();
    midnightActions.setRefreshStatus({ stalled: true });
    expect(midnightStore.refreshing).toBeNull();
  });

  it('a wallet switch drops a refresh that belonged to the previous wallet', () => {
    midnightActions.setActive({ unshielded: 'mn_addr_preprod1aaaa', shielded: '', dust: '' });
    onScreen(FUNDED, [OLD_TX]);
    midnightActions.resetChainState(IDENTITY);
    midnightActions.setActive({ unshielded: 'mn_addr_preprod1zzzz', shielded: '', dust: '' });
    expect(midnightStore.refreshSnapshot).toBeNull();
    expect(midnightStore.refreshing).toBeNull();
  });
});
