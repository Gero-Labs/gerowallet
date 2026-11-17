// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { ShieldedAddress, ShieldedCoinPublicKey, ShieldedEncryptionPublicKey } from 'midnight-v9-address-format';
import { Subject } from 'rxjs';
import type { ShieldedWalletState } from 'midnight-v9-shielded';
import type { MidnightPrivateSyncArgs } from './midnightPrivateSync';

// The private sync used to replay the whole shielded history on every start
// (every unlock and worker restart). It now resumes from its own checkpoint: a
// state and the history saved with it, written only once the state has settled
// past the SDK's background history lookups.
const h = vi.hoisted(() => ({
  factory: vi.fn(), forking: vi.fn(), identity: vi.fn(), publish: vi.fn(), status: vi.fn(),
  save: vi.fn(), load: vi.fn(), saveCheckpoint: vi.fn(), clear: vi.fn(),
  history: vi.fn(), serializeHistory: vi.fn(), restoreHistory: vi.fn(), keysByEpoch: vi.fn(),
  realKeysByEpoch: undefined as unknown as (seed: Uint8Array) => Promise<unknown>,
  store: { activeWalletKey: 'mn_addr_preprod1owner', privateSyncStatus: 'idle', addresses: { shielded: '' },
    chainIdentity: { network: 'midnight-preprod', generation: 1, genesisHash: `0x${'ab'.repeat(32)}` } },
  wallet: { loggedWallet: { id: 7, network: 'Preprod', chain: 'Midnight' }, isLocked: false },
}));
/** A history as the SDK's storage looks to the sync: read, serialized, and written by `gotFinalized`. */
function makeHistory() {
  return { getAll: () => h.history(), serialize: () => h.serializeHistory(), gotFinalized: vi.fn(async () => {}) };
}
vi.mock('midnight-v9-shielded', () => ({ CustomShieldedWallet: h.factory, ShieldedWallet: h.forking }));
vi.mock('midnight-v9-abstractions', () => ({
  InMemoryTransactionHistoryStorage: class {
    static restore(...input: unknown[]) { return h.restoreHistory(...input); }
    getAll() { return h.history(); }
    serialize() { return h.serializeHistory(); }
    async gotFinalized() { /* recorded */ }
  },
}));
vi.mock('./midnightShieldedWallet9', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./midnightShieldedWallet9')>();
  h.realKeysByEpoch = actual.shieldedKeysByEpoch;
  return { ...actual, shieldedKeysByEpoch: (seed: Uint8Array) => h.keysByEpoch(seed) };
});
vi.mock('@/stores/midnightStore', () => ({ midnightStore: h.store,
  midnightActions: { applyPrivateSnapshot: h.publish, setPrivateSyncStatus: h.status } }));
vi.mock('@/stores/walletStore', () => ({ walletStore: h.wallet }));
vi.mock('./midnightChainIdentity', () => ({ readVerifiedMidnightChainIdentity: h.identity,
  midnightCheckpointNamespace: (identity: { chain_generation: number }) => `verified-${identity.chain_generation}` }));
vi.mock('./midnightWalletStatePersistence', () => ({
  saveWalletState: h.save, loadPrivateSyncCheckpoint: h.load,
  savePrivateSyncCheckpoint: h.saveCheckpoint, clearPrivateSyncCheckpoint: h.clear,
}));

import { replayMidnightPrivateSyncCold, startMidnightPrivateSync, stopMidnightPrivateSync } from './midnightPrivateSync';

