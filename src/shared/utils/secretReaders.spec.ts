import { describe, it, expect } from 'vitest';
import { Bip32PrivateKey } from '@cardano-sdk/crypto';
import {
  SecretPurpose,
  decrypt,
  decryptKeyBlob,
  decryptPrivateKey,
  isLegacyNestedKey,
  isRawEncryptedKey,
} from './crypto';
import { resolvePrivateKey } from './resolver';
import { BitcoinAdapter } from '@/chains/bitcoin/bitcoinAdapter';
import { SECRET_FORMAT_FIXTURES as F } from './__fixtures__/secretFormats';

/**
 * Every format the wallet has ever written must still open through the single
 * reader for its field, and every format must yield byte-identical key material.
 * Release N (reader-only) ships these readers before any writer emits gpw2, so a
 * later rollback to N never locks out a wallet that N+1 migrated.
 */

const ROOT_FORMATS = ['legacyNested', 'rawHex', 'gpw2'] as const;

describe('root-key reader (decryptPrivateKey)', () => {
  for (const format of ROOT_FORMATS) {
    it(`opens the Cardano ${format} blob to the same root key`, () => {
      const bytes = decryptPrivateKey(F.rootKey[format], F.pw);
      expect(bytes.toString('hex')).toBe(F.cardanoRootKeyHex);
    });

    it(`opens the BTC/Midnight ${format} blob to the same key`, () => {
      expect(decryptPrivateKey(F.btcRootKey[format], F.pw).toString('hex')).toBe(F.btcRootKeyHex);
    });

    it(`rejects a wrong password for ${format}`, () => {
      expect(() => decryptPrivateKey(F.rootKey[format], 'wrong')).toThrow();
      expect(() => decryptPrivateKey(F.rootKey[format], '')).toThrow();
    });
  }

  it('key equivalence: every format yields the root key the mnemonic derives, and the same public key', () => {
    const derived = resolvePrivateKey(F.mnemonic);
    for (const format of ROOT_FORMATS) {
      const key = Bip32PrivateKey.fromBytes(decryptPrivateKey(F.rootKey[format], F.pw));
      expect(Buffer.from(key.bytes()).toString('hex')).toBe(Buffer.from(derived.bytes()).toString('hex'));
      expect(key.toPublic().hex()).toBe(F.cardanoRootPublicKeyHex);
    }
  });

  it('rejects a gpw2 blob written for another field', () => {
    expect(() => decryptPrivateKey(F.mnemonicBlob.gpw2, F.pw)).toThrow(/purpose mismatch/);
    expect(() => decryptPrivateKey(F.coldKey.gpw2, F.pw)).toThrow(/purpose mismatch/);
  });

  it('BitcoinAdapter.decryptPrivateKey reads every root-key format (it used to miss the nested legacy one)', () => {
    const adapter = new BitcoinAdapter();
    for (const format of ROOT_FORMATS) {
      expect(Buffer.from(adapter.decryptPrivateKey(F.btcRootKey[format], F.pw)).toString('hex')).toBe(F.btcRootKeyHex);
    }
  });
});

describe('root-key format classification (drives the unlock rewrite)', () => {
  it('only the legacy nested blob is eligible for the raw-hex rewrite', () => {
    expect(isLegacyNestedKey(F.rootKey.legacyNested)).toBe(true);
    expect(isLegacyNestedKey(F.btcRootKey.legacyNested)).toBe(true);
    expect(isLegacyNestedKey(F.rootKey.rawHex)).toBe(false);
    // A gpw2 root key is not raw hex either. Rewriting it to raw hex would be a
    // silent downgrade to PBKDF2, so it must NOT be classified as legacy.
    expect(isRawEncryptedKey(F.rootKey.gpw2)).toBe(false);
    expect(isLegacyNestedKey(F.rootKey.gpw2)).toBe(false);
    expect(isLegacyNestedKey('')).toBe(false);
  });
});

describe('text-secret reader (decrypt)', () => {
  const MNEMONIC_FORMATS = ['legacy', 'gpw1', 'gpw2'] as const;

  for (const format of MNEMONIC_FORMATS) {
    it(`opens the ${format} mnemonic blob`, () => {
      expect(decrypt(F.mnemonicBlob[format], F.pw, SecretPurpose.Mnemonic)).toBe(F.mnemonic);
    });

    it(`opens the ${format} 2FA security-data blob`, () => {
      expect(decrypt(F.securityData[format], F.pw, SecretPurpose.SecurityData)).toBe('JBSWY3DPEHPK3PXP');
    });

    it(`rejects a wrong password for the ${format} mnemonic`, () => {
      expect(() => decrypt(F.mnemonicBlob[format], 'wrong', SecretPurpose.Mnemonic)).toThrow();
    });
  }

  it('the mnemonic from every format re-derives the same root key', () => {
    for (const format of MNEMONIC_FORMATS) {
      const key = resolvePrivateKey(decrypt(F.mnemonicBlob[format], F.pw, SecretPurpose.Mnemonic));
      expect(Buffer.from(key.bytes()).toString('hex')).toBe(F.cardanoRootKeyHex);
    }
  });

  it('rejects a gpw2 blob read as another purpose', () => {
    expect(() => decrypt(F.mnemonicBlob.gpw2, F.pw, SecretPurpose.SecurityData)).toThrow(/purpose mismatch/);
    expect(() => decrypt(F.securityData.gpw2, F.pw, SecretPurpose.Mnemonic)).toThrow(/purpose mismatch/);
  });
});

describe('standalone key-blob reader (decryptKeyBlob)', () => {
  it('opens raw-hex and gpw2 cold-key blobs to the same bytes', () => {
    expect(decryptKeyBlob(F.coldKey.rawHex, F.pw, SecretPurpose.ColdKey).toString('hex')).toBe(F.coldKey.hex);
    expect(decryptKeyBlob(F.coldKey.gpw2, F.pw, SecretPurpose.ColdKey).toString('hex')).toBe(F.coldKey.hex);
  });

  it('rejects wrong password, wrong purpose, and a root-key blob in the cold-key slot', () => {
    expect(() => decryptKeyBlob(F.coldKey.rawHex, 'wrong', SecretPurpose.ColdKey)).toThrow();
    expect(() => decryptKeyBlob(F.coldKey.gpw2, F.pw, SecretPurpose.StrikeKey)).toThrow(/purpose mismatch/);
    expect(() => decryptKeyBlob(F.rootKey.gpw2, F.pw, SecretPurpose.ColdKey)).toThrow(/purpose mismatch/);
  });
});
