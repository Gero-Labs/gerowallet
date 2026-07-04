import { describe, it, expect, vi } from 'vitest';
import { MpcValidationError } from '@/shared/utils/mpc';
import {
  createMpcGoogleWalletFlow,
  unlockMpcWalletFlow,
  recoverMpcGoogleWalletFlow,
  subFromIdToken,
  type CreateMpcGoogleWalletDeps,
  type UnlockMpcWalletDeps,
  type RecoverMpcGoogleWalletDeps,
} from './mpcWalletHandlers';

// A structurally valid (but not cryptographically real) JWT: header.payload.signature,
// payload base64url-encodes `{ sub: 'google-sub-123' }`.
function fakeIdToken(sub = 'google-sub-123'): string {
  // Some polyfilled Buffer shims used in the test env don't support the
  // 'base64url' encoding directly, so encode as base64 and convert.
  const payload = Buffer.from(JSON.stringify({ sub }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

describe('subFromIdToken', () => {
  it('decodes the payload segment and returns sub without verifying the signature', () => {
    expect(subFromIdToken(fakeIdToken('abc-123'))).toBe('abc-123');
  });

  it('throws a clean error on a malformed token', () => {
    expect(() => subFromIdToken('not-a-jwt')).toThrow();
  });
});

describe('createMpcGoogleWalletFlow', () => {
  const shareSet = { deviceShare: 'gmpc1.01.device', loginShare: 'gmpc1.02.login', recoveryShare: 'gmpc1.03.recovery' };
  const expectedXpub = 'xpub-test';

  function makeDeps(overrides: Partial<CreateMpcGoogleWalletDeps> = {}): CreateMpcGoogleWalletDeps {
    return {
      prepareMpcWalletCreation: vi.fn(async () => ({ entropy: new Uint8Array(32), shareSet, expectedXpub })),
      encryptDeviceShare: vi.fn((deviceShare: string, password: string) => `enc(${deviceShare},${password})`),
      enrollLoginShare: vi.fn(async () => ({ stored: true })),
      createMpcGoogleWallet: vi.fn(async () => 42),
      subFromIdToken: vi.fn(() => 'google-sub-123'),
      ...overrides,
    };
  }

  const baseInput = {
    name: 'My Google Wallet',
    icon: 'icon.png',
    theme: 'dark',
    chain: 'cardano',
    network: 'mainnet',
    idToken: fakeIdToken(),
    spendingPassword: 'super-secret-password',
  };

  it('enrolls the login share with idToken/chain/network/loginShare', async () => {
    const deps = makeDeps();
    await createMpcGoogleWalletFlow(baseInput, deps);
    expect(deps.enrollLoginShare).toHaveBeenCalledWith(
      baseInput.idToken,
      baseInput.chain,
      baseInput.network,
      shareSet.loginShare,
    );
  });

  it('encrypts the device share under the spending password before persisting', async () => {
    const deps = makeDeps();
    await createMpcGoogleWalletFlow(baseInput, deps);
    expect(deps.encryptDeviceShare).toHaveBeenCalledWith(shareSet.deviceShare, baseInput.spendingPassword);
  });

  it('persists the wallet record with sub as userId, the expected xpub, and the encrypted device share', async () => {
    const deps = makeDeps();
    await createMpcGoogleWalletFlow(baseInput, deps);
    expect(deps.createMpcGoogleWallet).toHaveBeenCalledWith({
      name: baseInput.name,
      icon: baseInput.icon,
      theme: baseInput.theme,
      chain: baseInput.chain,
      network: baseInput.network,
      userId: 'google-sub-123',
      publicKey: expectedXpub,
      encryptedDeviceShare: `enc(${shareSet.deviceShare},${baseInput.spendingPassword})`,
    });
  });

  it('returns walletId + recoveryShare to the caller, without ever logging it', async () => {
    const deps = makeDeps();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await createMpcGoogleWalletFlow(baseInput, deps);

    expect(result).toEqual({ walletId: 42, recoveryShare: shareSet.recoveryShare });

    for (const spy of [logSpy, errSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        expect(call.join(' ')).not.toContain(shareSet.recoveryShare);
      }
    }
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('does not call createMpcGoogleWallet if enroll fails (propagates the error)', async () => {
    const deps = makeDeps({ enrollLoginShare: vi.fn(async () => { throw new Error('already enrolled'); }) });
    await expect(createMpcGoogleWalletFlow(baseInput, deps)).rejects.toThrow('already enrolled');
    expect(deps.createMpcGoogleWallet).not.toHaveBeenCalled();
  });
});

describe('unlockMpcWalletFlow', () => {
  const wallet = { chain: 'cardano', network: 'mainnet', publicKey: 'xpub-test', mpcDeviceShare: 'enc-device-share' };

  function makeDeps(overrides: Partial<UnlockMpcWalletDeps> = {}): UnlockMpcWalletDeps {
    return {
      getWallet: vi.fn(async () => wallet),
      getLoginShare: vi.fn(async () => 'gmpc1.02.login'),
      reconstructRootKeyBytes: vi.fn(async () => new Uint8Array([9, 9, 9])),
      sessionCache: { set: vi.fn() },
      ...overrides,
    };
  }

  const baseInput = { walletId: 7, idToken: fakeIdToken(), spendingPassword: 'pw' };

  it('fetches the login share for the wallet chain/network and caches the reconstructed bytes on success', async () => {
    const deps = makeDeps();
    await unlockMpcWalletFlow(baseInput, deps);

    expect(deps.getLoginShare).toHaveBeenCalledWith(baseInput.idToken, wallet.chain, wallet.network);
    expect(deps.reconstructRootKeyBytes).toHaveBeenCalledWith(
      wallet.mpcDeviceShare,
      baseInput.spendingPassword,
      'gmpc1.02.login',
      wallet.publicKey,
    );
    expect(deps.sessionCache.set).toHaveBeenCalledWith(baseInput.walletId, new Uint8Array([9, 9, 9]));
  });

  it('does NOT cache and rethrows a clean error on MpcValidationError', async () => {
    const deps = makeDeps({
      reconstructRootKeyBytes: vi.fn(async () => { throw new MpcValidationError('mismatch'); }),
    });

    await expect(unlockMpcWalletFlow(baseInput, deps)).rejects.toThrow();
    expect(deps.sessionCache.set).not.toHaveBeenCalled();
  });

  it('propagates non-validation errors without caching', async () => {
    const deps = makeDeps({
      reconstructRootKeyBytes: vi.fn(async () => { throw new Error('decrypt failed'); }),
    });

    await expect(unlockMpcWalletFlow(baseInput, deps)).rejects.toThrow('decrypt failed');
    expect(deps.sessionCache.set).not.toHaveBeenCalled();
  });

  it('throws if the wallet is not found', async () => {
    const deps = makeDeps({ getWallet: vi.fn(async () => undefined) });
    await expect(unlockMpcWalletFlow(baseInput, deps)).rejects.toThrow('MPC wallet not found');
    expect(deps.sessionCache.set).not.toHaveBeenCalled();
  });
});

describe('recoverMpcGoogleWalletFlow', () => {
  function makeDeps(overrides: Partial<RecoverMpcGoogleWalletDeps> = {}): RecoverMpcGoogleWalletDeps {
    return {
      decryptRecoveryShare: vi.fn(async () => 'gmpc1.03.recovery'),
      getLoginShare: vi.fn(async () => 'gmpc1.02.login'),
      reconstructEntropy: vi.fn(async () => new Uint8Array(32)),
      deriveExpectedXpub: vi.fn(async () => 'xpub-restored'),
      encryptDeviceShare: vi.fn((share: string, password: string) => `enc(${share},${password})`),
      createMpcGoogleWallet: vi.fn(async () => 99),
      subFromIdToken: vi.fn(() => 'google-sub-123'),
      ...overrides,
    };
  }

  const baseInput = {
    name: 'Restored Wallet',
    icon: 'icon.png',
    theme: 'dark',
    chain: 'cardano',
    network: 'mainnet',
    idToken: fakeIdToken(),
    recoveryBlob: 'gmpc-recovery1.blob',
    recoveryPassword: 'recovery-pw',
    newSpendingPassword: 'new-pw',
  };

  it('decrypts the recovery blob, fetches the login share, and reconstructs entropy from both', async () => {
    const deps = makeDeps();
    await recoverMpcGoogleWalletFlow(baseInput, deps);

    expect(deps.decryptRecoveryShare).toHaveBeenCalledWith(baseInput.recoveryBlob, baseInput.recoveryPassword);
    expect(deps.getLoginShare).toHaveBeenCalledWith(baseInput.idToken, baseInput.chain, baseInput.network);
    expect(deps.reconstructEntropy).toHaveBeenCalledWith('gmpc1.03.recovery', 'gmpc1.02.login');
  });

  it('persists the wallet using the derived xpub and the recovery share re-encrypted as the device factor', async () => {
    const deps = makeDeps();
    const result = await recoverMpcGoogleWalletFlow(baseInput, deps);

    expect(deps.encryptDeviceShare).toHaveBeenCalledWith('gmpc1.03.recovery', baseInput.newSpendingPassword);
    expect(deps.createMpcGoogleWallet).toHaveBeenCalledWith({
      name: baseInput.name,
      icon: baseInput.icon,
      theme: baseInput.theme,
      chain: baseInput.chain,
      network: baseInput.network,
      userId: 'google-sub-123',
      publicKey: 'xpub-restored',
      encryptedDeviceShare: `enc(gmpc1.03.recovery,${baseInput.newSpendingPassword})`,
    });
    expect(result).toEqual({ walletId: 99, publicKey: 'xpub-restored' });
  });

  it('does not persist a wallet if the recovery password is wrong (decrypt throws)', async () => {
    const deps = makeDeps({ decryptRecoveryShare: vi.fn(async () => { throw new Error('wrong password'); }) });
    await expect(recoverMpcGoogleWalletFlow(baseInput, deps)).rejects.toThrow('wrong password');
    expect(deps.createMpcGoogleWallet).not.toHaveBeenCalled();
  });
});
