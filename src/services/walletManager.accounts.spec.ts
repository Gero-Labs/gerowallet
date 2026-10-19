// An account added under a recovery-phrase, PassKey or Google wallet stores none
// of the wallet's secrets. These drive the real WalletManager login and unlock
// with everything around them stubbed, to check that such an account is logged
// in with its account #0's secrets, keeps the group's Google session on a switch
// within the group, and is unlocked with its account #0's settings.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => {
  const state = { loggedWallet: null as null | Record<string, unknown>, isSyncing: false, isLocked: false };
  const sessions = new Map<number, Uint8Array>();
  return {
    state,
    sessions,
    constructed: vi.fn(),
    wallets: {} as Record<number, Record<string, unknown>>,
    config: {} as Record<number, Record<string, unknown>>,
    decrypt: vi.fn(),
    locked: vi.fn((value: boolean) => { state.isLocked = value; }),
  };
});
vi.mock('@/chrome/walletBg', () => ({
  WalletBg: class {
    [key: string]: unknown;
    chain = 'Cardano';
    constructor(wallet: Record<string, unknown>) {
      Object.assign(this, wallet);
      this['secretsWalletId'] = wallet['secretsWalletId'] ?? wallet['id'];
      env.constructed(wallet);
    }
    getLastSyncInfo = async () => ({ blockNo: 1 });
    unsubscribeAll = () => undefined;
  },
  alarmListener: vi.fn(),
}));
vi.mock('@/stores/walletStore', () => ({
  walletStore: env.state,
  default: {
    setSyncing: vi.fn(), setLocked: env.locked, clearForWalletSwitch: vi.fn(), logout: vi.fn(),
    setLoggedWallet: (wallet: Record<string, unknown>) => { env.state.loggedWallet = wallet; },
  },
}));
vi.mock('@/db/gero-db', () => ({ getAllWallets: async () => env.wallets }));
vi.mock('@/db/wallet-db', () => ({
  clearDbCache: vi.fn(),
  getDb: async (id: number) => ({
    table: () => ({ where: ({ key }: { key: string }) => ({ first: async () => (key in (env.config[id] ?? {}) ? { key, value: env.config[id][key] } : undefined) }) }),
  }),
}));
vi.mock('@/shared/utils/crypto', () => ({ decryptPrivateKey: env.decrypt }));
vi.mock('@/chrome/mpcSessionCache', () => ({ mpcSessionCache: {
  get: (id: number) => env.sessions.get(id),
  clear: (id: number) => env.sessions.delete(id),
  clearAll: () => env.sessions.clear(),
} }));
vi.mock('@/chrome/mpcLoginShareCache', () => ({ mpcLoginShareCache: { clear: vi.fn(), clearAll: vi.fn() } }));
vi.mock('@/stores/loading', () => ({ default: { setLoading: vi.fn(), setRestoring: vi.fn(), setText: vi.fn(), setProgress: vi.fn() } }));
vi.mock('@/services/websocket.service', () => ({ default: { waitForSync: vi.fn(), pauseSyncCheck: vi.fn(), resumeSyncCheck: vi.fn(), close: vi.fn() } }));
vi.mock('@/utils/networks', () => ({ default: {} }));
vi.mock('@/stores/tokenMetadataStore', () => ({ default: {} }));
vi.mock('@/stores/tapToolsStore', () => ({ default: { clear: vi.fn() } }));
vi.mock('@/stores/musicStore', () => ({ default: { logout: vi.fn(async () => undefined) } }));
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
vi.mock('@/services/midnight-sync.service', () => ({ default: { isActive: () => false } }));
vi.mock('@/chains/midnight/midnightPrivateSyncSession', () => ({
  clearMidnightPrivateSession: vi.fn(async () => undefined),
  activateMidnightPrivateSession: vi.fn(async () => undefined),
  prepareMidnightPrivateSession: vi.fn(),
  midnightPrivateSessionEpoch: vi.fn(),
}));

