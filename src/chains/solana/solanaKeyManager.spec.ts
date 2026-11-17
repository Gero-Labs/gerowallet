import { describe, expect, it } from 'vitest';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import {
  deriveSolanaAddressFromMnemonic,
  deriveSolanaKeypairFromMnemonic,
  isOnCurveSolanaAddress,
  isValidSolanaAddress,
  slip10DeriveEd25519,
  solanaAddressToBytes,
} from './solanaKeyManager';
import { base58Decode, base58Encode } from './solanaBase58';
import { solanaAccountPath, solanaAccountPathIndexes, HARDENED_OFFSET } from './solanaPaths';

// Fixed test phrases — never used to hold funds.
const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const LEGAL = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

describe('solanaPaths', () => {
  it('uses m/44\'/501\'/n\'/0\', all hardened', () => {
    expect(solanaAccountPath(0)).toBe("m/44'/501'/0'/0'");
    expect(solanaAccountPath(3)).toBe("m/44'/501'/3'/0'");
    expect(solanaAccountPathIndexes(1)).toEqual([44, 501, 1, 0].map((i) => i + HARDENED_OFFSET));
  });

  it('rejects bad account indexes', () => {
    expect(() => solanaAccountPath(-1)).toThrow();
    expect(() => solanaAccountPath(1.5)).toThrow();
    expect(() => solanaAccountPath(HARDENED_OFFSET)).toThrow();
  });
});

describe('SLIP-0010 ed25519 (spec test vector 1)', () => {
  const seed = hexToBytes('000102030405060708090a0b0c0d0e0f');

  it('master key', () => {
    expect(bytesToHex(slip10DeriveEd25519(seed, []))).toBe('2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7');
  });

  it("m/0'", () => {
    expect(bytesToHex(slip10DeriveEd25519(seed, [HARDENED_OFFSET]))).toBe('68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3');
  });

  it('refuses non-hardened indexes', () => {
    expect(() => slip10DeriveEd25519(seed, [0])).toThrow(/hardened/);
  });
});

describe('Solana account keys', () => {
  // Reference addresses from `solana-keygen pubkey "prompt://?key=<n>/0"` (Agave 3.1.10),
  // which derives m/44'/501'/n'/0' like Phantom and Solflare.
  it.each([
    [ABANDON, 0, 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk'],
    [ABANDON, 1, 'Hh8QwFUA6MtVu1qAoq12ucvFHNwCcVTV7hpWjeY1Hztb'],
    [LEGAL, 0, 'BLeUXTx9thHGT7VJUtF9vHEmfMDgW1nnKZ9UVer2CoLX'],
  ])('derives the reference address (%#)', (phrase, account, address) => {
    expect(deriveSolanaAddressFromMnemonic(phrase, account)).toBe(address);
  });

  it('keypair public key encodes to the address', () => {
    const kp = deriveSolanaKeypairFromMnemonic(ABANDON, 0);
    expect(kp.secretKey).toHaveLength(32);
    expect(base58Encode(kp.publicKey)).toBe(kp.address);
    expect(isOnCurveSolanaAddress(kp.address)).toBe(true);
  });

  it('accounts differ', () => {
    expect(deriveSolanaAddressFromMnemonic(ABANDON, 0)).not.toBe(deriveSolanaAddressFromMnemonic(ABANDON, 1));
  });

  it('a passphrase changes the keys', () => {
    expect(deriveSolanaKeypairFromMnemonic(ABANDON, 0, 'TREZOR').address).not.toBe(deriveSolanaAddressFromMnemonic(ABANDON, 0));
  });
});

describe('addresses', () => {
  it('accepts well-formed addresses, including off-curve program addresses', () => {
    expect(isValidSolanaAddress('11111111111111111111111111111111')).toBe(true);
    expect(isValidSolanaAddress('ComputeBudget111111111111111111111111111111')).toBe(true);
    expect(isValidSolanaAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
  });

  it('rejects junk', () => {
    for (const bad of ['', 'abc', '0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl', 'addr1qxyz', 'x'.repeat(50), null, 42]) {
      expect(isValidSolanaAddress(bad)).toBe(false);
    }
    // Valid base58 but 31 bytes.
    expect(isValidSolanaAddress(base58Encode(new Uint8Array(31).fill(7)))).toBe(false);
  });

  it('decodes program ids to their known bytes', () => {
    expect(bytesToHex(solanaAddressToBytes('11111111111111111111111111111111'))).toBe('00'.repeat(32));
    expect(bytesToHex(solanaAddressToBytes('ComputeBudget111111111111111111111111111111')))
      .toBe('0306466fe5211732ffecadba72c39be7bc8ce5bbc5f7126b2c439b3a40000000');
  });

  it('base58 round-trips, keeping leading zeros', () => {
    for (const hex of ['', '00', '0000ff', 'ff00', '00'.repeat(32), '0306466fe5211732ffecadba72c39be7bc8ce5bbc5f7126b2c439b3a40000000']) {
      const bytes = hexToBytes(hex);
      if (bytes.length === 0) continue;
      expect(bytesToHex(base58Decode(base58Encode(bytes)))).toBe(hex);
    }
    expect(() => base58Decode('0')).toThrow();
  });
});
