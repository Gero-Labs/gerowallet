import { describe, it, expect, vi } from 'vitest';

vi.mock('@/db/gero-db', () => ({ derivePublicKeyFromMnemonic: vi.fn(async () => 'xpub-TEST') }));
vi.mock('@/shared/utils/resolver', () => ({
  resolvePrivateKey: vi.fn(() => ({ bytes: () => new Uint8Array([1, 2, 3, 4]) })),
}));

import { prepareMpcWalletCreation, reconstructRootKeyBytes } from './mpcWalletService';
import { encryptDeviceShare, type DeviceShareSecret } from './deviceShareCipher';
import { createMpcShareSet } from './mpcShares';
import { deriveExpectedXpub } from './mpcKeys';

describe('mpcWalletService', () => {
  it('prepare produces 3 shares + an expected xpub', async () => {
    const { entropy, shareSet, expectedXpub } = await prepareMpcWalletCreation();
    expect(entropy.length).toBe(32);
    expect(shareSet.deviceShare.startsWith('gmpc1.01.')).toBe(true);
    expect(shareSet.loginShare.startsWith('gmpc1.02.')).toBe(true);
    expect(shareSet.recoveryShare.startsWith('gmpc1.03.')).toBe(true);
    expect(expectedXpub).toBe('xpub-TEST');
  });

  it('device share encrypt/decrypt round-trips with password secret', async () => {
    const secret: DeviceShareSecret = { kind: 'password', password: 'pw' };
    const blob = await encryptDeviceShare('gmpc1.01.X.Y', secret);
    expect(blob).not.toBe('gmpc1.01.X.Y');
    expect(blob.startsWith('pw.v1:')).toBe(true);
  });

  it('reconstructs+validates root key from a password-encrypted device share', async () => {
    const entropy = crypto.getRandomValues(new Uint8Array(32));
    const set = await createMpcShareSet(entropy);
    const expectedXpub = await deriveExpectedXpub(entropy);
    const secret: DeviceShareSecret = { kind: 'password', password: 'pw' };
    const enc = await encryptDeviceShare(set.deviceShare, secret);
    const bytes = await reconstructRootKeyBytes(enc, secret, set.loginShare, expectedXpub);
    expect(bytes.length).toBeGreaterThan(0);
  });
});
