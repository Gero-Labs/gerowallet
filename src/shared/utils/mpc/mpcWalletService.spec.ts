import { describe, it, expect, vi } from 'vitest';

vi.mock('@/db/gero-db', () => ({ derivePublicKeyFromMnemonic: vi.fn(async () => 'xpub-TEST') }));
vi.mock('@/shared/utils/resolver', () => ({
  resolvePrivateKey: vi.fn(() => ({ bytes: () => new Uint8Array([1, 2, 3, 4]) })),
}));

import { prepareMpcWalletCreation, encryptDeviceShare, decryptDeviceShare, reconstructRootKeyBytes } from './mpcWalletService';

describe('mpcWalletService', () => {
  it('prepare produces 3 shares + an expected xpub', async () => {
    const { entropy, shareSet, expectedXpub } = await prepareMpcWalletCreation();
    expect(entropy.length).toBe(32);
    expect(shareSet.deviceShare.startsWith('gmpc1.01.')).toBe(true);
    expect(shareSet.loginShare.startsWith('gmpc1.02.')).toBe(true);
    expect(shareSet.recoveryShare.startsWith('gmpc1.03.')).toBe(true);
    expect(expectedXpub).toBe('xpub-TEST');
  });

  it('device share encrypt/decrypt round-trips', () => {
    const blob = encryptDeviceShare('gmpc1.01.X.Y', 'pw');
    expect(blob).not.toBe('gmpc1.01.X.Y');
    expect(decryptDeviceShare(blob, 'pw')).toBe('gmpc1.01.X.Y');
  });

  it('reconstructRootKeyBytes validates then returns root-key bytes', async () => {
    const { shareSet, expectedXpub } = await prepareMpcWalletCreation();
    const encDevice = encryptDeviceShare(shareSet.deviceShare, 'pw');
    const bytes = await reconstructRootKeyBytes(encDevice, 'pw', shareSet.loginShare, expectedXpub);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]); // from mocked resolvePrivateKey
  });
});
