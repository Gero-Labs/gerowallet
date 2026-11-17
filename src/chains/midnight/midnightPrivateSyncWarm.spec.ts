// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { ShieldedAddress, ShieldedCoinPublicKey, ShieldedEncryptionPublicKey } from 'midnight-v9-address-format';
import { Subject } from 'rxjs';
import type { ShieldedWalletState } from 'midnight-v9-shielded';
import type { MidnightPrivateSyncArgs } from './midnightPrivateSync';

// The private sync used to replay the whole shielded history on every start
// (every unlock and worker restart), although it saved a checkpoint every
// cycle. It now resumes from that checkpoint and the history saved with it.
const h = vi.hoisted(() => ({
  factory: vi.fn(), forking: vi.fn(), identity: vi.fn(), publish: vi.fn(), status: vi.fn(),
  save: vi.fn(), load: vi.fn(), saveHistory: vi.fn(), clear: vi.fn(),
  history: vi.fn(), serializeHistory: vi.fn(), restoreHistory: vi.fn(),
  store: { activeWalletKey: 'mn_addr_preprod1owner', privateSyncStatus: 'idle', addresses: { shielded: '' },
    chainIdentity: { network: 'midnight-preprod', generation: 1, genesisHash: `0x${'ab'.repeat(32)}` } },
  wallet: { loggedWallet: { id: 7, network: 'Preprod', chain: 'Midnight' }, isLocked: false },
}));
vi.mock('midnight-v9-shielded', () => ({ CustomShieldedWallet: h.factory, ShieldedWallet: h.forking }));
vi.mock('midnight-v9-abstractions', () => ({
  InMemoryTransactionHistoryStorage: class {
    static restore(...input: unknown[]) { return h.restoreHistory(...input); }
    getAll() { return h.history(); }
    serialize() { return h.serializeHistory(); }
  },
}));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: h.store,
  midnightActions: { applyPrivateSnapshot: h.publish, setPrivateSyncStatus: h.status } }));
vi.mock('@/stores/walletStore', () => ({ walletStore: h.wallet }));
vi.mock('./midnightChainIdentity', () => ({ readVerifiedMidnightChainIdentity: h.identity,
  midnightCheckpointNamespace: (identity: { chain_generation: number }) => `verified-${identity.chain_generation}` }));
vi.mock('./midnightWalletStatePersistence', () => ({
  saveWalletState: h.save, loadPrivateSyncCheckpoint: h.load,
  savePrivateHistoryCheckpoint: h.saveHistory, clearPrivateSyncCheckpoint: h.clear,
}));

import { startMidnightPrivateSync, stopMidnightPrivateSync } from './midnightPrivateSync';