const SECRETS = { encryptionMethod: 'password', encryptedPrivateKey: 'sealed-root-key', encryptedMnemonic: 'sealed-mnemonic' };
const base = { chain: 'Cardano', network: 'Preprod', type: 'Normal', publicKey: 'xpub-0' };
const head = { id: 10, name: 'Daily', ...base, ...SECRETS };
const account1 = { id: 11, name: 'Account #1', ...base, publicKey: 'xpub-1', accountIndex: 1, parentWalletId: 10, encryptionMethod: 'password' };
const other = { id: 20, name: 'Savings', ...base, publicKey: 'xpub-other', encryptionMethod: 'password', encryptedPrivateKey: 'other-key' };
const google = { id: 30, name: 'Google', ...base, type: 'Google', publicKey: 'xpub-g0', encryptionMethod: 'mpc', mpcDeviceShare: 'share', userId: 'sub' };
const googleAccount = { id: 31, name: 'Account #1', ...base, type: 'Google', publicKey: 'xpub-g1', accountIndex: 1, parentWalletId: 30, encryptionMethod: 'mpc' };

type Internals = { initializeWallet: () => Promise<void>; initializeLastActivityTimestamp: () => Promise<void>; verifyUnlockCredentials: (id: number, credential: string) => Promise<boolean> };

async function manager() {
  const { WalletManager } = await import('./walletManager.service');
  const instance = WalletManager.getInstance();
  const internal = instance as unknown as Internals;
  vi.spyOn(internal, 'initializeWallet').mockResolvedValue();
  vi.spyOn(internal, 'initializeLastActivityTimestamp').mockResolvedValue();
  return { instance, internal };
}
const lastConstructed = () => env.constructed.mock.calls.at(-1)?.[0] as Record<string, unknown>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  Object.assign(env.state, { loggedWallet: null, isSyncing: false, isLocked: false });
  env.sessions.clear();
  env.wallets = { 10: head, 11: account1, 20: other, 30: google, 31: googleAccount };
  env.config = {};
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('logging in to an added account', () => {
  it('holds its account #0’s secrets, and says which record they belong to', async () => {
    const { instance } = await manager();
    await instance.login(account1);

    expect(lastConstructed()).toMatchObject({ id: 11, publicKey: 'xpub-1', accountIndex: 1, ...SECRETS, secretsWalletId: 10 });
    expect(env.state.loggedWallet).toMatchObject({ id: 11, encryptedPrivateKey: 'sealed-root-key', secretsWalletId: 10 });
  });

  it('takes no secrets the request carries for an account whose account #0 is gone', async () => {
    delete env.wallets[10];
    const { instance } = await manager();
    await instance.login({ ...account1, encryptedPrivateKey: 'smuggled' });

    expect(lastConstructed()).toMatchObject({ id: 11, encryptedPrivateKey: undefined, secretsWalletId: 11 });
  });

  it('logs any other wallet in as given', async () => {
    const { instance } = await manager();
    await instance.login(other);

    expect(lastConstructed()).toEqual(other);
  });

  it('keeps the Google session when switching between accounts of one wallet', async () => {
    env.sessions.set(30, new Uint8Array([1]));
    const { instance } = await manager();
    await instance.login(google);
    expect(env.state.isLocked).toBe(false);

    await instance.login(googleAccount);

    expect(env.sessions.has(30)).toBe(true);
    expect(env.state.isLocked).toBe(false);
  });

  it('still ends the Google session when switching to another wallet', async () => {
    env.sessions.set(30, new Uint8Array([1]));
    const { instance } = await manager();
    await instance.login(googleAccount);
    expect(env.state.isLocked).toBe(false);

    await instance.login(other);

    expect(env.sessions.has(30)).toBe(false);
  });

  it('locks a Google account whose wallet is not unlocked this session', async () => {
    const { instance } = await manager();
    await instance.login(googleAccount);

    expect(env.state.isLocked).toBe(true);
  });
});

describe('unlocking an added account', () => {
  it('checks its account #0’s lock and password', async () => {
    env.config[10] = { unlockMethod: 'password' };
    env.decrypt.mockImplementation((blob: string, password: string) => {
      if (blob !== 'sealed-root-key' || password !== 'right') throw new Error('wrong password');
      return Buffer.alloc(96);
    });
    const { internal } = await manager();

    await expect(internal.verifyUnlockCredentials(11, 'wrong')).resolves.toBe(false);
    await expect(internal.verifyUnlockCredentials(11, 'right')).resolves.toBe(true);
  });
});
