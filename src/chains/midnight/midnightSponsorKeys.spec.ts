import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Blockchain, WalletType } from '@/models/types';
import type { Wallet } from '@/models/types';
import { SecretPurpose } from '@/shared/utils/secretEnvelope';

const decrypt = vi.fn();
const decryptMnemonicWithPrfOutput = vi.fn();
const deriveMidnightKeys = vi.fn();

vi.mock('@/shared/utils/crypto', async () => ({
  decrypt: (...a: unknown[]) => decrypt(...a),
  SecretPurpose: (await import('@/shared/utils/secretEnvelope')).SecretPurpose,
}));
vi.mock('@/shared/utils/webauthn-prf', () => ({
  decryptMnemonicWithPrfOutput: (...a: unknown[]) => decryptMnemonicWithPrfOutput(...a),
}));
vi.mock('./midnightKeyManager', () => ({
  deriveMidnightKeys: (...a: unknown[]) => deriveMidnightKeys(...a),
}));

const {
  assertSponsorEligible,
  deriveSponsorDustSeed,
  SponsorNotEligibleError,
} = await import('./midnightSponsorKeys');

const SENDER_ID = 1;

function wallet(over: Partial<Wallet> = {}): Wallet {
  return {
    id: 2,
    name: 'Savings',
    chain: Blockchain.MIDNIGHT,
    network: 'Mainnet',
    encryptionMethod: 'password',
    encryptedMnemonic: 'enc',
    ...over,
  } as unknown as Wallet;
}

const DUST_SEED = new Uint8Array([1, 2, 3]);
const NIGHT_KEY = new Uint8Array([9, 9, 9]);

beforeEach(() => {
  vi.clearAllMocks();
  decrypt.mockReturnValue('mnemonic words');
  decryptMnemonicWithPrfOutput.mockResolvedValue('mnemonic words');
  deriveMidnightKeys.mockResolvedValue({
    dustSecretKey: DUST_SEED,
    unshieldedSecretKey: NIGHT_KEY,
    zswapViewingKey: 'viewing-key',
  });
});

describe('assertSponsorEligible', () => {
  it('rejects a non-Midnight wallet', () => {
    expect(() => assertSponsorEligible(wallet({ chain: Blockchain.CARDANO }), 'Mainnet', SENDER_ID))
      .toThrow(SponsorNotEligibleError);
  });

  it('rejects a cross-network sponsor', () => {
    // DUST is per-network; a mainnet fee cannot pay for a preprod transaction.
    expect(() => assertSponsorEligible(wallet({ network: 'Preprod' }), 'Mainnet', SENDER_ID))
      .toThrow(/network-mismatch/);
  });

  it('rejects the sending wallet sponsoring itself', () => {
    expect(() => assertSponsorEligible(wallet({ id: SENDER_ID }), 'Mainnet', SENDER_ID))
      .toThrow(/same-wallet/);
  });

  it('accepts a same-network Midnight wallet that is not the sender', () => {
    expect(() => assertSponsorEligible(wallet(), 'Mainnet', SENDER_ID)).not.toThrow();
  });
});

