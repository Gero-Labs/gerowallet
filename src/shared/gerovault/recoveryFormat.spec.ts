// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Argon2id at 64 MiB costs about half a second per call in pure JS, so this file replaces it with
// a fast stand-in that still depends on the passphrase, the salt and every parameter. The real
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

import { Buffer as NodeBuffer } from 'node:buffer';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import {
  MAX_RECOVERY_FILE_BYTES,
  MAX_RECOVERY_PAYLOAD_BYTES,
  RECOVERY_HEADER_BYTES,
  RECOVERY_KDF,
  RECOVERY_PASSPHRASE_ALPHABET,
  generateRecoveryPassphrase,
  normalizeRecoveryPassphrase,
  openRecoveryFile,
  readRecoveryHeader,
  recoveryPassphraseProblem,
  sealRecoveryFile,
} from './recoveryFormat';
import { GENERATED_EXAMPLE, PASSPHRASE_VECTORS } from './__fixtures__/recoveryPackageVectors';

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

const utf8Hex = (s: string) => NodeBuffer.from(s, 'utf8').toString('hex');

beforeEach(() => {
  kdf.mockClear();
});

describe('sealing', () => {
  it('derives with Argon2id v1.3 at 64 MiB, 3 passes and 1 lane, capped at 64 MiB of memory', async () => {
    await seal();
    expect(kdf).toHaveBeenCalledTimes(1);
    expect(kdf.mock.calls[0][2]).toEqual({ m: 65536, t: 3, p: 1, dkLen: 32, version: 0x13, maxmem: 64 * 1024 * 1024 });
    expect(RECOVERY_KDF).toEqual({ memoryKiB: 65536, passes: 3, lanes: 1 });
  });

  it('draws a fresh salt and nonce for every file', async () => {
    const [a, b] = await Promise.all([sealRecoveryFile(PAYLOAD, PASS), sealRecoveryFile(PAYLOAD, PASS)]);
    const header = (f: Uint8Array) => readRecoveryHeader(f) as { ok: true; header: { salt: Uint8Array; nonce: Uint8Array } };
    expect(header(a).header.salt).not.toEqual(header(b).header.salt);
    expect(header(a).header.nonce).not.toEqual(header(b).header.nonce);
    expect(await code(a)).toBe('OPENED');
  });

  it('refuses a passphrase the writer does not accept, and test values of the wrong size', async () => {
    for (const bad of ['', '\uD800 and sixteen more', 'a\uDC00b and sixteen more', 'fifteen code pt', 'sixteen\u0007code pts']) {
      await expect(sealRecoveryFile(PAYLOAD, bad)).rejects.toMatchObject({ code: 'INVALID_PASSPHRASE' });
    }
    await expect(sealRecoveryFile(PAYLOAD, PASS, { salt: new Uint8Array(8) })).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
    await expect(sealRecoveryFile(PAYLOAD, PASS, { nonce: new Uint8Array(12) })).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
    await expect(sealRecoveryFile(new Uint8Array(MAX_RECOVERY_PAYLOAD_BYTES + 1), PASS)).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
    expect(kdf).not.toHaveBeenCalled();
  });
});