const seed = new Uint8Array(32).fill(3);
const token = 'aa'.repeat(32);
const identity = { network: 'midnight-preprod', chain_generation: 1, genesis_hash: `0x${'ab'.repeat(32)}` };
const checkpoint = { state: 'saved-state', history: 'saved-history' };
let publicKey: string; let encryptionKey: string;
let events: Subject<ShieldedWalletState>;
let wallet: { state: Subject<ShieldedWalletState>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
let cold: ReturnType<typeof vi.fn>; let restore: ReturnType<typeof vi.fn>;
let restoredHistory: ReturnType<typeof makeHistory>;

function args(forking = false): MidnightPrivateSyncArgs {
  return { walletId: '7', network: 'Preprod', seed: seed.slice(), forking, endpoints: {
    sdkNetworkId: 'preprod', publicIndexerUrl: 'https://indexer.invalid', publicIndexerWsUrl: 'wss://indexer.invalid',
  } as MidnightPrivateSyncArgs['endpoints'] };
}
function state(serialized = 'public-sdk-state', coinPublicKey = publicKey): ShieldedWalletState {
  return { progress: { isStrictlyComplete: () => true },
    coinPublicKey: { toHexString: () => coinPublicKey }, encryptionPublicKey: { toHexString: () => encryptionKey },
    balances: { [token]: 12n }, serialize: () => serialized,
  } as unknown as ShieldedWalletState;
}
/** The `txHistoryStorage` the n-th builder was made with. */
const builderHistory = (mock: ReturnType<typeof vi.fn>, call = 0) =>
  (mock.mock.calls[call] as [{ txHistoryStorage: { gotFinalized(input: unknown): Promise<void> } }])[0].txHistoryStorage;
/** Advance to `ms` after the start (the sync's cycles run every 30 s from it). */
let startedAt = 0;
const advanceTo = async (ms: number) => { await vi.advanceTimersByTimeAsync(startedAt + ms - Date.now()); };
async function startCold(forking = false) {
  h.load.mockResolvedValue(null);
  startedAt = Date.now();
  await startMidnightPrivateSync(args(forking));
}

describe('private sync resumes from its checkpoint', () => {
  let debug: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers();
    debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const keys = ledger.ZswapSecretKeys.fromSeed(seed);
    publicKey = keys.coinPublicKey; encryptionKey = keys.encryptionPublicKey;
    h.store.addresses.shielded = ShieldedAddress.codec.encode('preprod', new ShieldedAddress(
      ShieldedCoinPublicKey.fromHexString(publicKey), ShieldedEncryptionPublicKey.fromHexString(encryptionKey))).toString();
    keys.clear();
    h.wallet.isLocked = false;
    h.store.chainIdentity = { network: identity.network, generation: 1, genesisHash: identity.genesis_hash };
    h.store.privateSyncStatus = 'idle';
    events = new Subject();
    wallet = { state: events, start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
    cold = vi.fn(() => wallet); restore = vi.fn(() => wallet);
    h.factory.mockReturnValue({ startWithSecretKeys: cold, restore });
    h.forking.mockReturnValue({ startWithKeys: vi.fn(async () => wallet), restore });
    h.keysByEpoch.mockImplementation((s: Uint8Array) => h.realKeysByEpoch(s));
    h.identity.mockResolvedValue(identity);
    h.history.mockResolvedValue([]); h.serializeHistory.mockResolvedValue('serialized-history');
    restoredHistory = makeHistory();
    h.restoreHistory.mockReturnValue(restoredHistory);
    h.load.mockResolvedValue(checkpoint);
    h.save.mockResolvedValue(undefined); h.saveCheckpoint.mockResolvedValue(undefined); h.clear.mockResolvedValue(undefined);
    h.status.mockImplementation(status => { h.store.privateSyncStatus = status; });
    h.publish.mockImplementation(() => { h.store.privateSyncStatus = 'synced'; });
  });
  afterEach(async () => { await stopMidnightPrivateSync(); vi.useRealTimers(); debug.mockRestore(); });

  describe('resuming', () => {
    it('resumes the saved state with its saved history instead of replaying from the first block', async () => {
      await startMidnightPrivateSync(args());
      expect(h.load).toHaveBeenCalledWith('verified-1', seed);
      expect(h.restoreHistory).toHaveBeenCalledWith('saved-history', expect.anything());
      expect(restore).toHaveBeenCalledWith('saved-state');
      expect(cold).not.toHaveBeenCalled();
      expect(builderHistory(h.factory)).toBe(restoredHistory);
      expect(wallet.start).toHaveBeenCalledOnce();
      events.next(state()); await vi.advanceTimersByTimeAsync(1001);
      expect(h.publish).toHaveBeenCalledWith({ [token]: 12n }, []);
      expect(debug).toHaveBeenCalledWith('[midnight-timing] private sync', expect.objectContaining({ outcome: 'ok', warm: true }));
    });

    it('a fork-aware wallet resumes into the variant that wrote it, started with both ledgers\' keys', async () => {
      const startWithKeys = vi.fn();
      h.forking.mockReturnValue({ startWithKeys, restore });
      await startMidnightPrivateSync(args(true));
      expect(restore).toHaveBeenCalledWith('saved-state');
      expect(startWithKeys).not.toHaveBeenCalled();
      expect(builderHistory(h.forking)).toBe(restoredHistory);
      const keys = (wallet.start.mock.calls[0] as [{ v8: { coinPublicKey: string }; v9: { coinPublicKey: string } }])[0];
      expect(keys.v8.coinPublicKey).toBe(publicKey);
      expect(keys.v9.coinPublicKey).toBe(publicKey);
    });

    it('with no checkpoint, replays cold and says so in the timing line', async () => {
      await startCold();
      expect(cold).toHaveBeenCalledOnce();
      expect(restore).not.toHaveBeenCalled();
      expect(builderHistory(h.factory)).not.toBe(restoredHistory);
      events.next(state()); await vi.advanceTimersByTimeAsync(1001);
      expect(debug).toHaveBeenCalledWith('[midnight-timing] private sync', expect.objectContaining({ warm: false }));
    });

    it('a history the SDK cannot read means a cold replay, and only the private sync\'s row is dropped', async () => {
      h.restoreHistory.mockImplementation(() => { throw new Error('unknown history format'); });
      await startMidnightPrivateSync(args());
      expect(restore).not.toHaveBeenCalled();
      expect(cold).toHaveBeenCalledOnce();
      expect(h.clear).toHaveBeenCalledWith('verified-1', seed);
      // The send path's `shielded` row is the persistence module's own business; nothing here deletes it.
      expect(h.save).not.toHaveBeenCalled();
    });

    it('a state the SDK cannot read means a cold replay with a fresh history, and the row is dropped', async () => {
      restore.mockImplementation(() => { throw new Error('unsupported snapshot version'); });
      await startMidnightPrivateSync(args());
      expect(cold).toHaveBeenCalledOnce();
      expect(h.clear).toHaveBeenCalledWith('verified-1', seed);
      expect(builderHistory(h.factory, 1)).not.toBe(restoredHistory);
    });

    it('a resumed state of another key is dropped and never published; the next start replays cold', async () => {
      await startMidnightPrivateSync(args());
      events.next(state('x', 'ff'.repeat(32))); await vi.advanceTimersByTimeAsync(1001);
      expect(h.publish).not.toHaveBeenCalled();
      expect(h.clear).toHaveBeenCalledWith('verified-1', seed);
      expect(h.store.privateSyncStatus).toBe('error');
      expect(wallet.stop).toHaveBeenCalledOnce();
      h.load.mockResolvedValue(null);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(cold).toHaveBeenCalledOnce();
    });

    it('a checkpoint read that stalls costs 10 s, then the sync replays cold', async () => {
      h.load.mockReturnValue(new Promise(() => {}));
      const starting = startMidnightPrivateSync(args());
      await vi.advanceTimersByTimeAsync(9_999);
      expect(cold).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      await starting;
      expect(cold).toHaveBeenCalledOnce();
      expect(restore).not.toHaveBeenCalled();
    });
  });

  describe('saving only settled states', () => {
    it('keeps saving the newest state to the send path\'s row every cycle, as before', async () => {
      await startCold();
      events.next(state('s1')); await vi.advanceTimersByTimeAsync(1001);
      expect(h.save).toHaveBeenCalledWith('verified-1', 'shielded', seed, 's1');
    });

    it('checkpoints a state only once it is 150 s old, with the history read at save time', async () => {
      await startCold();
      events.next(state('s1')); await vi.advanceTimersByTimeAsync(1001);
      events.next(state('s2'));
      await advanceTo(179_000);
      expect(h.saveCheckpoint).not.toHaveBeenCalled();
      await advanceTo(181_000);
      expect(h.saveCheckpoint).toHaveBeenCalledOnce();
      expect(h.saveCheckpoint).toHaveBeenCalledWith('verified-1', seed, { state: 's1', history: 'serialized-history' });
    });

    it('waits until the SDK has not written the history for 150 s (lookups still landing)', async () => {
      await startCold();
      events.next(state('s1')); await vi.advanceTimersByTimeAsync(1001);
      await advanceTo(120_000);
      await builderHistory(h.factory).gotFinalized({});
      await advanceTo(269_000);
      expect(h.saveCheckpoint).not.toHaveBeenCalled();
      await advanceTo(271_000);
      expect(h.saveCheckpoint).toHaveBeenCalledWith('verified-1', seed, { state: 's1', history: 'serialized-history' });
    });

    it('does not write the same state twice', async () => {
      await startCold();
      events.next(state('s1')); await vi.advanceTimersByTimeAsync(1001);
      await advanceTo(900_000);
      expect(h.saveCheckpoint).toHaveBeenCalledOnce();
    });

    it('a failed checkpoint write does not fail the sync', async () => {
      h.saveCheckpoint.mockRejectedValue(new Error('quota'));
      await startCold();
      events.next(state('s1')); await vi.advanceTimersByTimeAsync(1001);
      events.next(state('s2'));
      await advanceTo(181_000);
      expect(h.saveCheckpoint).toHaveBeenCalled();
      expect(h.store.privateSyncStatus).toBe('synced');
      expect(wallet.stop).not.toHaveBeenCalled();
    });
  });

  describe('a stop or a lock mid-way', () => {
    it('a lock while the checkpoint loads starts nothing', async () => {
      let release!: (value: unknown) => void;
      h.load.mockReturnValue(new Promise(resolve => { release = resolve; }));
      const starting = startMidnightPrivateSync(args());
      await vi.advanceTimersByTimeAsync(1);
      h.wallet.isLocked = true;
      release(checkpoint); await starting;
      expect(restore).not.toHaveBeenCalled();
      expect(cold).not.toHaveBeenCalled();
    });

    it('a stop while the ledger 8 keys load starts nothing and clears both keys', async () => {
      let release!: (keys: unknown) => void;
      h.keysByEpoch.mockReturnValue(new Promise(resolve => { release = resolve; }));
      const keys = { v8: { clear: vi.fn() }, v9: { clear: vi.fn() } };
      const starting = startMidnightPrivateSync(args(true));
      await vi.advanceTimersByTimeAsync(1);
      expect(h.keysByEpoch).toHaveBeenCalledOnce();
      const stopping = stopMidnightPrivateSync();
      release(keys); await starting; await stopping;
      expect(restore).not.toHaveBeenCalled();
      expect(wallet.start).not.toHaveBeenCalled();
      expect(keys.v8.clear).toHaveBeenCalled();
      expect(keys.v9.clear).toHaveBeenCalled();
      expect(h.store.privateSyncStatus).toBe('idle');
    });

    it('a stop while the checkpoint is being saved writes nothing (the seed is already zeroed)', async () => {
      await startCold();
      events.next(state('s1')); await vi.advanceTimersByTimeAsync(1001);
      events.next(state('s2'));
      let release!: (history: string) => void;
      h.serializeHistory.mockReturnValue(new Promise(resolve => { release = resolve; }));
      await advanceTo(181_000);
      expect(h.serializeHistory).toHaveBeenCalled();
      await stopMidnightPrivateSync();
      release('late-history'); await vi.advanceTimersByTimeAsync(1);
      expect(h.saveCheckpoint).not.toHaveBeenCalled();
    });
  });

  describe('forced re-sync', () => {
    it('drops the checkpoint and the running wallet, and replays from the first block without reading it', async () => {
      await startMidnightPrivateSync(args());
      expect(restore).toHaveBeenCalledOnce();
      await replayMidnightPrivateSyncCold();
      expect(wallet.stop).toHaveBeenCalledOnce();
      expect(h.clear).toHaveBeenCalledWith('verified-1', seed);
      expect(h.load).toHaveBeenCalledOnce();
      expect(cold).toHaveBeenCalledOnce();
    });

    it('a re-sync during a running start replays once that start ends', async () => {
      let release!: () => void;
      wallet.start.mockReturnValueOnce(new Promise<void>(resolve => { release = resolve; }));
      const starting = startMidnightPrivateSync(args());
      await vi.advanceTimersByTimeAsync(1);
      await replayMidnightPrivateSyncCold();
      expect(cold).not.toHaveBeenCalled();
      release(); await starting; await vi.advanceTimersByTimeAsync(1);
      expect(wallet.stop).toHaveBeenCalledOnce();
      expect(cold).toHaveBeenCalledOnce();
      expect(h.load).toHaveBeenCalledOnce();
    });
  });
});
