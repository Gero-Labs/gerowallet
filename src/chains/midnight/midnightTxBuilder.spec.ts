// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { getMidnightEndpoints } from './midnightConfig';
import { DUST_SYNC_INACTIVITY_MS, syncDustWalletAndBalanceFees } from './midnightTxBuilder';

const mocks = vi.hoisted(() => ({ reconstruct: vi.fn(), balance: vi.fn(), transport: vi.fn(), identity: vi.fn(), recheck: vi.fn() }));
vi.mock('./midnightDustLightSync', () => ({ reconstructDustState: mocks.reconstruct }));
vi.mock('./midnightDustLightLedger8', () => ({ dustLedger8: {}, balanceLightDust8: mocks.balance }));
vi.mock('./midnightDustLightTransport', () => ({ createDustLightTransport: mocks.transport }));
vi.mock('./midnightChainIdentity', () => ({ readVerifiedMidnightChainIdentity: mocks.identity, assertMidnightChainIdentityUnchanged: mocks.recheck }));

const args = () => ({ sdkNetworkId: 'mainnet', endpoints: getMidnightEndpoints('Mainnet')!,
  dustSecretSeed: new Uint8Array(32).fill(42), ttl: new Date(Date.now() + 300000) });
const txs = () => [ledger.Transaction.fromParts('mainnet')];