describe('passphrases', () => {
  it.each(PASSPHRASE_VECTORS.map(v => [v.name, v] as const))('%s', async (_, v) => {
    expect(normalizeRecoveryPassphrase(v.input)).toBe(v.normalised);
    expect(recoveryPassphraseProblem(v.input) ?? 'accepts').toBe(v.writer);
    if (v.writer === 'accepts') {
      // Sealed under the input, opened with the input and with its normalised form.
      const file = await seal(PAYLOAD, v.input);
      expect(await code(file, v.input)).toBe('OPENED');
      expect(await code(file, v.normalised)).toBe('OPENED');
    } else {
      await expect(seal(PAYLOAD, v.input)).rejects.toMatchObject({ code: 'INVALID_PASSPHRASE' });
      // The reader still derives a key from it: an old package is never stranded by a writer rule.
      const file = await seal();
      kdf.mockClear();
      expect(await code(file, v.input)).toBe('WRONG_PASSPHRASE');
      expect(kdf).toHaveBeenCalledTimes(1);
    }
  });

  it('pins the bytes the key derivation takes, for the other client', () => {
    const pinned = Object.fromEntries(PASSPHRASE_VECTORS.map(v => [v.name, utf8Hex(normalizeRecoveryPassphrase(v.input))]));
    expect(pinned['a no-break space reads as an ASCII space']).toBe(utf8Hex('correct horse battery staple'));
    expect(pinned['generated, pasted with a trailing newline']).toBe('374b51324d395844345452424838574e');
    expect(pinned['generated, lookalikes O, I and L']).toBe('303131324d395844345452424838574e');
    expect(pinned['decomposed text reads as composed (NFC)']).toBe('636166c3a9206372c3a86d65206272c3bb6cc3a965');
  });

  it('opens a file sealed with ASCII spaces with a no-break space, and a generated one however it is typed', async () => {
    const spaces = await seal(PAYLOAD, 'correct horse battery staple');
    expect(await code(spaces, 'correct\u00A0horse\u2009battery staple')).toBe('OPENED');
    const generated = await seal(PAYLOAD, GENERATED_EXAMPLE);
    for (const typed of ['7kq2m9xd4trbh8wn', '7KQ2-M9XD-4TRB-H8WN\n', ' 7kq2 m9xd 4trb h8wn ', '7KQ2-M9XD-4TRB-H8WN\r\n']) {
      expect(await code(generated, typed)).toBe('OPENED');
    }
    expect(await code(generated, '7KQ2-M9XD-4TRB-H8WM')).toBe('WRONG_PASSPHRASE');
  });

  it('generates 16 characters of Crockford Base32 in four groups, accepted by the writer', () => {
    const seen = new Map<string, number>();
    const all = Array.from({ length: 2000 }, generateRecoveryPassphrase);
    const shape = new RegExp(`^[${RECOVERY_PASSPHRASE_ALPHABET}]{4}(-[${RECOVERY_PASSPHRASE_ALPHABET}]{4}){3}$`);
    for (const p of all) {
      expect(p).toMatch(shape);
      expect(recoveryPassphraseProblem(p)).toBeUndefined();
      expect(normalizeRecoveryPassphrase(p)).toBe(p.replace(/-/g, ''));
      for (const c of p.replace(/-/g, '')) seen.set(c, (seen.get(c) ?? 0) + 1);
    }
    expect(new Set(all).size).toBe(all.length);
    // 32 000 draws over 32 characters: each near 1 000.
    expect([...seen.keys()].sort().join('')).toBe([...RECOVERY_PASSPHRASE_ALPHABET].sort().join(''));
    for (const n of seen.values()) expect(n).toBeGreaterThan(800);
    for (const n of seen.values()) expect(n).toBeLessThan(1200);
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

  it('works on its own copy: header fields never alias the input, and later changes to it do not matter', async () => {
    const file = await seal();
    for (const B of [NodeBuffer, (globalThis as { Buffer?: typeof NodeBuffer }).Buffer ?? NodeBuffer]) {
      const buf = B.from(file);
      const pending = openRecoveryFile(buf, PASS);
      buf.fill(0);
      const r = await pending;
      if (r.ok !== true) throw new Error(r.code);
      expect(r.header.salt.buffer).not.toBe(buf.buffer);
      expect(r.header.salt).toEqual(SALT);
      expect(r.payload).toEqual(PAYLOAD);
    }
    const header = readRecoveryHeader(NodeBuffer.from(file));
    expect(header.ok === true && header.header.nonce).toEqual(NONCE);
  });

  it('refuses inputs that are not readable bytes without throwing', async () => {
    const file = await seal();
    const shared = new Uint8Array(new SharedArrayBuffer(file.length));
    shared.set(file);
    const inputs: [unknown, string][] = [
      [null, 'INVALID_INPUT'],
      ['bytes', 'INVALID_INPUT'],
      [Array.from(file), 'INVALID_INPUT'],
      [file.buffer, 'INVALID_INPUT'],
      [new DataView(file.buffer), 'INVALID_INPUT'],
      [Object.create(Uint8Array.prototype), 'INVALID_INPUT'],
      [new Proxy(Uint8Array.from(file), {}), 'INVALID_INPUT'],
      [shared, 'OPENED'],
    ];
    for (const [input, expected] of inputs) {
      expect(() => readRecoveryHeader(input)).not.toThrow();
      expect(await code(input)).toBe(expected);
    }
  });

  it('tells a wrong passphrase from tampering', async () => {
    const file = await seal();
    expect(await code(file, 'wrong passphrase')).toBe('WRONG_PASSPHRASE');
    expect(await code(file, PASS.toUpperCase())).toBe('WRONG_PASSPHRASE');
    expect(await code(file, `${PASS}x`)).toBe('WRONG_PASSPHRASE');
    const flipped = Uint8Array.from(file);
    flipped[file.length - 1] ^= 1;
    expect(await code(flipped)).toBe('TAMPERED');
  });

  it('refuses only an empty passphrase without deriving, and non-string input', async () => {
    const file = await seal();
    kdf.mockClear();
    for (const empty of ['', ' \t\r\n ', '\u00A0']) expect(await code(file, empty)).toBe('WRONG_PASSPHRASE');
    expect(await code(file, 42)).toBe('INVALID_INPUT');
    expect(await code('not bytes')).toBe('INVALID_INPUT');
    expect(kdf).not.toHaveBeenCalled();
    // A lone surrogate is not refused by the reader; it derives and fails like any wrong passphrase.
    expect(await code(file, '\uD800')).toBe('WRONG_PASSPHRASE');
    expect(kdf).toHaveBeenCalledTimes(1);
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
    // Any parameter change is refused before deriving.
    for (const c of seen.get('kdf') ?? []) expect(['KDF_TOO_WEAK', 'KDF_OUT_OF_RANGE']).toContain(c);
    for (const c of seen.get('length') ?? []) expect(['TRUNCATED', 'TAMPERED', 'TOO_LARGE']).toContain(c);
  });

  it('refuses every truncation before deriving a key', async () => {
    const file = await seal();
    kdf.mockClear();
    expect(await code(new Uint8Array(0))).toBe('NOT_A_PACKAGE');
    for (let n = 1; n < file.length; n++) expect(await code(file.subarray(0, n))).toBe('TRUNCATED');
    expect(kdf).not.toHaveBeenCalled();
  });

  it('refuses trailing bytes, a ciphertext length that cannot hold the tag, and oversized input', async () => {
    const file = await seal();
    expect(await code(new Uint8Array([...file, 0]))).toBe('TAMPERED');
    expect(await code(withUint32(file, 77, 15))).toBe('TAMPERED');
    expect(await code(withUint32(file, 77, MAX_RECOVERY_FILE_BYTES))).toBe('TOO_LARGE');
    expect(readRecoveryHeader(new Uint8Array(MAX_RECOVERY_FILE_BYTES + 1))).toMatchObject({ ok: false, code: 'TOO_LARGE' });
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
  it('accepts exactly the format version 1 parameters, refusing any other before deriving', async () => {
    const file = await seal();
    kdf.mockClear();
    const cases: [number, number, string][] = [
      [9, 65535, 'KDF_TOO_WEAK'], // one KiB below 64 MiB
      [9, 8, 'KDF_TOO_WEAK'],
      [13, 2, 'KDF_TOO_WEAK'], // two passes
      [13, 0, 'KDF_TOO_WEAK'],
      [9, 131072, 'KDF_OUT_OF_RANGE'], // 128 MiB
      [9, 262144, 'KDF_OUT_OF_RANGE'], // 256 MiB
      [9, 0xffffffff, 'KDF_OUT_OF_RANGE'],
      [13, 4, 'KDF_OUT_OF_RANGE'], // four passes
      [13, 10, 'KDF_OUT_OF_RANGE'],
      [17, 2, 'KDF_OUT_OF_RANGE'], // two lanes
      [17, 0, 'KDF_OUT_OF_RANGE'],
      [17, 4, 'KDF_OUT_OF_RANGE'],
    ];
    for (const [offset, value, expected] of cases) {
      expect(readRecoveryHeader(withUint32(file, offset, value))).toMatchObject({ ok: false, code: expected });
      expect(await code(withUint32(file, offset, value))).toBe(expected);
    }
    // The old maximum, 256 MiB and 10 passes together, is refused too.
    expect(await code(withUint32(withUint32(file, 9, 262144), 13, 10))).toBe('KDF_OUT_OF_RANGE');
    expect(kdf).not.toHaveBeenCalled();
  });

  it('keeps the header fixed at 81 bytes', () => {
    expect(RECOVERY_HEADER_BYTES).toBe(81);
  });
});