const seed = new Uint8Array(32).fill(3);
const token = 'aa'.repeat(32);
const identity = { network: 'midnight-preprod', chain_generation: 1, genesis_hash: `0x${'ab'.repeat(32)}` };
const checkpoint = { state: 'saved-state', history: 'saved-history' };
let publicKey: string; let encryptionKey: string;
let events: Subject<ShieldedWalletState>;
let wallet: { state: Subject<ShieldedWalletState>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
let cold: ReturnType<typeof vi.fn>; let restore: ReturnType<typeof vi.fn>;
const restoredHistory = { getAll: () => h.history(), serialize: () => h.serializeHistory() };

function args(forking = false): MidnightPrivateSyncArgs {
  return { walletId: '7', network: 'Preprod', seed: seed.slice(), forking, endpoints: {
    sdkNetworkId: 'preprod', publicIndexerUrl: 'https://indexer.invalid', publicIndexerWsUrl: 'wss://indexer.invalid',
  } as MidnightPrivateSyncArgs['endpoints'] };
}
function state(coinPublicKey = publicKey): ShieldedWalletState {
  return { progress: { isStrictlyComplete: () => true },
    coinPublicKey: { toHexString: () => coinPublicKey }, encryptionPublicKey: { toHexString: () => encryptionKey },
    balances: { [token]: 12n }, serialize: () => 'public-sdk-state',
  } as unknown as ShieldedWalletState;
}
/** The `txHistoryStorage` the n-th builder was made with. */
const builderHistory = (mock: ReturnType<typeof vi.fn>, call = 0) =>
  (mock.mock.calls[call] as [{ txHistoryStorage: unknown }])[0].txHistoryStorage;

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
    h.identity.mockResolvedValue(identity);
    h.history.mockResolvedValue([]); h.serializeHistory.mockResolvedValue('serialized-history');
    h.restoreHistory.mockReturnValue(restoredHistory);
    h.load.mockResolvedValue(checkpoint);
    h.save.mockResolvedValue(undefined); h.saveHistory.mockResolvedValue(undefined); h.clear.mockResolvedValue(undefined);
    h.status.mockImplementation(status => { h.store.privateSyncStatus = status; });
    h.publish.mockImplementation(() => { h.store.privateSyncStatus = 'synced'; });
  });
  afterEach(async () => { await stopMidnightPrivateSync(); vi.useRealTimers(); debug.mockRestore(); });

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

  it('saves the history paired with the state, before the state', async () => {
    h.load.mockResolvedValue(null);
    await startMidnightPrivateSync(args());
    events.next(state()); await vi.advanceTimersByTimeAsync(1001);
    expect(h.saveHistory).toHaveBeenCalledWith('verified-1', seed, 'public-sdk-state', 'serialized-history');
    expect(h.save).toHaveBeenCalledWith('verified-1', 'shielded', seed, 'public-sdk-state');
    expect(h.saveHistory.mock.invocationCallOrder[0]).toBeLessThan(h.save.mock.invocationCallOrder[0]);
  });

  it('still saves the state when the history save fails (the pair then no longer matches)', async () => {
    h.load.mockResolvedValue(null);
    h.saveHistory.mockRejectedValue(new Error('quota'));
    await startMidnightPrivateSync(args());
    events.next(state()); await vi.advanceTimersByTimeAsync(1001);
    expect(h.save).toHaveBeenCalledOnce();
    expect(h.store.privateSyncStatus).toBe('synced');
  });

  it('with no checkpoint, replays cold and says so in the timing line', async () => {
    h.load.mockResolvedValue(null);
    await startMidnightPrivateSync(args());
    expect(cold).toHaveBeenCalledOnce();
    expect(restore).not.toHaveBeenCalled();
    expect(builderHistory(h.factory)).not.toBe(restoredHistory);
    events.next(state()); await vi.advanceTimersByTimeAsync(1001);
    expect(debug).toHaveBeenCalledWith('[midnight-timing] private sync', expect.objectContaining({ warm: false }));
  });

  it('a history the SDK cannot read means a cold replay, and the checkpoint is dropped', async () => {
    h.restoreHistory.mockImplementation(() => { throw new Error('unknown history format'); });
    await startMidnightPrivateSync(args());
    expect(restore).not.toHaveBeenCalled();
    expect(cold).toHaveBeenCalledOnce();
    expect(h.clear).toHaveBeenCalledWith('verified-1', seed);
  });

  it('a state the SDK cannot read means a cold replay with a fresh history, and the checkpoint is dropped', async () => {
    restore.mockImplementation(() => { throw new Error('unsupported snapshot version'); });
    await startMidnightPrivateSync(args());
    expect(cold).toHaveBeenCalledOnce();
    expect(h.clear).toHaveBeenCalledWith('verified-1', seed);
    // The builder the cold wallet came from has a new history, not the restored one.
    expect(builderHistory(h.factory, 1)).not.toBe(restoredHistory);
  });

  it('a resumed state of another key is dropped and never published; the next start replays cold', async () => {
    await startMidnightPrivateSync(args());
    events.next(state('ff'.repeat(32))); await vi.advanceTimersByTimeAsync(1001);
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.clear).toHaveBeenCalledWith('verified-1', seed);
    expect(h.store.privateSyncStatus).toBe('error');
    expect(wallet.stop).toHaveBeenCalledOnce();
    h.load.mockResolvedValue(null);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(cold).toHaveBeenCalledOnce();
  });

  it('a checkpoint read that stalls costs 3 s, then the sync replays cold', async () => {
    h.load.mockReturnValue(new Promise(() => {}));
    const starting = startMidnightPrivateSync(args());
    await vi.advanceTimersByTimeAsync(2_999);
    expect(cold).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    await starting;
    expect(cold).toHaveBeenCalledOnce();
    expect(restore).not.toHaveBeenCalled();
  });

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
});
