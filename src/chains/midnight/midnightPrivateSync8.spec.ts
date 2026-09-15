// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { ShieldedAddress, ShieldedCoinPublicKey, ShieldedEncryptionPublicKey } from '@midnightntwrk/wallet-sdk-address-format';
import { Subject } from 'rxjs';

const h = vi.hoisted(() => ({
  factory: vi.fn(), start: vi.fn(), load: vi.fn(), save: vi.fn(), publish: vi.fn(), status: vi.fn(), progress: vi.fn(),
  store: { activeWalletKey: 'mn_addr_preprod1owner', privateSyncStatus: 'idle', addresses: { shielded: '' } },
  wallet: { loggedWallet: { id: 7, network: 'Preprod', chain: 'Midnight' }, isLocked: false },
}));
vi.mock('@midnightntwrk/wallet-sdk-shielded', () => ({ ShieldedWallet: h.factory }));
vi.mock('@midnightntwrk/wallet-sdk-abstractions', () => ({
  InMemoryTransactionHistoryStorage: class {},
  TransactionHistoryStorage: { TransactionHistoryCommonSchema: {} },
}));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: h.store,
  midnightActions: { applyPrivateSnapshot: h.publish, setPrivateSyncStatus: h.status, setPrivateSyncProgress: h.progress } }));
vi.mock('@/stores/walletStore', () => ({ walletStore: h.wallet }));
vi.mock('./midnightShieldedBuilder', () => ({ startShieldedWallet: h.start }));
vi.mock('./midnightWalletStatePersistence', () => ({ loadWalletState: h.load, saveWalletState: h.save }));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));

import {
  PRIVATE_SYNC_MAX_BARREN_RESTARTS,
  SHIELDED_INDEXER_BUFFER,
  startMidnightPrivateSync8,
  stopMidnightPrivateSync8,
} from './midnightPrivateSync8';
import type { MidnightPrivateSync8Args } from './midnightPrivateSync8';

const seed = new Uint8Array(32).fill(3);
const token = 'aa'.repeat(32);
let events: Subject<unknown>;
let sdkWallet: { state: Subject<unknown>; stop: ReturnType<typeof vi.fn> };

function args(): MidnightPrivateSync8Args {
  return {
    walletId: '7',
    network: 'Preprod',
    seed: seed.slice(),
    endpoints: {
      sdkNetworkId: 'preprod', publicIndexerUrl: 'https://indexer.invalid', publicIndexerWsUrl: 'wss://indexer.invalid',
    } as MidnightPrivateSync8Args['endpoints'],
  };
}

/** An SDK state snapshot; `applied === highest` is what makes it strictly complete. */
function state(balances: Record<string, bigint>, applied = 10n, highest = 10n, connected = true) {
  return {
    progress: {
      appliedIndex: applied,
      highestRelevantWalletIndex: highest,
      isConnected: connected,
      isStrictlyComplete: () => connected && applied === highest,
    },
    balances,
    serialize: () => `sdk-state@${applied}`,
  };
}

/**
 * Advance fake time in 1 s steps, yielding a real macrotask turn between
 * them so the loop's async chains (dynamic imports, stop, reopen) drain
 * fully instead of being starved by the fake clock.
 */
async function advance(ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
    await vi.advanceTimersByTimeAsync(1000);
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    await new Promise<void>((resolve) => { setImmediate(resolve); });
  }
}

/** Advance until `done()` holds, or fail after `maxMs` of fake time. */
async function advanceUntil(done: () => boolean, maxMs: number): Promise<void> {
  for (let elapsed = 0; elapsed < maxMs && !done(); elapsed += 1000) await advance(1000);
  expect(done()).toBe(true);
}

function encodeAddress(coinHex: string, encHex: string): string {
  return ShieldedAddress.codec.encode('preprod', new ShieldedAddress(
    ShieldedCoinPublicKey.fromHexString(coinHex), ShieldedEncryptionPublicKey.fromHexString(encHex),
  )).toString();
}

