// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Argon2id at 64 MiB costs over a second per call in pure JS, so this file replaces it with a
// fast stand-in that still depends on the passphrase, the salt and every parameter. The real
// derivation runs in `recoveryVectors.spec.ts`.
vi.mock('@noble/hashes/argon2.js', async () => {
  const { blake2b } = await import('@noble/hashes/blake2.js');
  return {
    argon2idAsync: vi.fn(async (password: Uint8Array, salt: Uint8Array, opts: { m: number; t: number; p: number; dkLen: number; version: number }) => {
      const params = new TextEncoder().encode(`|${opts.m}|${opts.t}|${opts.p}|${opts.version}|`);
      return blake2b(new Uint8Array([...password, ...params, ...salt]), { dkLen: opts.dkLen });
    }),
  };
});

import { argon2idAsync } from '@noble/hashes/argon2.js';
import {
  MAX_RECOVERY_FILE_BYTES,
  RECOVERY_HEADER_BYTES,
  RECOVERY_KDF,
  openRecoveryFile,
  readRecoveryHeader,
  recoveryPassphraseBytes,
  sealRecoveryFile,
} from './recoveryFormat';

const kdf = vi.mocked(argon2idAsync);
const PASS = 'test passphrase for the format';
const PAYLOAD = new TextEncoder().encode('any payload bytes: the envelope never reads them');
const SALT = new Uint8Array(16).fill(1);
const NONCE = new Uint8Array(24).fill(2);

const seal = (payload = PAYLOAD, pass = PASS) => sealRecoveryFile(payload, pass, { salt: SALT, nonce: NONCE });
const code = async (file: unknown, pass: unknown = PASS) => {
  const r = await openRecoveryFile(file, pass);
  return r.ok === true ? 'OPENED' : r.code;
};

function withUint32(file: Uint8Array, offset: number, value: number): Uint8Array {
  const out = Uint8Array.from(file);
  new DataView(out.buffer).setUint32(offset, value, false);
  return out;
}

beforeEach(() => {
  kdf.mockClear();
});

describe('sealing', () => {
  it('derives with Argon2id v1.3 at the format parameters and a 32-byte output', async () => {
    await seal();
    expect(kdf).toHaveBeenCalledTimes(1);
    expect(kdf.mock.calls[0][2]).toEqual({ m: 65536, t: 3, p: 1, dkLen: 32, version: 0x13 });
    expect(RECOVERY_KDF).toEqual({ memoryKiB: 65536, passes: 3, lanes: 1 });
  });

  it('draws a fresh salt and nonce for every file', async () => {
    const [a, b] = await Promise.all([sealRecoveryFile(PAYLOAD, PASS), sealRecoveryFile(PAYLOAD, PASS)]);
    const header = (f: Uint8Array) => readRecoveryHeader(f) as { ok: true; header: { salt: Uint8Array; nonce: Uint8Array } };
    expect(header(a).header.salt).not.toEqual(header(b).header.salt);
    expect(header(a).header.nonce).not.toEqual(header(b).header.nonce);
    expect(await code(a)).toBe('OPENED');
  });

  it('refuses a passphrase that cannot be one, and test values of the wrong size', async () => {
    for (const bad of ['', '\uD800', 'a\uDC00b']) {
      await expect(sealRecoveryFile(PAYLOAD, bad)).rejects.toMatchObject({ code: 'INVALID_PASSPHRASE' });
    }
    await expect(sealRecoveryFile(PAYLOAD, PASS, { salt: new Uint8Array(8) })).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
    await expect(sealRecoveryFile(PAYLOAD, PASS, { nonce: new Uint8Array(12) })).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
    await expect(sealRecoveryFile(new Uint8Array(MAX_RECOVERY_FILE_BYTES), PASS)).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
  });
});

