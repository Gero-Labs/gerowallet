import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => {
  const state = { loggedWallet: null as null | { id: number }, isSyncing: false, isLocked: false };
  const loading = { loading: false, isRestoring: false };
  return {
    state, loading, constructed: vi.fn(), lastSync: vi.fn(), waitForSync: vi.fn(),
    storedWallets: vi.fn(async (): Promise<Record<number, unknown>> => ({})),
    syncing: vi.fn((value: boolean) => { state.isSyncing = value; }),
    locked: vi.fn((value: boolean) => { state.isLocked = value; }),
  };
});
vi.mock('@/chrome/walletBg', () => ({
  WalletBg: class {
    id: number;
    chain = 'Cardano';
    xfp?: string;
    firmwareVersion?: string;
    constructor(wallet: { id: number; xfp?: string; firmwareVersion?: string }) {
      this.id = wallet.id;
      this.xfp = wallet.xfp;
      this.firmwareVersion = wallet.firmwareVersion;
      env.constructed(wallet.id);
    }
    getLastSyncInfo = env.lastSync;
  }, alarmListener: vi.fn(),
}));
vi.mock('@/stores/walletStore', () => ({
  walletStore: env.state,
  default: {
    setSyncing: env.syncing, setLocked: env.locked, clearForWalletSwitch: vi.fn(),
    setLoggedWallet: (wallet: { id: number }) => { env.state.loggedWallet = wallet; },
  },
}));
vi.mock('@/stores/loading', () => ({ default: {
  setLoading: (value: boolean) => { env.loading.loading = value; },
  setRestoring: (value: boolean) => { env.loading.isRestoring = value; },
  setText: vi.fn(), setProgress: vi.fn(),
} }));
vi.mock('@/services/websocket.service', () => ({ default: {
  waitForSync: env.waitForSync, pauseSyncCheck: vi.fn(), resumeSyncCheck: vi.fn(),
} }));
vi.mock('@/utils/networks', () => ({ default: {} }));
vi.mock('@/stores/tokenMetadataStore', () => ({ default: {} }));
vi.mock('@/stores/tapToolsStore', () => ({ default: { clear: vi.fn() } }));
vi.mock('@/db/wallet-db', () => ({ clearDbCache: vi.fn() }));
vi.mock('@/db/gero-db', () => ({ getAllWallets: env.storedWallets }));
vi.mock('@/stores/musicStore', () => ({ default: {} }));
vi.mock('@/stores/networkStore', () => ({ default: {} }));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('@cardano-sdk/core', () => ({ Cardano: {} }));
vi.mock('@/services/crossDevice/crossDeviceBootstrap', () => ({ bootstrapCrossDeviceSigning: vi.fn() }));
vi.mock('@/services/crossDevice/localProverProfile', () => ({ createLocalProverServingOptions: vi.fn(), localProverProfile: {} }));
vi.mock('@/services/crossDevice/crossDeviceSettings', () => ({ loadRemoteSigningSettings: vi.fn(), saveRemoteSigningSettings: vi.fn() }));
vi.mock('@/services/crossDevice/deviceIdentityStore', () => ({ loadOrCreateDeviceIdentity: vi.fn() }));
vi.mock('@/services/crossDevice/deviceIdentity', () => ({ isDeviceIdConsistent: vi.fn() }));
vi.mock('@/services/crossDevice/registerProof', () => ({ verifyDeviceRegisterProof: vi.fn(), buildDeviceRegisterSubject: vi.fn() }));
vi.mock('@/chrome/supportChatAuth', () => ({ authenticateSupportChat: vi.fn() }));
vi.mock('@/services/crossDevice/deviceProofStore', () => ({ loadDeviceRegisterProof: vi.fn(), saveDeviceRegisterProof: vi.fn() }));
vi.mock('@/services/crossDevice/pairingNonceStore', () => ({ mintPairingNonce: vi.fn(), consumePairingNonce: vi.fn(), peekPairingNonce: vi.fn() }));
vi.mock('@/services/crossDevice/pairingQr', () => ({ buildPairingQrPayload: vi.fn() }));
vi.mock('@/services/crossDevice/crossDeviceTrust', () => ({ defaultRemoteSigningSettings: () => ({}) }));
vi.mock('@/chrome/mpcSessionCache', () => ({ mpcSessionCache: {} }));
vi.mock('@/chrome/mpcLoginShareCache', () => ({ mpcLoginShareCache: {} }));
vi.mock('@/services/midnight-sync.service', () => ({ default: {} }));
vi.mock('@/chains/midnight/midnightPrivateSyncSession', () => ({}));

type Internals = {
  initializeWallet: () => Promise<void>;
  initializeLastActivityTimestamp: () => Promise<void>;
  verifyUnlockCredentials: () => Promise<boolean>;
};
const wallet = { id: 1, name: 'Test wallet', chain: 'Cardano', network: 'Preprod' };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  Object.assign(env.state, { loggedWallet: null, isSyncing: false, isLocked: false });
  Object.assign(env.loading, { loading: false, isRestoring: false });
  env.lastSync.mockResolvedValue({ blockNo: 1 });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

