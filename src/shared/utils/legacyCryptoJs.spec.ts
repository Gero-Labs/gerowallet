import { describe, it, expect } from 'vitest';
import { decryptLegacyAes } from './legacyCryptoJs';
import { decryptSecret, encryptSecret, isLegacySecret } from './passwordSecret';

/**
 * Regression guard for the legacy decrypt path that replaced `crypto-ts` (PR #892).
 *
 * The `blob` values below are FROZEN real wire-format output of
 * `CryptoJS.AES.encrypt(plaintext, password).toString()` — exactly what the
 * wallet's pre-migration `encrypt()` / `encryptPrivateKey()` wrote to storage
 * (verified against git history). They are captured here so the decrypt path
 * stays byte-compatible with genuinely-stored blobs even though `crypto-ts` is
 * no longer a dependency. Do NOT regenerate these — that would defeat the guard.
 */
const FIXTURES = {
  // A mnemonic secret (as written by encrypt()).
  mnemonic: {
    pw: 'correct horse battery staple',
    pt: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    blob:
      'U2FsdGVkX1+p448WzL66c7kHdxDiUe9VS+BxE7MRxcNCEOUhXCkxsXpQjMssAUzy14PY7/qgEd90yzyIiGMHGOIgdx+2qjHSvKuux4egND8YQ9cRYYtXhmGWdaEonsjzhTblWNf0GUR1MfXvL4QlNQ==',
  },
  // A secret with multi-byte UTF-8 (2FA seed, emoji) — exercises the UTF-8 decode.
  unicode: {
    pw: 'p@$$w0rd!',
    pt: '2FA seed héllo ünïcode 🔑',
    blob: 'U2FsdGVkX19sW3whvCRBodorhtCF01UzXvtW/vCwuOSFFlr9SVz1JYKFy1JqoXx9',
  },
  // The inner layer of a legacy root-key blob: AES.encrypt(JSON.stringify(hexBlob), pw).
  // decryptPrivateKey() unwraps exactly this string before JSON.parse.
  jsonNested: {
    pw: 'rootpw',
    pt: '"deadbeefcafe0011223344556677889900aabbccddeeff"',
    blob:
      'U2FsdGVkX18+3QiJcEoOd5GEeGwmvHGySBd33O/+bkyb7utwm385nzo7/6AJs4hHJFiuwrKkD90kVtKJGwb/wn0YS11nk+3d82BPMS5mYGs=',
  },
} as const;

describe('decryptLegacyAes (crypto-ts wire-format compatibility)', () => {
  for (const [name, f] of Object.entries(FIXTURES)) {
    it(`decrypts the frozen "${name}" blob with the correct password`, () => {
      expect(decryptLegacyAes(f.blob, f.pw)).toBe(f.pt);
    });
  }

  it('throws (never returns garbage) on a wrong password', () => {
    // AES-CBC has no AEAD tag, so a wrong key usually fails PKCS7 padding, and in
    // the rare valid-padding case fatal:true UTF-8 decoding throws. Either way the
    // "wrong password always throws" guarantee must hold across many wrong keys.
    for (let i = 0; i < 500; i++) {
      expect(() => decryptLegacyAes(FIXTURES.mnemonic.blob, `wrong-${i}`)).toThrow();
    }
  });

  it('rejects a malformed (non-OpenSSL) blob', () => {
    expect(() => decryptLegacyAes('bm90LWEtc2FsdGVkLWJsb2I=', 'x')).toThrow();
  });
});

describe('decryptSecret (legacy + new envelope)', () => {
  it('classifies legacy blobs vs the new gpw1 envelope', () => {
    expect(isLegacySecret(FIXTURES.mnemonic.blob)).toBe(true);
    expect(isLegacySecret(encryptSecret('x', 'pw'))).toBe(false);
  });

  it('transparently decrypts a legacy blob through decryptSecret', () => {
    expect(decryptSecret(FIXTURES.mnemonic.blob, FIXTURES.mnemonic.pw)).toBe(FIXTURES.mnemonic.pt);
    expect(decryptSecret(FIXTURES.unicode.blob, FIXTURES.unicode.pw)).toBe(FIXTURES.unicode.pt);
  });

  it('round-trips the new Argon2id envelope', () => {
    const secret = 'a new secret written post-migration';
    const blob = encryptSecret(secret, 'pw123');
    expect(decryptSecret(blob, 'pw123')).toBe(secret);
    expect(() => decryptSecret(blob, 'wrongpw')).toThrow();
  });
});