describe('opening', () => {
  it('round-trips and never changes its input', async () => {
    const file = await seal();
    const copy = Uint8Array.from(file);
    const opened = await openRecoveryFile(file, PASS);
    expect(opened.ok).toBe(true);
    expect((opened as { payload: Uint8Array }).payload).toEqual(PAYLOAD);
    expect(file).toEqual(copy);
  });

  it('normalises the passphrase to NFC, so composed and decomposed forms open the same file', async () => {
    const composed = 'café crème';
    const decomposed = 'café crème';
    const file = await seal(PAYLOAD, decomposed);
    expect(await code(file, composed)).toBe('OPENED');
    expect(recoveryPassphraseBytes(decomposed)).toEqual(new TextEncoder().encode(composed));
  });

  it('tells a wrong passphrase from tampering', async () => {
    const file = await seal();
    expect(await code(file, 'wrong passphrase')).toBe('WRONG_PASSPHRASE');
    expect(await code(file, PASS.toUpperCase())).toBe('WRONG_PASSPHRASE');
    expect(await code(file, `${PASS} `)).toBe('WRONG_PASSPHRASE');
    const flipped = Uint8Array.from(file);
    flipped[file.length - 1] ^= 1;
    expect(await code(flipped)).toBe('TAMPERED');
  });

  it('answers a passphrase no package can have without deriving, and refuses non-string input', async () => {
    const file = await seal();
    kdf.mockClear();
    expect(await code(file, '')).toBe('WRONG_PASSPHRASE');
    expect(await code(file, '\uD800')).toBe('WRONG_PASSPHRASE');
    expect(await code(file, 42)).toBe('INVALID_INPUT');
    expect(await code('not bytes')).toBe('INVALID_INPUT');
    expect(kdf).not.toHaveBeenCalled();
  });

  it('refuses every single-bit change, by the field it hits', async () => {
    const file = await seal();
    const seen = new Map<string, Set<string>>();
    for (let i = 0; i < file.length; i++) {
      const changed = Uint8Array.from(file);
      changed[i] ^= 0x01;
      const field = i < 8 ? 'magic' : i < 9 ? 'version' : i < 21 ? 'kdf' : i < 37 ? 'salt' : i < 61 ? 'nonce' : i < 77 ? 'check' : i < 81 ? 'length' : 'ciphertext';
      const result = await code(changed);
      expect(result).not.toBe('OPENED');
      if (!seen.has(field)) seen.set(field, new Set());
      seen.get(field)?.add(result);
    }
    expect(seen.get('magic')).toEqual(new Set(['NOT_A_PACKAGE']));
    expect(seen.get('version')).toEqual(new Set(['UNKNOWN_VERSION']));
    expect(seen.get('salt')).toEqual(new Set(['WRONG_PASSPHRASE']));
    expect(seen.get('check')).toEqual(new Set(['WRONG_PASSPHRASE']));
    expect(seen.get('nonce')).toEqual(new Set(['TAMPERED']));
    expect(seen.get('ciphertext')).toEqual(new Set(['TAMPERED']));
    // A parameter or length change is refused before any derivation or reads as another key.
    for (const c of seen.get('kdf') ?? []) expect(['KDF_TOO_WEAK', 'KDF_OUT_OF_RANGE', 'WRONG_PASSPHRASE']).toContain(c);
    for (const c of seen.get('length') ?? []) expect(['TRUNCATED', 'TAMPERED', 'TOO_LARGE']).toContain(c);
  });

  it('refuses every truncation before deriving a key', async () => {
    const file = await seal();
    kdf.mockClear();
    expect(await code(new Uint8Array(0))).toBe('NOT_A_PACKAGE');
    for (let n = 1; n < file.length; n++) expect(await code(file.subarray(0, n))).toBe('TRUNCATED');
    expect(kdf).not.toHaveBeenCalled();
  });

  it('refuses trailing bytes and a ciphertext length that cannot hold the tag', async () => {
    const file = await seal();
    expect(await code(new Uint8Array([...file, 0]))).toBe('TAMPERED');
    expect(await code(withUint32(file, 77, 15))).toBe('TAMPERED');
    expect(await code(withUint32(file, 77, MAX_RECOVERY_FILE_BYTES))).toBe('TOO_LARGE');
  });

  it('refuses other files and other format versions', async () => {
    const file = await seal();
    expect(await code(new TextEncoder().encode('{"vault": "not a package"}'))).toBe('NOT_A_PACKAGE');
    // A text-mode transfer that rewrote CR LF as LF is caught by the magic.
    expect(await code(new Uint8Array([...file.subarray(0, 4), 0x0a, ...file.subarray(6)]))).toBe('NOT_A_PACKAGE');
    for (const v of [0, 2, 255]) {
      const other = Uint8Array.from(file);
      other[8] = v;
      expect(readRecoveryHeader(other)).toEqual({ ok: false, code: 'UNKNOWN_VERSION', detail: String(v) });
    }
  });
});

describe('key derivation parameters in the header', () => {
  it('refuses a downgrade before deriving: a crafted file cannot lower the cost', async () => {
    const file = await seal();
    kdf.mockClear();
    const cases: [number, number, string][] = [
      [9, 65535, 'KDF_TOO_WEAK'], // memory one KiB below 64 MiB
      [9, 8, 'KDF_TOO_WEAK'],
      [13, 2, 'KDF_TOO_WEAK'], // two passes
      [13, 0, 'KDF_TOO_WEAK'],
      [9, 262145, 'KDF_OUT_OF_RANGE'], // above 256 MiB
      [9, 0xffffffff, 'KDF_OUT_OF_RANGE'],
      [13, 11, 'KDF_OUT_OF_RANGE'],
      [17, 0, 'KDF_OUT_OF_RANGE'], // lanes
      [17, 4, 'KDF_OUT_OF_RANGE'],
    ];
    for (const [offset, value, expected] of cases) expect(await code(withUint32(file, offset, value))).toBe(expected);
    expect(kdf).not.toHaveBeenCalled();
  });

  it('accepts stronger parameters within the bounds, as a later writer may choose', async () => {
    const file = await seal();
    const stronger = withUint32(withUint32(file, 9, 131072), 13, 4);
    const read = readRecoveryHeader(stronger);
    expect(read).toMatchObject({ ok: true, header: { kdf: { memoryKiB: 131072, passes: 4, lanes: 1 } } });
    // The parameters are authenticated: these bytes were sealed under other ones.
    expect(await code(stronger)).toBe('WRONG_PASSPHRASE');
    expect(kdf.mock.calls.at(-1)?.[2]).toMatchObject({ m: 131072, t: 4, p: 1 });
  });

  it('keeps the header fixed at 81 bytes', () => {
    expect(RECOVERY_HEADER_BYTES).toBe(81);
  });
});
