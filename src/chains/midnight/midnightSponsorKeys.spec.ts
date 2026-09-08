import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Blockchain } from '@/models/types';
import type { Wallet } from '@/models/types';

const decrypt = vi.fn();
const decryptMnemonicWithPrfOutput = vi.fn();
const deriveMidnightKeys = vi.fn();

vi.mock('@/shared/utils/crypto', () => ({ decrypt: (...a: unknown[]) => decrypt(...a) }));
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
    expect(decrypt).toHaveBeenCalledWith('sponsor-blob', 'sponsor-pw');
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

  it('propagates a wrong-credential failure so the UI can say so', async () => {
    decrypt.mockImplementation(() => { throw new Error('Malformed UTF-8 data'); });
    await expect(deriveSponsorDustSeed(
      { sponsor: wallet(), network: 'Mainnet', credential: { password: 'wrong' } },
      SENDER_ID,
    )).rejects.toThrow(/Malformed UTF-8 data/);
  });
});