async function manager() {
  const { WalletManager } = await import('./walletManager.service');
  const instance = WalletManager.getInstance();
  const internal = instance as unknown as Internals;
  const initialize = vi.spyOn(internal, 'initializeWallet').mockResolvedValue();
  vi.spyOn(internal, 'initializeLastActivityTimestamp').mockResolvedValue();
  vi.spyOn(instance, 'logout').mockImplementation(async () => { env.state.loggedWallet = null; });
  return { instance, initialize };
}

describe('wallet login after worker startup', () => {
  it.each(['switch', 'logout'])('does not unlock after %s during credential verification', async action => {
    const { instance } = await manager();
    await instance.login(wallet);
    env.state.isLocked = true;
    const verified = deferred();
    vi.spyOn(instance as unknown as Internals, 'verifyUnlockCredentials')
      .mockImplementation(async () => { await verified.promise; return true; });
    const result = instance.unlock('public-test-password');
    if (action === 'switch') await instance.login({ ...wallet, id: 2 });
    else await instance.logout();
    env.locked.mockClear();
    verified.resolve();
    await expect(result).rejects.toThrow('unlock-target-changed');
    expect(env.locked).not.toHaveBeenCalled();
    expect(env.state.isLocked).toBe(true);
  });
  // The Keystone signers read both from loggedWallet (keystone.ts createKeystoneSignRequest).
  it('carries a Keystone\'s fingerprint and paired firmware version to the logged wallet', async () => {
    const { instance } = await manager();
    await instance.login({ ...wallet, type: 'Keystone', xfp: '0a1b2c3d', firmwareVersion: '3.2.0' });
    expect(env.state.loggedWallet).toMatchObject({ xfp: '0a1b2c3d', firmwareVersion: '3.2.0' });
  });

  // A worker restart logs in with the persisted loggedWallet, which may predate a re-pairing.
  it('logs a Keystone in with the firmware version stored on its record', async () => {
    const { instance } = await manager();
    const persisted = { ...wallet, type: 'Keystone', xfp: '0a1b2c3d', firmwareVersion: '1.7.2' };
    env.storedWallets.mockResolvedValueOnce({ [wallet.id]: { ...persisted, firmwareVersion: '3.2.0' } });
    await instance.login(persisted);
    expect(env.state.loggedWallet).toMatchObject({ xfp: '0a1b2c3d', firmwareVersion: '3.2.0' });
  });

  it('keeps the given firmware version when the stored record cannot be read', async () => {
    const { instance } = await manager();
    env.storedWallets.mockRejectedValueOnce(new Error('DatabaseClosedError'));
    await instance.login({ ...wallet, type: 'Keystone', xfp: '0a1b2c3d', firmwareVersion: '1.7.2' });
    expect(env.state.loggedWallet).toMatchObject({ firmwareVersion: '1.7.2' });
  });

  it('does not restart syncing or unlock an already initialized wallet', async () => {
    const { instance } = await manager();
    const first = await instance.login(wallet);
    env.state.isLocked = true;
    env.syncing.mockClear();
    const again = await instance.login(wallet);
    expect(again).toBe(first);
    expect(env.constructed).toHaveBeenCalledTimes(1);
    expect(env.syncing).not.toHaveBeenCalled();
    expect(env.locked).not.toHaveBeenCalled();
    expect(env.state).toMatchObject({ isLocked: true, isSyncing: false });
    expect(env.loading).toEqual({ loading: false, isRestoring: false });
  });

  it('joins automatic startup when the user clicks the same wallet before initialization completes', async () => {
    const { instance, initialize } = await manager();
    const ready = deferred();
    initialize.mockReturnValue(ready.promise);
    const automatic = instance.login(wallet);
    const click = instance.login(wallet);
    await Promise.resolve();
    expect(env.constructed).toHaveBeenCalledTimes(1);
    expect(env.state.isSyncing).toBe(true);
    ready.resolve();
    const [first, second] = await Promise.all([automatic, click]);
    expect(first).toBe(second);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(env.state.isSyncing).toBe(false);
  });

  it('keeps repeated callers waiting through the initial chain catch-up', async () => {
    const { instance } = await manager();
    const caughtUp = deferred();
    env.lastSync.mockResolvedValue(null);
    env.waitForSync.mockReturnValue(caughtUp.promise);
    const automatic = instance.login(wallet);
    await vi.waitFor(() => expect(instance.getWalletBg()).not.toBeNull());
    let clickedReady = false;
    const click = instance.login(wallet).then(value => { clickedReady = true; return value; });
    await Promise.resolve();
    expect(clickedReady).toBe(false);
    expect(env.state.isSyncing).toBe(true);
    caughtUp.resolve();
    const [first, second] = await Promise.all([automatic, click]);
    expect(first).toBe(second);
    expect(env.constructed).toHaveBeenCalledTimes(1);
    expect(env.state.isSyncing).toBe(false);
  });

  it('releases transient state after failure and permits a new attempt', async () => {
    const { instance, initialize } = await manager();
    initialize.mockRejectedValueOnce(new Error('initialization failed'));
    const results = await Promise.allSettled([instance.login(wallet), instance.login(wallet)]);
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
    expect(instance.logout).toHaveBeenCalledTimes(1);
    expect(env.state.isSyncing).toBe(false);
    expect(env.loading).toEqual({ loading: false, isRestoring: false });
    await expect(instance.login(wallet)).resolves.not.toBeNull();
    expect(env.constructed).toHaveBeenCalledTimes(2);
  });
});
