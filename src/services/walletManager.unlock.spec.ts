// The lock is enforced by the background, not only by the UI: these drive the
// real WalletManager unlock, lock and login with storage and the wallet stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => {
  const state = { loggedWallet: null as null | Record<string, unknown>, isSyncing: false, isLocked: false };
  return {
    state,
    wallets: {} as Record<number, Record<string, unknown>>,
    config: {} as Record<number, Record<string, unknown>>,
    decrypt: vi.fn(),
    clearLoginShares: vi.fn(async () => undefined),
    session: new Map<string, unknown>(),
    lockedWhenShown: [] as boolean[],
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
    setLoggedWallet: (wallet: Record<string, unknown>) => {
      env.lockedWhenShown.push(env.state.isLocked);
      env.state.loggedWallet = wallet;
    },
  },
}));
vi.mock('@/db/gero-db', () => ({ getAllWallets: async () => env.wallets }));
vi.mock('@/db/wallet-db', () => ({
  clearDbCache: vi.fn(),
  getDb: async (id: number) => ({
    table: () => ({ where: ({ key }: { key: string }) => ({ first: async () => (key in (env.config[id] ?? {}) ? { key, value: env.config[id][key] } : undefined) }) }),
  }),
}));
vi.mock('@/shared/utils/crypto', () => ({ decryptPrivateKey: env.decrypt, decrypt: vi.fn(), SecretPurpose: { Mnemonic: 'mnemonic', SecurityData: 'security' } }));
vi.mock('@/chrome/secretMigration', () => ({ upgradeSecretsAfterPasswordDecrypt: vi.fn(async () => ({ outcome: 'already-current' })) }));
vi.mock('@/chrome/mpcSessionCache', () => ({ mpcSessionCache: { get: vi.fn(), clear: vi.fn(), clearAll: vi.fn() } }));
vi.mock('@/chrome/mpcLoginShareCache', () => ({ mpcLoginShareCache: { clear: vi.fn(), clearAll: env.clearLoginShares } }));
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

const base = { chain: 'Cardano', network: 'Preprod', type: 'Normal', publicKey: 'xpub-0' };
const normal = { id: 10, name: 'Daily', ...base, encryptionMethod: 'password', encryptedPrivateKey: 'sealed-root-key' };
const prf = { id: 20, name: 'PassKey', ...base, encryptionMethod: 'prf', webAuthnCredentialId: 'cred-prf' };
const other = { id: 30, name: 'Savings', ...base, encryptionMethod: 'password', encryptedPrivateKey: 'other-key' };

type Internals = {
  initializeWallet: () => Promise<void>;
  initializeLastActivityTimestamp: () => Promise<void>;
  verifyUnlockCredentials: (id: number, credential: string | number[], totp?: string, password?: string, method?: string) => Promise<boolean>;
};

async function manager() {
  const { WalletManager } = await import('./walletManager.service');
  const instance = WalletManager.getInstance();
  const internal = instance as unknown as Internals;
  vi.spyOn(internal, 'initializeWallet').mockResolvedValue();
  vi.spyOn(internal, 'initializeLastActivityTimestamp').mockResolvedValue();
  return { instance, internal };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  Object.assign(env.state, { loggedWallet: null, isSyncing: false, isLocked: false });
  env.wallets = { 10: normal, 20: prf, 30: other };
  env.config = {};
  env.session.clear();
  env.lockedWhenShown = [];
  env.decrypt.mockImplementation((blob: string, password: string) => {
    if (blob !== 'sealed-root-key' || password !== 'right') throw new Error('wrong password');
    return Buffer.alloc(96);
  });
  // chrome.storage.session, where the unlock back-off is kept.
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        get: async (key: string) => (env.session.has(key) ? { [key]: env.session.get(key) } : {}),
        set: async (items: Record<string, unknown>) => { for (const [k, v] of Object.entries(items)) env.session.set(k, v); },
        remove: async (key: string) => { env.session.delete(key); },
      },
    },
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Verify = (id: number, credential: string | number[], totp?: string, password?: string, method?: string, useWalletBg?: boolean, passKeyPrf?: number[]) => Promise<boolean>;