describe('deriveSponsorDustSeed', () => {
  it('returns ONLY the dust seed, never the signing key', async () => {
    // The security property: a sponsor authorises a fee, not a transfer. If
    // the NightExternal key ever escaped this function it could sign the
    // sponsor's own inputs.
    const seed = await deriveSponsorDustSeed(
      { sponsor: wallet(), network: 'Mainnet', credential: { password: 'pw' } },
      SENDER_ID,
    );
    expect(seed).toBe(DUST_SEED);
    expect(seed).not.toBe(NIGHT_KEY);
  });

  it("decrypts with the SPONSOR's own credential", async () => {
    await deriveSponsorDustSeed(
      { sponsor: wallet({ encryptedMnemonic: 'sponsor-blob' }), network: 'Mainnet', credential: { password: 'sponsor-pw' } },
      SENDER_ID,
    );
    expect(decrypt).toHaveBeenCalledWith('sponsor-blob', 'sponsor-pw', SecretPurpose.Mnemonic);
  });

  it('derives against the sponsor network and skips Cardano material', async () => {
    await deriveSponsorDustSeed(
      { sponsor: wallet(), network: 'Mainnet', credential: { password: 'pw' } },
      SENDER_ID,
    );
    expect(deriveMidnightKeys).toHaveBeenCalledWith('mnemonic words', 'Mainnet', 0, { skipCardano: true });
  });

  it('uses the PRF path for a PassKey sponsor', async () => {
    await deriveSponsorDustSeed(
      {
        sponsor: wallet({
          encryptionMethod: 'prf',
          prfEncryptedMnemonic: 'prf-blob',
          webAuthnCredentialId: 'cred-id',
          encryptedMnemonic: undefined,
        }),
        network: 'Mainnet',
        credential: { prfSecret: new Uint8Array([7]) },
      },
      SENDER_ID,
    );
    expect(decryptMnemonicWithPrfOutput).toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('refuses a password wallet with no password, without touching crypto', async () => {
    await expect(deriveSponsorDustSeed(
      { sponsor: wallet(), network: 'Mainnet', credential: {} },
      SENDER_ID,
    )).rejects.toThrow(/missing-credential/);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('refuses a PassKey wallet with no PRF secret', async () => {
    await expect(deriveSponsorDustSeed(
      {
        sponsor: wallet({ encryptionMethod: 'prf', prfEncryptedMnemonic: 'b', webAuthnCredentialId: 'c' }),
        network: 'Mainnet',
        credential: { password: 'wrong-kind' },
      },
      SENDER_ID,
    )).rejects.toThrow(/missing-credential/);
    expect(decryptMnemonicWithPrfOutput).not.toHaveBeenCalled();
  });

  it('enforces eligibility BEFORE decrypting anything', async () => {
    // An ineligible sponsor must never reach the mnemonic. Checking after
    // decryption would mean a cross-network mistake still exposed the key.
    await expect(deriveSponsorDustSeed(
      { sponsor: wallet({ network: 'Preprod' }), network: 'Mainnet', credential: { password: 'pw' } },
      SENDER_ID,
    )).rejects.toThrow(/network-mismatch/);
    expect(decrypt).not.toHaveBeenCalled();
    expect(deriveMidnightKeys).not.toHaveBeenCalled();
  });

  describe('an added account (issue 1330)', () => {
    // Account #1 of the wallet whose account #0 is record 2: the background hands it
    // over with its account #0's secrets (withGroupSecrets).
    const added = (unshielded: string) => wallet({
      id: 3,
      type: WalletType.Normal,
      accountIndex: 1,
      parentWalletId: 2,
      secretsWalletId: 2,
      encryptionMethod: 'prf',
      prfEncryptedMnemonic: 'prf-blob',
      webAuthnCredentialId: 'cred-id',
      encryptedMnemonic: undefined,
      publicKey: JSON.stringify({ unshielded }),
    } as Partial<Wallet>);
    const keys = (unshielded: string) => ({
      dustSecretKey: new Uint8Array([1, 2, 3]),
      unshieldedSecretKey: new Uint8Array([9, 9, 9]),
      zswapSecretKey: new Uint8Array([4, 4]),
      seed: new Uint8Array([5, 5]),
      addresses: { unshielded },
    });

    it('decrypts with its account #0\'s PassKey salt and derives its own account', async () => {
      deriveMidnightKeys.mockResolvedValue(keys('mn_addr1one'));

      const seed = await deriveSponsorDustSeed(
        { sponsor: added('mn_addr1one'), network: 'Mainnet', credential: { prfSecret: new Uint8Array([7]) } },
        SENDER_ID,
      );

      expect(decryptMnemonicWithPrfOutput).toHaveBeenCalledWith('prf-blob', expect.any(Uint8Array), 'cred-id', '2');
      expect(deriveMidnightKeys).toHaveBeenCalledWith('mnemonic words', 'Mainnet', 1, { skipCardano: true });
      expect(seed).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('refuses one whose phrase does not derive its address, and wipes what it derived', async () => {
      const derived = keys('mn_addr1two');
      deriveMidnightKeys.mockResolvedValue(derived);

      await expect(deriveSponsorDustSeed(
        { sponsor: added('mn_addr1one'), network: 'Mainnet', credential: { prfSecret: new Uint8Array([7]) } },
        SENDER_ID,
      )).rejects.toThrow('does not belong to this account');
      for (const bytes of [derived.dustSecretKey, derived.unshieldedSecretKey, derived.zswapSecretKey, derived.seed]) {
        expect(bytes.every((byte) => byte === 0)).toBe(true);
      }
    });
  });

  it('propagates a wrong-credential failure so the UI can say so', async () => {
    decrypt.mockImplementation(() => { throw new Error('Malformed UTF-8 data'); });
    await expect(deriveSponsorDustSeed(
      { sponsor: wallet(), network: 'Mainnet', credential: { password: 'wrong' } },
      SENDER_ID,
    )).rejects.toThrow(/Malformed UTF-8 data/);
  });
});