describe('ledger-8 private sync', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // setImmediate stays real so `advance()` can yield a full macrotask turn between fake-time steps.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const keys = ledger.ZswapSecretKeys.fromSeed(seed);
    h.store.addresses.shielded = encodeAddress(keys.coinPublicKey, keys.encryptionPublicKey);
    keys.clear();
    h.wallet.isLocked = false; h.wallet.loggedWallet.id = 7; h.store.activeWalletKey = 'mn_addr_preprod1owner';
    h.store.privateSyncStatus = 'idle';
    events = new Subject();
    sdkWallet = { state: events, stop: vi.fn().mockResolvedValue(undefined) };
    h.factory.mockReturnValue({ builder: true });
    h.start.mockResolvedValue(sdkWallet);
    h.load.mockResolvedValue(null); h.save.mockResolvedValue(undefined);
    h.status.mockImplementation((status: string) => { h.store.privateSyncStatus = status; });
    h.publish.mockImplementation(() => { h.store.privateSyncStatus = 'synced'; });
  });
  afterEach(async () => { await stopMidnightPrivateSync8(); vi.useRealTimers(); });

  it('publishes only custom colours, only after a strictly complete state, and checkpoints under the network id', async () => {
    const input = args(); const starting = startMidnightPrivateSync8(input); input.seed.fill(0);
    await starting;
    expect(h.status).toHaveBeenCalledWith('syncing');
    expect(h.factory).toHaveBeenCalledWith(expect.objectContaining({
      networkId: 'preprod',
      indexerClientConnection: expect.objectContaining({ bufferSize: SHIELDED_INDEXER_BUFFER }),
    }));
    expect(h.load).toHaveBeenCalledWith('preprod', 'shielded', expect.any(Uint8Array));

    events.next(state({ [token]: 12n, ['0'.repeat(64)]: 999n }, 5n, 10n));
    await vi.advanceTimersByTimeAsync(1001);
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.progress).toHaveBeenLastCalledWith({ applied: 5, highest: 10, connected: true });

    events.next(state({ [token]: 12n, ['0'.repeat(64)]: 999n }));
    await vi.advanceTimersByTimeAsync(1001);
    expect(h.publish).toHaveBeenCalledWith({ [token]: 12n }, []);
    expect(h.save).toHaveBeenCalledWith('preprod', 'shielded', expect.any(Uint8Array), 'sdk-state@10');
  });

  it('refuses a seed that does not belong to the active wallet', async () => {
    h.store.addresses.shielded = encodeAddress('00'.repeat(32), '11'.repeat(32));
    await startMidnightPrivateSync8(args());
    expect(h.status).toHaveBeenLastCalledWith('error');
    expect(h.start).not.toHaveBeenCalled();
  });

  it('stops publishing once the wallet is locked', async () => {
    await startMidnightPrivateSync8(args());
    h.wallet.isLocked = true;
    events.next(state({ [token]: 1n }));
    await vi.advanceTimersByTimeAsync(1001);
    expect(h.publish).not.toHaveBeenCalled();
  });

  it('checkpoints a cold sync that is still advancing', async () => {
    await startMidnightPrivateSync8(args());
    events.next(state({}, 100n, 5000n));
    await vi.advanceTimersByTimeAsync(1001);
    expect(h.save).not.toHaveBeenCalled();
    // First 30 s cycle: applied moved since the last checkpoint → bank it.
    await advance(30_000);
    expect(h.save).toHaveBeenCalledWith('preprod', 'shielded', expect.any(Uint8Array), 'sdk-state@100');
    expect(sdkWallet.stop).not.toHaveBeenCalled();
    expect(h.store.privateSyncStatus).toBe('syncing');
  });

  it('checkpoints and rebuilds the SDK wallet when the applied index stops advancing', async () => {
    await startMidnightPrivateSync8(args());
    events.next(state({}, 100n, 5000n));
    await vi.advanceTimersByTimeAsync(1001);
    expect(h.start).toHaveBeenCalledTimes(1);
    // No further events: after >45 s without advance the loop restarts once.
    await advanceUntil(() => h.start.mock.calls.length >= 2, 120_000);
    expect(sdkWallet.stop).toHaveBeenCalledTimes(1);
    expect(h.start).toHaveBeenCalledTimes(2);
    expect(h.save).toHaveBeenLastCalledWith('preprod', 'shielded', expect.any(Uint8Array), 'sdk-state@100');
    expect(h.store.privateSyncStatus).toBe('syncing');
    expect(h.status).not.toHaveBeenCalledWith('error');
  });

  it('gives up after repeated restarts that receive no events at all', async () => {
    await startMidnightPrivateSync8(args());
    // Each barren restart takes about one 60 s stall window.
    await advanceUntil(() => h.store.privateSyncStatus === 'error', (PRIVATE_SYNC_MAX_BARREN_RESTARTS + 2) * 60_000);
    expect(h.start).toHaveBeenCalledTimes(PRIVATE_SYNC_MAX_BARREN_RESTARTS);
    expect(h.status).toHaveBeenLastCalledWith('error');
    expect(h.save).not.toHaveBeenCalled(); // nothing to bank: no state ever arrived
  });

  it('stops the SDK wallet and reports idle on stop', async () => {
    await startMidnightPrivateSync8(args());
    await stopMidnightPrivateSync8();
    expect(sdkWallet.stop).toHaveBeenCalled();
    expect(h.status).toHaveBeenLastCalledWith('idle');
  });

  it('ignores non-ledger-8 networks', async () => {
    const input = args();
    await startMidnightPrivateSync8({ ...input, network: 'Stagenet', endpoints: { ...input.endpoints, sdkNetworkId: 'stagenet' } });
    expect(h.factory).not.toHaveBeenCalled();
  });
});