const prfOf = (fill: number) => new Uint8Array(32).fill(fill);
const asBuffer = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;

describe('the background checks every unlock credential itself', () => {
  it('no longer accepts the old browser-verified signals', async () => {
    const { hashPin } = await import('@/shared/utils/security');
    env.config[10] = { unlockMethod: 'password', passKeyForUnlock: true, webAuthnCredentialId: 'cred-1' };
    env.config[20] = { unlockMethod: 'password', lockPasswordHash: await hashPin('lock-pass') };
    const { internal } = await manager();
    await expect(internal.verifyUnlockCredentials(10, 'passkey-authenticated', undefined, undefined, 'password')).resolves.toBe(false);
    await expect(internal.verifyUnlockCredentials(20, 'lockpassword-verified', undefined, undefined, 'password')).resolves.toBe(false);
    await expect(internal.verifyUnlockCredentials(20, 'passkey-authenticated', undefined, undefined, 'password')).resolves.toBe(false);
  });

  it("checks a PRF wallet's lock password against the hash the page stored", async () => {
    const { hashPin } = await import('@/shared/utils/security');
    env.config[20] = { unlockMethod: 'password', lockPasswordHash: await hashPin('lock-pass') };
    const { internal } = await manager();
    await expect(internal.verifyUnlockCredentials(20, 'lock-pass', undefined, undefined, 'password')).resolves.toBe(true);
    await expect(internal.verifyUnlockCredentials(20, 'not-it', undefined, undefined, 'password')).resolves.toBe(false);
  });

  it('the lock-password hash is plain PBKDF2-HMAC-SHA512, so the worker reads what the page wrote', async () => {
    // An independent PBKDF2 (Node) produces a hash the shared verifier accepts: no
    // bundle-specific polyfill is involved in either context.
    const { pbkdf2Sync, randomBytes } = await import('node:crypto');
    const { verifyPin, PBKDF2_ITERATIONS, KEY_SIZE, SALT_SIZE } = await import('@/shared/utils/security');
    const salt = randomBytes(SALT_SIZE);
    const hash = pbkdf2Sync('lock-pass', salt, PBKDF2_ITERATIONS, KEY_SIZE, 'sha512');
    const stored = `${salt.toString('hex')}:${hash.toString('hex')}`;
    await expect(verifyPin('lock-pass', stored)).resolves.toBe(true);
    await expect(verifyPin('lock-pasS', stored)).resolves.toBe(false);
  });

  it("accepts a PassKey unlock only with the PassKey's PRF output (verifier sealed when it was switched on)", async () => {
    const { sealPassKeyUnlockVerifier } = await import('@/shared/utils/webauthn-prf');
    const verifier = await sealPassKeyUnlockVerifier(asBuffer(prfOf(7)), 'cred-1', '10');
    env.config[10] = { unlockMethod: 'pin', pinHash: 'aa:bb', passKeyForUnlock: true, webAuthnCredentialId: 'cred-1', passKeyUnlockVerifier: verifier };
    const { internal } = await manager();
    const verify = (internal.verifyUnlockCredentials as unknown as Verify).bind(internal);
    await expect(verify(10, '', undefined, undefined, 'pin', false, Array.from(prfOf(7)))).resolves.toBe(true);
    await expect(verify(10, '', undefined, undefined, 'pin', false, Array.from(prfOf(8)))).resolves.toBe(false);
    await expect(verify(10, '', undefined, undefined, 'pin', false, [1, 2, 3])).resolves.toBe(false);
    // Switched off: the same PassKey no longer unlocks.
    env.config[10] = { ...env.config[10], passKeyForUnlock: false };
    await expect(verify(10, '', undefined, undefined, 'pin', false, Array.from(prfOf(7)))).resolves.toBe(false);
  });

  it('a wallet whose PassKey unlock was switched on before verifiers existed must set it up again', async () => {
    env.config[10] = { unlockMethod: 'pin', pinHash: 'aa:bb', passKeyForUnlock: true, webAuthnCredentialId: 'cred-1' };
    const { instance } = await manager();
    const { PassKeyUnlockSetupRequiredError } = await import('@/shared/utils/passKeyUnlockProof');
    await expect(instance.verifyPreLoginUnlock(10, '', undefined, undefined, 'pin', Array.from(prfOf(7))))
      .rejects.toBeInstanceOf(PassKeyUnlockSetupRequiredError);
  });

  it('falls back to the PassKey-encrypted spending password when autofill sealed one', async () => {
    const { encryptSpendingPasswordWithPrf } = await import('@/shared/utils/webauthn-prf');
    // Seal it the way the page does, but with a known PRF output.
    vi.stubGlobal('navigator', { credentials: { get: async () => ({ getClientExtensionResults: () => ({ prf: { results: { first: asBuffer(prfOf(5)) } } }) }) } });
    const sealed = await encryptSpendingPasswordWithPrf('right', 'Y3JlZA==', '10');
    env.config[10] = { unlockMethod: 'password', passKeyForUnlock: true, webAuthnCredentialId: 'Y3JlZA==', passKeyEncryptedSpendingPassword: sealed };
    const { internal } = await manager();
    const verify = (internal.verifyUnlockCredentials as unknown as Verify).bind(internal);
    await expect(verify(10, '', undefined, undefined, 'password', false, Array.from(prfOf(5)))).resolves.toBe(true);
    await expect(verify(10, '', undefined, undefined, 'password', false, Array.from(prfOf(6)))).resolves.toBe(false);
  });

  it("checks a PassKey (PRF) wallet's PRF output by opening its own PRF-encrypted key", async () => {
    const { encryptPrivateKeyWithPrf } = await import('@/shared/utils/webauthn-prf');
    const sealedKey = await encryptPrivateKeyWithPrf(new Uint8Array(96).fill(1), 'cred-prf', '20', asBuffer(prfOf(9)));
    env.wallets[20] = { ...prf, prfEncryptedPrivateKey: sealedKey };
    env.config[20] = { unlockMethod: 'password', lockPasswordHash: 'aa:bb' };
    const { internal } = await manager();
    const verify = (internal.verifyUnlockCredentials as unknown as Verify).bind(internal);
    await expect(verify(20, '', undefined, undefined, 'password', false, Array.from(prfOf(9)))).resolves.toBe(true);
    await expect(verify(20, '', undefined, undefined, 'password', false, Array.from(prfOf(4)))).resolves.toBe(false);
  });

  it('a wrong PassKey counts toward the back-off like any wrong credential', async () => {
    const { sealPassKeyUnlockVerifier } = await import('@/shared/utils/webauthn-prf');
    env.config[10] = {
      unlockMethod: 'pin', pinHash: 'aa:bb', passKeyForUnlock: true, webAuthnCredentialId: 'cred-1',
      passKeyUnlockVerifier: await sealPassKeyUnlockVerifier(asBuffer(prfOf(7)), 'cred-1', '10'),
    };
    const { instance } = await manager();
    const { UnlockThrottledError, UNLOCK_FREE_ATTEMPTS } = await import('@/chrome/unlockGuards');
    for (let n = 0; n < UNLOCK_FREE_ATTEMPTS; n++) {
      await expect(instance.verifyPreLoginUnlock(10, '', undefined, undefined, 'pin', Array.from(prfOf(8)))).resolves.toBe(false);
    }
    await expect(instance.verifyPreLoginUnlock(10, '', undefined, undefined, 'pin', Array.from(prfOf(7))))
      .rejects.toBeInstanceOf(UnlockThrottledError);
  });

  it('decides from the wallet being unlocked, never the logged-in one', async () => {
    env.state.loggedWallet = { ...prf };
    env.config[10] = { unlockMethod: 'password' };
    const { internal } = await manager();
    await expect(internal.verifyUnlockCredentials(10, 'lockpassword-verified', undefined, undefined, 'password')).resolves.toBe(false);
  });

  it('refuses a request that names another method than the configured one', async () => {
    env.config[10] = { unlockMethod: 'pin', pinHash: 'aa:bb' };
    const { internal } = await manager();
    // The right spending password, offered as if the wallet were set to 'password'.
    await expect(internal.verifyUnlockCredentials(10, 'right', undefined, undefined, 'password')).resolves.toBe(false);
  });

  it('a post-login password unlock counts the attempt once, not again inside WalletBg', async () => {
    env.config[10] = { unlockMethod: 'password' };
    env.state.loggedWallet = { ...normal };
    const { instance } = await manager();
    const verifySpendingPassword = vi.fn(async (password: string) => password === 'right');
    (instance as unknown as { walletBg: unknown }).walletBg = { id: 10, verifySpendingPassword };
    await expect(instance.unlock('right', undefined, undefined, 'password')).resolves.toBe(true);
    expect(verifySpendingPassword).toHaveBeenCalledWith('right', { counted: false });
  });
});

