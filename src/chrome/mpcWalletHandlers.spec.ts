import { describe, it, expect, vi } from 'vitest';
import { MpcValidationError, type DeviceShareSecret } from '@/shared/utils/mpc';
import {
  createMpcGoogleWalletFlow,
  unlockMpcWalletFlow,
  recoverMpcGoogleWalletFlow,
  storeRecoveryShareFlow,
  revealMpcSrpFlow,
  setRecoveryPasswordFlow,
  subFromIdToken,
  resolveSignPrivateKeyBytes,
  assertMpcActionSupported,
  type CreateMpcGoogleWalletDeps,
  type UnlockMpcWalletDeps,
  type RecoverMpcGoogleWalletDeps,
  type StoreRecoveryShareDeps,
  type RevealMpcSrpDeps,
  type SetRecoveryPasswordDeps,
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

  const secret: DeviceShareSecret = { kind: 'password', password: 'super-secret-password' };

  function makeDeps(overrides: Partial<CreateMpcGoogleWalletDeps> = {}): CreateMpcGoogleWalletDeps {
    return {
      prepareMpcWalletCreation: vi.fn(async () => ({ entropy: new Uint8Array(32), shareSet, expectedXpub })),
      encryptDeviceShare: vi.fn(async (deviceShare: string, s: DeviceShareSecret) => `enc(${deviceShare},${(s as { password: string }).password})`),
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
    secret,
    webAuthnCredentialId: 'cred-1',
    mpcPrfSaltId: 'salt-1',
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

  it('encrypts the device share under the secret before persisting', async () => {
    const deps = makeDeps();
    await createMpcGoogleWalletFlow(baseInput, deps);
    expect(deps.encryptDeviceShare).toHaveBeenCalledWith(shareSet.deviceShare, baseInput.secret);
  });

  it('persists the wallet record with sub as userId, the expected xpub, the encrypted device share, and the credential/salt ids', async () => {
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
      encryptedDeviceShare: `enc(${shareSet.deviceShare},${(secret as { password: string }).password})`,
      webAuthnCredentialId: 'cred-1',
      mpcPrfSaltId: 'salt-1',
    });
  });

  it('returns walletId + recoveryShare to the caller, without ever logging it', async () => {
    const deps = makeDeps();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await createMpcGoogleWalletFlow(baseInput, deps);

    expect(result).toEqual({ walletId: 42, recoveryShare: shareSet.recoveryShare, publicKey: expectedXpub });

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
  const wallet = {
    chain: 'cardano',
    network: 'mainnet',
    publicKey: 'xpub-test',
    mpcDeviceShare: 'enc-device-share',
    webAuthnCredentialId: 'cred-1',
    mpcPrfSaltId: 'salt-1',
  };

  function makeDeps(overrides: Partial<UnlockMpcWalletDeps> = {}): UnlockMpcWalletDeps {
    return {
      getWallet: vi.fn(async () => wallet),
      getLoginShare: vi.fn(async () => 'gmpc1.02.login'),
      reconstructRootKeyBytes: vi.fn(async () => new Uint8Array([9, 9, 9])),
      sessionCache: { set: vi.fn() },
      ...overrides,
    };
  }

  const secret: DeviceShareSecret = { kind: 'password', password: 'pw' };
  const baseInput = { walletId: 7, idToken: fakeIdToken(), secret };

  it('fetches the login share for the wallet chain/network and caches the reconstructed bytes on success', async () => {
    const deps = makeDeps();
    await unlockMpcWalletFlow(baseInput, deps);

    expect(deps.getLoginShare).toHaveBeenCalledWith(baseInput.idToken, wallet.chain, wallet.network);
    expect(deps.reconstructRootKeyBytes).toHaveBeenCalledWith(
      wallet.mpcDeviceShare,
      baseInput.secret,
      'gmpc1.02.login',
      wallet.publicKey,
    );
    expect(deps.sessionCache.set).toHaveBeenCalledWith(baseInput.walletId, new Uint8Array([9, 9, 9]));
  });

  it('passes the exact secret through to reconstructRootKeyBytes unchanged', async () => {
    let seenSecret: DeviceShareSecret | undefined;
    const deps = makeDeps({
      reconstructRootKeyBytes: vi.fn(async (_enc: string, sec: DeviceShareSecret) => {
        seenSecret = sec;
        return new Uint8Array([1]);
      }),
    });
    await unlockMpcWalletFlow(baseInput, deps);
    expect(seenSecret).toEqual(secret);
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
      // Fileless: the encrypted recovery blob + xpub anchor come from the backend, not a file.
      fetchRecovery: vi.fn(async () => ({ encryptedRecovery: 'gmpc-recovery1.blob', publicKey: 'xpub-anchor' })),
      decryptRecoveryShare: vi.fn(async () => 'gmpc1.03.recovery'),
      getLoginShare: vi.fn(async () => 'gmpc1.02.login'),
      // Validates internally; returns entropy on success, throws MpcValidationError on mismatch.
      reconstructAndValidateEntropy: vi.fn(async () => new Uint8Array(32)),
      encryptDeviceShare: vi.fn(async (share: string, s: DeviceShareSecret) => `enc(${share},${(s as { password: string }).password})`),
      createMpcGoogleWallet: vi.fn(async () => 99),
      subFromIdToken: vi.fn(() => 'google-sub-123'),
      ...overrides,
    };
  }

  const newSecret: DeviceShareSecret = { kind: 'password', password: 'new-pw' };

  const baseInput = {
    name: 'Restored Wallet',
    icon: 'icon.png',
    theme: 'dark',
    chain: 'cardano',
    network: 'mainnet',
    idToken: fakeIdToken(),
    recoveryPassword: 'recovery-pw',
    newSecret,
    webAuthnCredentialId: 'cred-2',
    mpcPrfSaltId: 'salt-2',
  };

  it('fetches the recovery blob+xpub from the backend, decrypts it, fetches the login share, and validates against the fetched xpub anchor', async () => {
    const deps = makeDeps();
    await recoverMpcGoogleWalletFlow(baseInput, deps);

    expect(deps.fetchRecovery).toHaveBeenCalledWith(baseInput.idToken, baseInput.chain, baseInput.network);
    expect(deps.decryptRecoveryShare).toHaveBeenCalledWith('gmpc-recovery1.blob', baseInput.recoveryPassword);
    expect(deps.getLoginShare).toHaveBeenCalledWith(baseInput.idToken, baseInput.chain, baseInput.network);
    expect(deps.reconstructAndValidateEntropy).toHaveBeenCalledWith('gmpc1.03.recovery', 'gmpc1.02.login', 'xpub-anchor');
  });

  it('persists the wallet using the backend anchor xpub, the recovery share re-encrypted as the device factor, and the credential/salt ids', async () => {
    const deps = makeDeps();
    const result = await recoverMpcGoogleWalletFlow(baseInput, deps);

    expect(deps.encryptDeviceShare).toHaveBeenCalledWith('gmpc1.03.recovery', baseInput.newSecret);
    expect(deps.createMpcGoogleWallet).toHaveBeenCalledWith({
      name: baseInput.name,
      icon: baseInput.icon,
      theme: baseInput.theme,
      chain: baseInput.chain,
      network: baseInput.network,
      userId: 'google-sub-123',
      publicKey: 'xpub-anchor',
      encryptedDeviceShare: `enc(gmpc1.03.recovery,${(newSecret as { password: string }).password})`,
      webAuthnCredentialId: 'cred-2',
      mpcPrfSaltId: 'salt-2',
    });
    expect(result).toEqual({ walletId: 99, publicKey: 'xpub-anchor' });
  });

  it('rejects and does NOT persist when the anchor validation fails (wrong Google account for this recovery)', async () => {
    const deps = makeDeps({
      reconstructAndValidateEntropy: vi.fn(async () => { throw new MpcValidationError('xpub mismatch'); }),
    });
    await expect(recoverMpcGoogleWalletFlow(baseInput, deps)).rejects.toBeInstanceOf(MpcValidationError);
    expect(deps.encryptDeviceShare).not.toHaveBeenCalled();
    expect(deps.createMpcGoogleWallet).not.toHaveBeenCalled();
  });

  it('does not persist a wallet if the recovery password is wrong (decrypt throws)', async () => {
    const deps = makeDeps({ decryptRecoveryShare: vi.fn(async () => { throw new Error('wrong password'); }) });
    await expect(recoverMpcGoogleWalletFlow(baseInput, deps)).rejects.toThrow('wrong password');
    expect(deps.getLoginShare).not.toHaveBeenCalled();
    expect(deps.createMpcGoogleWallet).not.toHaveBeenCalled();
  });

  it('propagates a 404 "no recovery on file" and writes NO state (never decrypts, never persists)', async () => {
    const deps = makeDeps({ fetchRecovery: vi.fn(async () => { throw new Error('not enrolled'); }) });
    await expect(recoverMpcGoogleWalletFlow(baseInput, deps)).rejects.toThrow('not enrolled');
    expect(deps.decryptRecoveryShare).not.toHaveBeenCalled();
    expect(deps.getLoginShare).not.toHaveBeenCalled();
    expect(deps.createMpcGoogleWallet).not.toHaveBeenCalled();
  });

  it('never logs the decrypted recovery share, the login share, or the recovery password', async () => {
    const deps = makeDeps();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await recoverMpcGoogleWalletFlow(baseInput, deps);

    for (const spy of [logSpy, errSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        const line = call.join(' ');
        expect(line).not.toContain('gmpc1.03.recovery');
        expect(line).not.toContain('gmpc1.02.login');
        expect(line).not.toContain(baseInput.recoveryPassword);
      }
    }
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe('storeRecoveryShareFlow', () => {
  const recoveryShare = 'gmpc1.03.recovery';
  const recoveryPassword = 'a-strong-recovery-passphrase';
  const blob = 'gmpc-recovery1.encrypted-blob';

  function makeDeps(overrides: Partial<StoreRecoveryShareDeps> = {}): StoreRecoveryShareDeps {
    return {
      encryptRecoveryShare: vi.fn(async (share: string, password: string) => `enc-recovery(${share},${password})`),
      storeRecovery: vi.fn(async () => ({ stored: true })),
      ...overrides,
    };
  }

  const baseInput = {
    idToken: fakeIdToken(),
    chain: 'cardano',
    network: 'mainnet',
    recoveryShare,
    recoveryPassword,
    publicKey: 'xpub-anchor',
  };

  it('encrypts the recovery share under the recovery password before uploading', async () => {
    const deps = makeDeps();
    await storeRecoveryShareFlow(baseInput, deps);
    expect(deps.encryptRecoveryShare).toHaveBeenCalledWith(recoveryShare, recoveryPassword);
  });

  it('uploads the encrypted blob with idToken/chain/network and the xpub anchor (never the plaintext share)', async () => {
    const deps = makeDeps({
      encryptRecoveryShare: vi.fn(async () => blob),
    });
    const result = await storeRecoveryShareFlow(baseInput, deps);

    expect(deps.storeRecovery).toHaveBeenCalledWith(
      baseInput.idToken,
      baseInput.chain,
      baseInput.network,
      blob,
      baseInput.publicKey,
    );
    // the plaintext recovery share is never handed to the backend
    const storeArgs = (deps.storeRecovery as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(storeArgs).not.toContain(recoveryShare);
    expect(result).toEqual({ stored: true });
  });

  it('never logs the recovery share, password, or encrypted blob', async () => {
    const deps = makeDeps({ encryptRecoveryShare: vi.fn(async () => blob) });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await storeRecoveryShareFlow(baseInput, deps);

    for (const spy of [logSpy, errSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        const line = call.join(' ');
        expect(line).not.toContain(recoveryShare);
        expect(line).not.toContain(recoveryPassword);
        expect(line).not.toContain(blob);
      }
    }
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('surfaces an upload failure by rejecting, and touches no wallet state (encrypt succeeded, only the upload failed)', async () => {
    const deps = makeDeps({
      storeRecovery: vi.fn(async () => { throw new Error('recovery upload failed'); }),
    });
    // The flow has no DB/wallet dependency at all: a rejection here cannot corrupt the
    // already-created wallet. The background handler catches this and reports it non-fatally.
    await expect(storeRecoveryShareFlow(baseInput, deps)).rejects.toThrow('recovery upload failed');
    expect(deps.encryptRecoveryShare).toHaveBeenCalledTimes(1);
  });
});

describe('revealMpcSrpFlow', () => {
  // A deterministic 32-byte entropy and its BIP39 mnemonic are irrelevant to the
  // unit under test — the flow delegates entropy→mnemonic to an injected dep — so
  // we use sentinel values and assert wiring, not bip39 correctness.
  const KNOWN_ENTROPY = new Uint8Array(32).fill(7);
  const KNOWN_MNEMONIC = 'abandon abandon ability';

  const wallet = {
    chain: 'cardano',
    network: 'mainnet',
    publicKey: 'xpub-test',
    mpcDeviceShare: 'enc-device-share',
    webAuthnCredentialId: 'cred-1',
    mpcPrfSaltId: 'salt-1',
  };

  function makeDeps(overrides: Partial<RevealMpcSrpDeps> = {}): RevealMpcSrpDeps {
    return {
      getWallet: vi.fn(async () => wallet),
      getLoginShare: vi.fn(async () => 'gmpc1.02.login'),
      decryptDeviceShare: vi.fn(async () => 'gmpc1.01.device'),
      // Returns entropy on success; throws MpcValidationError on xpub mismatch.
      reconstructAndValidateEntropy: vi.fn(async () => KNOWN_ENTROPY),
      entropyToMnemonic: vi.fn(() => KNOWN_MNEMONIC),
      ...overrides,
    };
  }

  const secret: DeviceShareSecret = { kind: 'password', password: 'device-secret' };
  const baseInput = { walletId: 7, idToken: fakeIdToken(), secret };

  it('reconstructs entropy from device+login and returns the mnemonic for known entropy', async () => {
    const deps = makeDeps();
    const result = await revealMpcSrpFlow(baseInput, deps);

    expect(deps.getLoginShare).toHaveBeenCalledWith(baseInput.idToken, wallet.chain, wallet.network);
    expect(deps.decryptDeviceShare).toHaveBeenCalledWith(wallet.mpcDeviceShare, baseInput.secret);
    expect(deps.reconstructAndValidateEntropy).toHaveBeenCalledWith('gmpc1.01.device', 'gmpc1.02.login', wallet.publicKey);
    expect(deps.entropyToMnemonic).toHaveBeenCalledWith(KNOWN_ENTROPY);
    expect(result).toEqual({ mnemonic: KNOWN_MNEMONIC });
  });

  it('requires the device secret: passes the exact secret through to decryptDeviceShare unchanged', async () => {
    let seenSecret: DeviceShareSecret | undefined;
    const deps = makeDeps({
      decryptDeviceShare: vi.fn(async (_enc: string, sec: DeviceShareSecret) => {
        seenSecret = sec;
        return 'gmpc1.01.device';
      }),
    });
    await revealMpcSrpFlow(baseInput, deps);
    expect(seenSecret).toEqual(secret);
  });

  it('response omits entropy and any share material — mnemonic is the only key', async () => {
    const deps = makeDeps();
    const result = await revealMpcSrpFlow(baseInput, deps);

    expect(Object.keys(result)).toEqual(['mnemonic']);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('gmpc1.01.device'); // device share
    expect(serialized).not.toContain('gmpc1.02.login');  // login share
    expect(serialized).not.toContain('7,7,7');            // entropy bytes
  });

  it('never logs the mnemonic or any share material', async () => {
    const deps = makeDeps();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await revealMpcSrpFlow(baseInput, deps);

    for (const spy of [logSpy, errSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        const joined = call.join(' ');
        expect(joined).not.toContain(KNOWN_MNEMONIC);
        expect(joined).not.toContain('gmpc1.01.device');
        expect(joined).not.toContain('gmpc1.02.login');
      }
    }
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('throws a clean error and returns no mnemonic on MpcValidationError (shares mismatch)', async () => {
    const deps = makeDeps({
      reconstructAndValidateEntropy: vi.fn(async () => { throw new MpcValidationError('mismatch'); }),
    });
    await expect(revealMpcSrpFlow(baseInput, deps)).rejects.toThrow();
    expect(deps.entropyToMnemonic).not.toHaveBeenCalled();
  });

  it('throws if the wallet is not found and never touches crypto', async () => {
    const deps = makeDeps({ getWallet: vi.fn(async () => undefined) });
    await expect(revealMpcSrpFlow(baseInput, deps)).rejects.toThrow('MPC wallet not found');
    expect(deps.decryptDeviceShare).not.toHaveBeenCalled();
    expect(deps.entropyToMnemonic).not.toHaveBeenCalled();
  });
});

describe('resolveSignPrivateKeyBytes', () => {
  const cacheWith = (entries: Record<number, Uint8Array>) => ({
    get: (id: number) => entries[id],
  });

  it('(a) passes explicit bytes straight through regardless of wallet type', () => {
    const explicit = new Uint8Array([1, 2, 3]);
    // PRF wallet with explicit bytes → unchanged
    expect(resolveSignPrivateKeyBytes({ id: 1, encryptionMethod: 'prf' }, explicit, cacheWith({}))).toBe(explicit);
    // even an mpc wallet: explicit bytes win, cache is not consulted
    expect(resolveSignPrivateKeyBytes({ id: 1, encryptionMethod: 'mpc' }, explicit, cacheWith({}))).toBe(explicit);
  });

  it('(b) mpc wallet with no explicit bytes returns the cached bytes', () => {
    const cached = new Uint8Array([9, 9, 9]);
    const out = resolveSignPrivateKeyBytes({ id: 7, encryptionMethod: 'mpc' }, undefined, cacheWith({ 7: cached }));
    expect(out).toBe(cached);
  });

  it('(c) mpc wallet with an empty cache throws a clean unlock error', () => {
    expect(() =>
      resolveSignPrivateKeyBytes({ id: 7, encryptionMethod: 'mpc' }, undefined, cacheWith({})),
    ).toThrow(/unlocked with Google/);
  });

  it('(d) non-mpc wallet with no explicit bytes returns undefined (password path unchanged)', () => {
    expect(resolveSignPrivateKeyBytes({ id: 1, encryptionMethod: 'password' }, undefined, cacheWith({}))).toBeUndefined();
    expect(resolveSignPrivateKeyBytes({ id: 1, encryptionMethod: 'prf' }, undefined, cacheWith({}))).toBeUndefined();
    expect(resolveSignPrivateKeyBytes(null, undefined, cacheWith({}))).toBeUndefined();
    expect(resolveSignPrivateKeyBytes(undefined, undefined, cacheWith({}))).toBeUndefined();
  });
});

describe('assertMpcActionSupported', () => {
  it('throws a clean error for mpc wallets', () => {
    expect(() => assertMpcActionSupported({ encryptionMethod: 'mpc' }, 'Bitcoin signing'))
      .toThrow(/not yet supported for Bitcoin signing/);
  });

  it('is a no-op for non-mpc wallets and undefined', () => {
    expect(() => assertMpcActionSupported({ encryptionMethod: 'password' }, 'Bitcoin signing')).not.toThrow();
    expect(() => assertMpcActionSupported({ encryptionMethod: 'prf' }, 'Bitcoin signing')).not.toThrow();
    expect(() => assertMpcActionSupported(null, 'Bitcoin signing')).not.toThrow();
    expect(() => assertMpcActionSupported(undefined, 'Bitcoin signing')).not.toThrow();
  });
});

describe('setRecoveryPasswordFlow', () => {
  // A DISTINCT fresh split S' — all three shares differ from any prior split,
  // proving the flow re-splits rather than re-wrapping the old recovery share.
  const freshSplit = {
    deviceShare: 'gmpc1.01.deviceNEW',
    loginShare: 'gmpc1.02.loginNEW',
    recoveryShare: 'gmpc1.03.recoveryNEW',
  };

  const wallet = {
    chain: 'cardano',
    network: 'mainnet',
    publicKey: 'xpub-test',
    mpcDeviceShare: 'enc-device-share-OLD',
  };

  const secret: DeviceShareSecret = { kind: 'password', password: 'device-pw' };

  function makeDeps(
    order: string[],
    overrides: Partial<SetRecoveryPasswordDeps> = {},
  ): SetRecoveryPasswordDeps {
    return {
      getWallet: vi.fn(async () => wallet),
      getLoginShare: vi.fn(async () => 'gmpc1.02.loginOLD'),
      decryptDeviceShare: vi.fn(async () => 'gmpc1.01.deviceOLD'),
      // Reconstructs + validates the CURRENT device+login → entropy of THIS wallet.
      reconstructAndValidateEntropy: vi.fn(async () => new Uint8Array(32)),
      createMpcShareSet: vi.fn(async () => freshSplit),
      encryptDeviceShare: vi.fn(async (share: string) => `encDev(${share})`),
      encryptRecoveryShare: vi.fn(async (share: string, pw: string) => `encRec(${share},${pw})`),
      setMpcDeviceShareNext: vi.fn(async (_id: number, v: string | undefined) => {
        order.push(v === undefined ? 'dropNext' : 'stageNext');
      }),
      rotate: vi.fn(async () => { order.push('rotate'); return { rotated: true }; }),
      promoteMpcDeviceShareNext: vi.fn(async () => { order.push('promote'); }),
      storeRecovery: vi.fn(async () => { order.push('storeRecovery'); return { stored: true }; }),
      clearLoginShareCache: vi.fn(async () => { order.push('clearCache'); }),
      ...overrides,
    };
  }

  const baseInput = {
    walletId: 7,
    idToken: fakeIdToken(),
    newRecoveryPassword: 'a-brand-new-strong-password',
    secret,
  };

  it('reconstructs from the CURRENT device+login and NEVER asks the old recovery password', async () => {
    const order: string[] = [];
    const deps = makeDeps(order);
    await setRecoveryPasswordFlow(baseInput, deps);

    // Old device share is decrypted with the re-auth device secret …
    expect(deps.decryptDeviceShare).toHaveBeenCalledWith(wallet.mpcDeviceShare, secret);
    // … and the login share for THIS wallet's chain/network is fetched.
    expect(deps.getLoginShare).toHaveBeenCalledWith(baseInput.idToken, wallet.chain, wallet.network);
    // Entropy comes from device+login only — no old recovery password anywhere.
    expect(deps.reconstructAndValidateEntropy).toHaveBeenCalledWith(
      'gmpc1.01.deviceOLD',
      'gmpc1.02.loginOLD',
      wallet.publicKey,
    );
    // The input carries NO old-password field.
    expect('oldRecoveryPassword' in baseInput).toBe(false);
  });

  it('re-splits the same entropy: all three NEW shares come from one fresh split', async () => {
    const order: string[] = [];
    const deps = makeDeps(order);
    await setRecoveryPasswordFlow(baseInput, deps);

    // Fresh split off the reconstructed entropy.
    expect(deps.createMpcShareSet).toHaveBeenCalledWith(new Uint8Array(32));
    // Corrupt-split guard: the fresh S' is validated against the wallet xpub before rotate.
    expect(deps.reconstructAndValidateEntropy).toHaveBeenCalledWith(freshSplit.deviceShare, freshSplit.loginShare, wallet.publicKey);
    // Device factor = S'.device (staged as next).
    expect(deps.encryptDeviceShare).toHaveBeenCalledWith(freshSplit.deviceShare, secret);
    expect(deps.setMpcDeviceShareNext).toHaveBeenCalledWith(baseInput.walletId, `encDev(${freshSplit.deviceShare})`);
    // Login factor = S'.login (rotated on the backend).
    expect(deps.rotate).toHaveBeenCalledWith(baseInput.idToken, wallet.chain, wallet.network, freshSplit.loginShare);
    // Recovery factor = S'.recovery, encrypted under the NEW password + xpub anchor.
    expect(deps.encryptRecoveryShare).toHaveBeenCalledWith(freshSplit.recoveryShare, baseInput.newRecoveryPassword);
    expect(deps.storeRecovery).toHaveBeenCalledWith(
      baseInput.idToken,
      wallet.chain,
      wallet.network,
      `encRec(${freshSplit.recoveryShare},${baseInput.newRecoveryPassword})`,
      wallet.publicKey,
    );
  });

  it('runs the crash-safe order exactly: stage-next → rotate → promote → store-recovery → clear-cache', async () => {
    const order: string[] = [];
    const deps = makeDeps(order);
    await setRecoveryPasswordFlow(baseInput, deps);
    expect(order).toEqual(['stageNext', 'rotate', 'promote', 'storeRecovery', 'clearCache']);
  });

  it('rolls back on backend-rotate failure: drops the staged next, never promotes/stores/clears, stays on old split', async () => {
    const order: string[] = [];
    const deps = makeDeps(order, {
      rotate: vi.fn(async () => { order.push('rotate'); throw new Error('backend 503'); }),
    });

    await expect(setRecoveryPasswordFlow(baseInput, deps)).rejects.toThrow('backend 503');

    // Staged then dropped; nothing past rotate ran.
    expect(order).toEqual(['stageNext', 'rotate', 'dropNext']);
    expect(deps.setMpcDeviceShareNext).toHaveBeenNthCalledWith(1, baseInput.walletId, `encDev(${freshSplit.deviceShare})`);
    expect(deps.setMpcDeviceShareNext).toHaveBeenNthCalledWith(2, baseInput.walletId, undefined);
    expect(deps.promoteMpcDeviceShareNext).not.toHaveBeenCalled();
    expect(deps.storeRecovery).not.toHaveBeenCalled();
    expect(deps.clearLoginShareCache).not.toHaveBeenCalled();
  });

  it('stores the recovery blob LAST (only once S\' is fully live)', async () => {
    const order: string[] = [];
    const deps = makeDeps(order);
    await setRecoveryPasswordFlow(baseInput, deps);
    expect(order.indexOf('storeRecovery')).toBeGreaterThan(order.indexOf('promote'));
    expect(order.indexOf('storeRecovery')).toBeGreaterThan(order.indexOf('rotate'));
  });

  it('throws (and writes nothing) if the wallet is not found', async () => {
    const order: string[] = [];
    const deps = makeDeps(order, { getWallet: vi.fn(async () => undefined) });
    await expect(setRecoveryPasswordFlow(baseInput, deps)).rejects.toThrow('MPC wallet not found');
    expect(deps.setMpcDeviceShareNext).not.toHaveBeenCalled();
    expect(deps.rotate).not.toHaveBeenCalled();
  });

  it('corrupt-split guard: throws BEFORE any stage/rotate if the fresh split does not re-derive wallet.publicKey', async () => {
    const order: string[] = [];
    // 1st reconstructAndValidateEntropy call (current device+login) validates OK;
    // 2nd call (fresh S'.device + S'.login) → MpcValidationError → corrupt split.
    let call = 0;
    const deps = makeDeps(order, {
      reconstructAndValidateEntropy: vi.fn(async () => {
        call += 1;
        if (call === 1) return new Uint8Array(32); // current split validates
        throw new MpcValidationError('fresh split derives a different key');
      }),
    });

    await expect(setRecoveryPasswordFlow(baseInput, deps)).rejects.toBeInstanceOf(MpcValidationError);

    // Guard fired before anything destructive — no stage, no rotate to a bad login share.
    expect(deps.setMpcDeviceShareNext).not.toHaveBeenCalled();
    expect(deps.rotate).not.toHaveBeenCalled();
    expect(deps.promoteMpcDeviceShareNext).not.toHaveBeenCalled();
    expect(deps.storeRecovery).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it('never logs the new password, the shares, or the entropy', async () => {
    const order: string[] = [];
    const deps = makeDeps(order);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await setRecoveryPasswordFlow(baseInput, deps);

    for (const spy of [logSpy, errSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        const line = call.join(' ');
        expect(line).not.toContain(baseInput.newRecoveryPassword);
        expect(line).not.toContain(freshSplit.deviceShare);
        expect(line).not.toContain(freshSplit.loginShare);
        expect(line).not.toContain(freshSplit.recoveryShare);
      }
    }
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe('unlockMpcWalletFlow — resume-on-unlock (staged deviceShareNext)', () => {
  const secret: DeviceShareSecret = { kind: 'password', password: 'pw' };
  const baseInput = { walletId: 7, idToken: fakeIdToken(), secret };

  const walletWithNext = {
    chain: 'cardano',
    network: 'mainnet',
    publicKey: 'xpub-test',
    mpcDeviceShare: 'enc-device-OLD',
    mpcDeviceShareNext: 'enc-device-NEXT',
  };

  it('resumes a crashed re-split: primary device+login fails but next+login succeeds → promotes next, caches bytes', async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const reconstruct = vi.fn(async (encDeviceShare: string) => {
      // Post-rotate crash state: OLD device + NEW login → xpub mismatch.
      if (encDeviceShare === walletWithNext.mpcDeviceShare) throw new MpcValidationError('mismatch');
      // Staged next + NEW login → correct entropy.
      return bytes;
    });
    const deps: UnlockMpcWalletDeps = {
      getWallet: vi.fn(async () => walletWithNext),
      getLoginShare: vi.fn(async () => 'gmpc1.02.loginNEW'),
      reconstructRootKeyBytes: reconstruct,
      sessionCache: { set: vi.fn() },
      promoteMpcDeviceShareNext: vi.fn(async () => {}),
    };

    await unlockMpcWalletFlow(baseInput, deps);

    expect(reconstruct).toHaveBeenNthCalledWith(1, walletWithNext.mpcDeviceShare, secret, 'gmpc1.02.loginNEW', walletWithNext.publicKey);
    expect(reconstruct).toHaveBeenNthCalledWith(2, walletWithNext.mpcDeviceShareNext, secret, 'gmpc1.02.loginNEW', walletWithNext.publicKey);
    expect(deps.promoteMpcDeviceShareNext).toHaveBeenCalledWith(baseInput.walletId);
    expect(deps.sessionCache.set).toHaveBeenCalledWith(baseInput.walletId, bytes);
  });

  it('does NOT drop the staged next when the PRIMARY device+login reconstruct succeeds (brick guard: a stale-cached-login success must not destroy S\'.device)', async () => {
    // Scenario #1 from the review: primary reconstruct succeeds only because a STALE
    // login share (S.login) survived in chrome.storage.session. The staged S'.device
    // is the ONLY device share compatible with the live (rotated) backend login — it
    // must survive. There is no destructive drop mechanism in the unlock deps at all,
    // so success simply caches and returns without promoting or touching next.
    const bytes = new Uint8Array([7, 7, 7]);
    const deps: UnlockMpcWalletDeps = {
      getWallet: vi.fn(async () => walletWithNext),
      getLoginShare: vi.fn(async () => 'gmpc1.02.login'),
      reconstructRootKeyBytes: vi.fn(async () => bytes),
      sessionCache: { set: vi.fn() },
      promoteMpcDeviceShareNext: vi.fn(async () => {}),
    };

    await unlockMpcWalletFlow(baseInput, deps);

    // reconstruct is called ONCE (primary only); next is never tried, never promoted.
    expect(deps.reconstructRootKeyBytes).toHaveBeenCalledTimes(1);
    expect(deps.promoteMpcDeviceShareNext).not.toHaveBeenCalled();
    expect(deps.sessionCache.set).toHaveBeenCalledWith(baseInput.walletId, bytes);
  });

  it('does NOT drop the staged next and rethrows a clean error when neither device nor next reconstructs (MpcValidationError)', async () => {
    const deps: UnlockMpcWalletDeps = {
      getWallet: vi.fn(async () => walletWithNext),
      getLoginShare: vi.fn(async () => 'gmpc1.02.loginX'),
      reconstructRootKeyBytes: vi.fn(async () => { throw new MpcValidationError('mismatch'); }),
      sessionCache: { set: vi.fn() },
      promoteMpcDeviceShareNext: vi.fn(async () => {}),
    };

    await expect(unlockMpcWalletFlow(baseInput, deps)).rejects.toThrow();
    expect(deps.promoteMpcDeviceShareNext).not.toHaveBeenCalled();
    expect(deps.sessionCache.set).not.toHaveBeenCalled();
  });

  it('resume path: next+login throws a non-validation (decrypt) error → next NOT dropped, promote not called, unlock fails cleanly (scenario #2 brick guard)', async () => {
    // Primary (OLD device + rotated login) → xpub mismatch. Staged next reconstruct
    // then throws a decrypt error (e.g. wrong spending password). The staged S'.device
    // must survive so a later correct-secret retry can still promote it.
    const reconstruct = vi.fn(async (encDeviceShare: string) => {
      if (encDeviceShare === walletWithNext.mpcDeviceShare) throw new MpcValidationError('mismatch');
      throw new Error('decrypt failed'); // staged next, wrong device secret
    });
    const deps: UnlockMpcWalletDeps = {
      getWallet: vi.fn(async () => walletWithNext),
      getLoginShare: vi.fn(async () => 'gmpc1.02.loginNEW'),
      reconstructRootKeyBytes: reconstruct,
      sessionCache: { set: vi.fn() },
      promoteMpcDeviceShareNext: vi.fn(async () => {}),
    };

    await expect(unlockMpcWalletFlow(baseInput, deps)).rejects.toThrow();
    expect(deps.promoteMpcDeviceShareNext).not.toHaveBeenCalled();
    expect(deps.sessionCache.set).not.toHaveBeenCalled();
  });
});