describe('DUST send preparation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.identity.mockResolvedValue({ network: 'midnight-mainnet', chain_generation: 2, genesis_hash: `0x${'11'.repeat(32)}` });
    mocks.recheck.mockResolvedValue(undefined);
    mocks.transport.mockReturnValue({});
    mocks.reconstruct.mockResolvedValue({ state: {}, block: { timestamp: Date.now(), ledgerParameters: 'params' } });
    mocks.balance.mockReturnValue(ledger.Transaction.fromParts('mainnet'));
  });
  afterEach(() => vi.useRealTimers());

  it('uses compact sync for restored wallets regardless of local creation time', async () => {
    await syncDustWalletAndBalanceFees({ ...args(), dustRegisteredAt: new Date() }, txs());
    expect(mocks.reconstruct).toHaveBeenCalledOnce();
    expect(mocks.balance).toHaveBeenCalledOnce();
    expect(mocks.recheck).toHaveBeenCalledOnce();
    expect(mocks.transport.mock.calls[0][1].aborted).toBe(true);
    expect(() => mocks.reconstruct.mock.calls[0][1].publicKey).toThrow();
  });

  it('fails without balancing if snapshot verification fails, with no replay fallback', async () => {
    mocks.reconstruct.mockRejectedValue(new Error('DUST commitment root verification failed'));
    await expect(syncDustWalletAndBalanceFees(args(), txs())).rejects.toThrow('root verification');
    expect(mocks.balance).not.toHaveBeenCalled();
    expect(mocks.reconstruct).toHaveBeenCalledOnce();
    expect(mocks.transport.mock.calls[0][1].aborted).toBe(true);
  });

  it('rejects a chain reset after reconstruction instead of returning a fee transaction', async () => {
    mocks.recheck.mockRejectedValue(new Error('Midnight chain changed'));
    await expect(syncDustWalletAndBalanceFees(args(), txs())).rejects.toThrow('chain changed');
    expect(mocks.balance).toHaveBeenCalledOnce();
  });

  it('aborts a stalled network operation and clears the DUST key', async () => {
    vi.useFakeTimers();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    mocks.reconstruct.mockImplementation(async () => new Promise((_resolve, reject) => {
      const signal: AbortSignal = mocks.transport.mock.calls[0][1];
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      started();
    }));
    const result = expect(syncDustWalletAndBalanceFees(args(), txs())).rejects.toThrow('timed out');
    await ready;
    await vi.advanceTimersByTimeAsync(DUST_SYNC_INACTIVITY_MS);
    await result;
    expect(mocks.balance).not.toHaveBeenCalled();
    expect(() => mocks.reconstruct.mock.calls[0][1].publicKey).toThrow();
  });

  // Issue gero-ios#241: a flat 120 s bound stopped every send on a device that needs longer for one
  // pass, and each retry started from zero.
  const tick = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
  const syncArgs = (minutes: number) => ({ ...args(), ttl: new Date(Date.now() + minutes * 60_000) });
  const transportSignal = (): AbortSignal => mocks.transport.mock.calls[0][1];
  const transportActivity = (): (() => void) => mocks.transport.mock.calls[0][2];
  const syncProgress = (): ((percent: number, detail: string) => void) => mocks.reconstruct.mock.calls[0][4];
  const synced = () => ({ state: {}, block: { timestamp: Date.now(), ledgerParameters: 'params' } });

  it('lets a slow synchronization finish while the network keeps answering', async () => {
    vi.useFakeTimers();
    mocks.reconstruct.mockImplementation(async () => {
      for (let reply = 0; reply < 20; reply++) {
        await tick(30_000);
        transportSignal().throwIfAborted();
        transportActivity()();
      }
      return synced();
    });
    const result = syncDustWalletAndBalanceFees(syncArgs(15), txs());
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await expect(result).resolves.toBeDefined();
    expect(mocks.balance).toHaveBeenCalledOnce();
  });

  it('counts progress steps as activity, so long local work between requests is not a stall', async () => {
    vi.useFakeTimers();
    const onDustSyncProgress = vi.fn();
    mocks.reconstruct.mockImplementation(async () => {
      for (const percent of [5, 30, 50, 70]) {
        syncProgress()(percent, '');
        await tick(DUST_SYNC_INACTIVITY_MS - 1000);
        transportSignal().throwIfAborted();
      }
      return synced();
    });
    const result = syncDustWalletAndBalanceFees({ ...syncArgs(15), onDustSyncProgress }, txs());
    await vi.advanceTimersByTimeAsync(4 * DUST_SYNC_INACTIVITY_MS);
    await expect(result).resolves.toBeDefined();
    expect(onDustSyncProgress.mock.calls.map(call => call[0])).toEqual([5, 30, 50, 70]);
  });

  it('aborts once the network has been silent for the inactivity limit, however long it ran before', async () => {
    vi.useFakeTimers();
    let stalled!: () => void;
    const stall = new Promise<void>(resolve => { stalled = resolve; });
    mocks.reconstruct.mockImplementation(async () => {
      for (let reply = 0; reply < 6; reply++) { await tick(30_000); transportActivity()(); }
      stalled();
      return new Promise((_resolve, reject) => {
        transportSignal().addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    const outcome = expect(syncDustWalletAndBalanceFees(syncArgs(15), txs())).rejects
      .toThrow('DUST synchronization timed out. Please try again shortly.');
    await vi.advanceTimersByTimeAsync(180_000);
    await stall;
    await vi.advanceTimersByTimeAsync(DUST_SYNC_INACTIVITY_MS - 1);
    expect(transportSignal().aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(mocks.balance).not.toHaveBeenCalled();
    expect(() => mocks.reconstruct.mock.calls[0][1].publicKey).toThrow();
  });

  it('stops at the transaction TTL even while the network keeps answering', async () => {
    vi.useFakeTimers();
    mocks.reconstruct.mockImplementation(async () => {
      for (;;) { await tick(10_000); transportSignal().throwIfAborted(); transportActivity()(); }
    });
    const outcome = expect(syncDustWalletAndBalanceFees(syncArgs(5), txs())).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(transportSignal().aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(mocks.balance).not.toHaveBeenCalled();
  });

  it('accepts a TTL beyond the timer range without aborting at once', async () => {
    vi.useFakeTimers();
    mocks.reconstruct.mockImplementation(async () => {
      await tick(30_000);
      transportSignal().throwIfAborted();
      return synced();
    });
    const result = syncDustWalletAndBalanceFees(syncArgs(40 * 24 * 60), txs());
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(result).resolves.toBeDefined();
  });

  it('repeats the last progress while replies keep arriving, so a caller watching for silence sees a live sync', async () => {
    vi.useFakeTimers();
    const onDustSyncProgress = vi.fn();
    mocks.reconstruct.mockImplementation(async () => {
      await tick(20_000);
      transportActivity()();
      syncProgress()(50, '');
      for (let reply = 0; reply < 10; reply++) { await tick(5_000); transportActivity()(); }
      return synced();
    });
    const result = syncDustWalletAndBalanceFees({ ...syncArgs(15), onDustSyncProgress }, txs());
    await vi.advanceTimersByTimeAsync(70_000);
    await expect(result).resolves.toBeDefined();
    // Nothing before the first real step; then the step itself and one repeat per 10 s of replies.
    expect(onDustSyncProgress.mock.calls).toEqual(Array(6).fill([50, '']));
  });

  it('keeps going when the caller progress sink throws on a repeat', async () => {
    vi.useFakeTimers();
    const onDustSyncProgress = vi.fn(() => { throw new Error('sink'); });
    mocks.reconstruct.mockImplementation(async () => {
      try { syncProgress()(30, ''); } catch { /* reconstructDustState guards its own reports */ }
      for (let reply = 0; reply < 3; reply++) { await tick(10_000); transportActivity()(); }
      return synced();
    });
    const result = syncDustWalletAndBalanceFees({ ...syncArgs(15), onDustSyncProgress }, txs());
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(result).resolves.toBeDefined();
    expect(onDustSyncProgress).toHaveBeenCalledTimes(4);
  });

  it('checks endpoint network and expiry before fetching state', async () => {
    await expect(syncDustWalletAndBalanceFees({ ...args(), endpoints: getMidnightEndpoints('Preprod')! }, txs())).rejects.toThrow('network mismatch');
    await expect(syncDustWalletAndBalanceFees({ ...args(), ttl: new Date(0) }, txs())).rejects.toThrow('expiry');
    expect(mocks.identity).not.toHaveBeenCalled();
  });
});