describe('unlock back-off', () => {
  it('after repeated wrong credentials, refuses even the right one until the wait ends', async () => {
    env.config[10] = { unlockMethod: 'password' };
    const { instance } = await manager();
    const { UnlockThrottledError, UNLOCK_FREE_ATTEMPTS } = await import('@/chrome/unlockGuards');
    for (let n = 0; n < UNLOCK_FREE_ATTEMPTS; n++) {
      await expect(instance.verifyPreLoginUnlock(10, 'wrong')).resolves.toBe(false);
    }
    await expect(instance.verifyPreLoginUnlock(10, 'right')).rejects.toBeInstanceOf(UnlockThrottledError);
    // Another wallet keeps its own count.
    env.config[30] = { unlockMethod: 'password' };
    env.decrypt.mockImplementation(() => Buffer.alloc(96));
    await expect(instance.verifyPreLoginUnlock(30, 'right')).resolves.toBe(true);
  });

  it('a success clears the count', async () => {
    env.config[10] = { unlockMethod: 'password' };
    const { instance } = await manager();
    const { UNLOCK_FREE_ATTEMPTS } = await import('@/chrome/unlockGuards');
    for (let n = 0; n < UNLOCK_FREE_ATTEMPTS - 1; n++) await instance.verifyPreLoginUnlock(10, 'wrong');
    await expect(instance.verifyPreLoginUnlock(10, 'right')).resolves.toBe(true);
    for (let n = 0; n < UNLOCK_FREE_ATTEMPTS - 1; n++) {
      await expect(instance.verifyPreLoginUnlock(10, 'wrong')).resolves.toBe(false);
    }
  });
});

