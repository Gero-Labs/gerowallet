import { describe, it, expect } from 'vitest';
import {
  GPW2_BOUNDS,
  GPW2_WRITE_PARAMS,
  SecretPurpose,
  isGpw2,
  openGpw2,
  openGpw2Text,
  sealGpw2,
  sealGpw2Text,
} from './secretEnvelope';
import { toB64url, fromB64url } from './mpc/base64url';
import { SECRET_FORMAT_FIXTURES as F } from './__fixtures__/secretFormats';

const PW = 'envelope-test-pw';

/** Decode a gpw2 blob, mutate its bytes, re-encode. */
function mutate(blob: string, fn: (raw: Uint8Array) => void): string {
  const raw = fromB64url(blob.slice('gpw2.'.length));
  fn(raw);
  return `gpw2.${toB64url(raw)}`;
}

/** Hand-build a header with arbitrary KDF params (no valid ciphertext needed: bounds reject first). */
function blobWithParams(t: number, m: number, p: number): string {
  const raw = new Uint8Array(55 + 32);
  const view = new DataView(raw.buffer);
  raw[0] = 2;
  raw[1] = SecretPurpose.RootKey;
  raw[2] = 1;
  view.setUint32(3, t, false);
  view.setUint32(7, m, false);
  view.setUint32(11, p, false);
  return `gpw2.${toB64url(raw)}`;
}

