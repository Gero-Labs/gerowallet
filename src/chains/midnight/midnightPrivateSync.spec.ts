// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { ShieldedAddress, ShieldedCoinPublicKey, ShieldedEncryptionPublicKey } from 'midnight-v9-address-format';
import { Subject } from 'rxjs';
import type { ShieldedWalletState, ShieldedTransactionHistoryEntry } from 'midnight-v9-shielded';
import type { MidnightPrivateSyncArgs } from './midnightPrivateSync';

const h = vi.hoisted(() => ({
  factory: vi.fn(), identity: vi.fn(), save: vi.fn(), history: vi.fn(), publish: vi.fn(), status: vi.fn(),
  store: { activeWalletKey: 'mn_addr_stagenet1owner', addresses: { shielded: '' },
    chainIdentity: { network: 'midnight-stagenet', generation: 1, genesisHash: `0x${'ab'.repeat(32)}` } },
  wallet: { loggedWallet: { id: 7, network: 'Stagenet', chain: 'Midnight' }, isLocked: false },
}));
vi.mock('midnight-v9-shielded', () => ({ ShieldedWallet: h.factory }));
vi.mock('midnight-v9-abstractions', () => ({
  InMemoryTransactionHistoryStorage: class { getAll() { return h.history(); } },
}));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: h.store,
  midnightActions: { applyPrivateSnapshot: h.publish, setPrivateSyncStatus: h.status } }));
vi.mock('@/stores/walletStore', () => ({ walletStore: h.wallet }));
vi.mock('./midnightChainIdentity', () => ({ readVerifiedMidnightChainIdentity: h.identity,
  midnightCheckpointNamespace: (identity: { chain_generation: number }) => `verified-${identity.chain_generation}` }));
vi.mock('./midnightWalletStatePersistence', () => ({ saveWalletState: h.save }));

import { startMidnightPrivateSync, stopMidnightPrivateSync, privateHistoryRows } from './midnightPrivateSync';

const seed = new Uint8Array(32).fill(3);
const token = 'aa'.repeat(32);
const identity = { network: 'midnight-stagenet', chain_generation: 1, genesis_hash: `0x${'ab'.repeat(32)}` };
let publicKey: string; let encryptionKey: string;
let events: Subject<ShieldedWalletState>;
let wallet: { state: Subject<ShieldedWalletState>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
function args(): MidnightPrivateSyncArgs {
  return { walletId: '7', network: 'Stagenet', seed: seed.slice(), endpoints: {
    sdkNetworkId: 'stagenet', publicIndexerUrl: 'https://indexer.invalid', publicIndexerWsUrl: 'wss://indexer.invalid',
  } as MidnightPrivateSyncArgs['endpoints'] };
}
function state(): ShieldedWalletState {
  return { progress: { isStrictlyComplete: () => true },
    coinPublicKey: { toHexString: () => publicKey }, encryptionPublicKey: { toHexString: () => encryptionKey },
    balances: { [token]: 12n, ['0'.repeat(64)]: 999n }, serialize: () => 'public-sdk-state',
  } as unknown as ShieldedWalletState;
}

describe('private sync ownership and generation', () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers();
    const keys = ledger.ZswapSecretKeys.fromSeed(seed);
    publicKey = keys.coinPublicKey; encryptionKey = keys.encryptionPublicKey;
    h.store.addresses.shielded = ShieldedAddress.codec.encode('stagenet', new ShieldedAddress(
      ShieldedCoinPublicKey.fromHexString(publicKey), ShieldedEncryptionPublicKey.fromHexString(encryptionKey))).toString();
    keys.clear();
    h.wallet.isLocked = false; h.wallet.loggedWallet.id = 7;
    h.store.activeWalletKey = 'mn_addr_stagenet1owner';
    h.store.chainIdentity = { network: identity.network, generation: 1, genesisHash: identity.genesis_hash };
    events = new Subject();
    wallet = { state: events, start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
    h.factory.mockReturnValue({ startWithSecretKeys: () => wallet });
    h.identity.mockResolvedValue(identity); h.history.mockResolvedValue([]); h.save.mockResolvedValue(undefined);
  });
  afterEach(async () => { await stopMidnightPrivateSync(); vi.useRealTimers(); });

  it('copies caller-owned seed and publishes real custom balances only after full sync', async () => {
    const input = args(); const starting = startMidnightPrivateSync(input); input.seed.fill(0);
    await starting;
    events.next(state()); await vi.advanceTimersByTimeAsync(1001);
    expect(h.publish).toHaveBeenCalledWith({ [token]: 12n }, []);
    expect(h.save).toHaveBeenCalledWith('verified-1', 'shielded', seed, 'public-sdk-state');
  });

  it('lock during pending identity read prevents starting SDK or applying late state', async () => {
    let release!: (value: typeof identity) => void;
    h.identity.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const starting = startMidnightPrivateSync(args());
    await Promise.resolve();
    h.wallet.isLocked = true;
    await stopMidnightPrivateSync(); release(identity); await starting;
    expect(h.factory).not.toHaveBeenCalled(); expect(h.publish).not.toHaveBeenCalled();
  });

  it('stops pending SDK startup and suppresses the old subscription after wallet switch', async () => {
    let release!: () => void;
    wallet.start.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
    const starting = startMidnightPrivateSync(args());
    await vi.advanceTimersByTimeAsync(1);
    h.wallet.loggedWallet.id = 8;
    await stopMidnightPrivateSync(); release(); await starting;
    events.next(state()); await vi.advanceTimersByTimeAsync(1001);
    expect(wallet.stop).toHaveBeenCalledOnce(); expect(h.publish).not.toHaveBeenCalled();
  });

  it('cannot restore old private history after generation changes during an async read', async () => {
    await startMidnightPrivateSync(args());
    let release!: (value: never[]) => void;
    h.history.mockReturnValue(new Promise(resolve => { release = resolve; }));
    events.next(state()); await vi.advanceTimersByTimeAsync(1001);
    h.store.chainIdentity = { network: identity.network, generation: 2, genesisHash: `0x${'cd'.repeat(32)}` };
    release([]); await vi.advanceTimersByTimeAsync(1);
    expect(h.publish).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled();
  });

  it('unknown identity pauses without replacing stored private balances', async () => {
    h.identity.mockRejectedValue(new Error('503 reset pending'));
    await startMidnightPrivateSync(args());
    expect(h.status).toHaveBeenCalledWith('error');
    expect(h.publish).not.toHaveBeenCalled(); expect(h.factory).not.toHaveBeenCalled();
  });

  it('rejects a seed from another wallet before opening the indexer', async () => {
    await startMidnightPrivateSync({ ...args(), seed: new Uint8Array(32).fill(4) });
    expect(h.factory).not.toHaveBeenCalled(); expect(h.publish).not.toHaveBeenCalled();
    expect(h.status).toHaveBeenCalledWith('error');
  });

  it('maps finalized private spend/receive records by actual token without inventing counterparties', () => {
    const entry = { hash: 'tx', lifecycle: { status: 'finalized', finalizedBlock: {
      height: 2, hash: 'block', timestamp: new Date(123000) } }, fees: 4n,
      shielded: { receivedCoins: [{ type: token, value: 2n }], spentCoins: [{ type: token, value: 7n }] },
    } as unknown as ShieldedTransactionHistoryEntry;
    expect(privateHistoryRows([entry])).toMatchObject([{ token, amount: 5n, type: 'send',
      timestamp: 123000, fee: 4n, status: 'confirmed', counterparty: '', isShielded: true }]);
  });
});