describe('lock', () => {
  it('drops the cached Google login shares, so an MPC wallet needs Google again', async () => {
    const { instance } = await manager();
    await instance.lock();
    expect(env.state.isLocked).toBe(true);
    expect(env.clearLoginShares).toHaveBeenCalledTimes(1);
  });

  it('stays locked even if clearing the shares fails', async () => {
    env.clearLoginShares.mockRejectedValueOnce(new Error('storage'));
    const { instance } = await manager();
    await expect(instance.lock()).resolves.toBeUndefined();
    expect(env.state.isLocked).toBe(true);
  });
});

describe('login with requireUnlock', () => {
  it('locks the wallet before it becomes the logged-in one', async () => {
    const { instance } = await manager();
    await instance.login(normal, { requireUnlock: true });
    expect(env.lockedWhenShown).toEqual([true]);
    expect(env.state.isLocked).toBe(true);
  });

  it('leaves the lock alone without it', async () => {
    const { instance } = await manager();
    await instance.login(normal);
    expect(env.lockedWhenShown).toEqual([false]);
    expect(env.state.isLocked).toBe(false);
  });

  it('also locks when the request joins a login already in flight', async () => {
    const { instance } = await manager();
    const first = instance.login(other);
    const joined = instance.login(other, { requireUnlock: true });
    await Promise.all([first, joined]);
    expect(env.state.isLocked).toBe(true);
  });
});