describe('gpw2 envelope', () => {
  it('round-trips bytes and text', () => {
    const key = crypto.getRandomValues(new Uint8Array(96));
    expect(openGpw2(sealGpw2(key, PW, SecretPurpose.RootKey), PW, SecretPurpose.RootKey)).toEqual(key);

    const text = '2FA seed héllo ünïcode 🔑';
    expect(openGpw2Text(sealGpw2Text(text, PW, SecretPurpose.SecurityData), PW, SecretPurpose.SecurityData)).toBe(text);
  });

  it('uses a fresh salt and nonce per seal', () => {
    const a = sealGpw2Text('same', PW, SecretPurpose.Mnemonic);
    const b = sealGpw2Text('same', PW, SecretPurpose.Mnemonic);
    expect(a).not.toBe(b);
  });

  it('records the write params in the header', () => {
    const raw = fromB64url(sealGpw2Text('x', PW, SecretPurpose.Mnemonic).slice(5));
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    expect(raw[0]).toBe(2);
    expect(raw[1]).toBe(SecretPurpose.Mnemonic);
    expect(raw[2]).toBe(1);
    expect(view.getUint32(3, false)).toBe(GPW2_WRITE_PARAMS.t);
    expect(view.getUint32(7, false)).toBe(GPW2_WRITE_PARAMS.m);
    expect(view.getUint32(11, false)).toBe(GPW2_WRITE_PARAMS.p);
  });

  it('opens the frozen fixture blobs', () => {
    expect(Buffer.from(openGpw2(F.rootKey.gpw2, F.pw, SecretPurpose.RootKey)).toString('hex')).toBe(F.cardanoRootKeyHex);
    expect(openGpw2Text(F.mnemonicBlob.gpw2, F.pw, SecretPurpose.Mnemonic)).toBe(F.mnemonic);
  });

  it('rejects a wrong password', () => {
    expect(() => openGpw2(F.rootKey.gpw2, 'wrong', SecretPurpose.RootKey)).toThrow();
  });

  it('rejects an empty password on seal and open', () => {
    expect(() => sealGpw2Text('x', '', SecretPurpose.Mnemonic)).toThrow();
    expect(() => openGpw2(F.rootKey.gpw2, '', SecretPurpose.RootKey)).toThrow();
  });

  it('binds the blob to its purpose (no field swapping)', () => {
    expect(() => openGpw2(F.mnemonicBlob.gpw2, F.pw, SecretPurpose.RootKey)).toThrow(/purpose mismatch/);
    expect(() => openGpw2(F.rootKey.gpw2, F.pw, SecretPurpose.Mnemonic)).toThrow(/purpose mismatch/);
    // Rewriting the purpose byte to match the reader fails authentication: the header is AAD.
    const relabelled = mutate(F.mnemonicBlob.gpw2, raw => { raw[1] = SecretPurpose.RootKey; });
    expect(() => openGpw2(relabelled, F.pw, SecretPurpose.RootKey)).toThrow();
    expect(() => openGpw2(relabelled, F.pw, SecretPurpose.RootKey)).not.toThrow(/purpose mismatch/);
  });

  it('rejects tampered KDF params, salt, nonce and ciphertext', () => {
    const cases: Array<(raw: Uint8Array) => void> = [
      raw => { raw[6] ^= 0x01; }, // t: 2 -> 3, still in range
      raw => { raw[20] ^= 0x01; }, // salt
      raw => { raw[40] ^= 0x01; }, // nonce
      raw => { raw[raw.length - 1] ^= 0x01; }, // tag
      raw => { raw[60] ^= 0x01; }, // ciphertext
    ];
    for (const fn of cases) {
      expect(() => openGpw2(mutate(F.rootKey.gpw2, fn), F.pw, SecretPurpose.RootKey)).toThrow();
    }
  });

  it('rejects an unknown version or KDF id', () => {
    expect(() => openGpw2(mutate(F.rootKey.gpw2, raw => { raw[0] = 3; }), F.pw, SecretPurpose.RootKey)).toThrow(/version/);
    expect(() => openGpw2(mutate(F.rootKey.gpw2, raw => { raw[2] = 2; }), F.pw, SecretPurpose.RootKey)).toThrow(/KDF/);
  });

  it('rejects truncated and non-gpw2 input', () => {
    expect(() => openGpw2('gpw2.AAAA', F.pw, SecretPurpose.RootKey)).toThrow(/Malformed/);
    expect(() => openGpw2(F.mnemonicBlob.gpw1, F.pw, SecretPurpose.Mnemonic)).toThrow(/Not a gpw2/);
  });

  it('refuses out-of-range KDF params before running Argon2id', () => {
    const tooBig = [
      blobWithParams(2, GPW2_BOUNDS.mMax + 1, 1), // memory bomb
      blobWithParams(GPW2_BOUNDS.tMax + 1, GPW2_BOUNDS.mMin, 1), // time bomb
      blobWithParams(0xffffffff, 0xffffffff, 1),
    ];
    const tooWeak = [
      blobWithParams(2, GPW2_BOUNDS.mMin - 1, 1),
      blobWithParams(0, GPW2_BOUNDS.mMin, 1),
      blobWithParams(2, GPW2_BOUNDS.mMin, 2), // p != 1
      blobWithParams(1, GPW2_BOUNDS.mMinAtT1 - 1, 1), // t=1 needs the larger memory floor
    ];
    for (const blob of [...tooBig, ...tooWeak]) {
      const started = performance.now();
      expect(() => openGpw2(blob, F.pw, SecretPurpose.RootKey)).toThrow(/out of range/);
      // Rejected on the header alone; a 4 GiB Argon2id would take far longer than this, or OOM.
      expect(performance.now() - started).toBeLessThan(500);
    }
  });

  it('accepts the OWASP t=1 / 46 MiB profile', () => {
    const params = { t: 1, m: GPW2_BOUNDS.mMinAtT1, p: 1 };
    const blob = sealGpw2(new Uint8Array([1, 2, 3]), PW, SecretPurpose.ColdKey, params);
    expect(openGpw2(blob, PW, SecretPurpose.ColdKey)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('refuses to seal with out-of-range params or an unknown purpose', () => {
    expect(() => sealGpw2(new Uint8Array(1), PW, SecretPurpose.RootKey, { t: 2, m: 1024, p: 1 })).toThrow(/out of range/);
    expect(() => sealGpw2(new Uint8Array(1), PW, 99 as SecretPurpose)).toThrow(/purpose/);
  });

  it('classifies formats', () => {
    expect(isGpw2(F.rootKey.gpw2)).toBe(true);
    expect(isGpw2(F.mnemonicBlob.gpw1)).toBe(false);
    expect(isGpw2(F.rootKey.rawHex)).toBe(false);
    expect(isGpw2(F.rootKey.legacyNested)).toBe(false);
    expect(isGpw2(undefined)).toBe(false);
  });
});
