import { describe, expect, it } from 'vitest';
import { encode as cborgEncode } from 'cborg';
import { CborWritable, encodeCanonicalCbor } from './canonicalCbor';
import { bytesToHex, hexToBytes, readCbor } from './cbor';
import { decodeRegistration } from './registration';

const hex = (v: CborWritable) => Buffer.from(encodeCanonicalCbor(v)).toString('hex');

describe('deterministic CBOR writer', () => {
  // RFC 8949 Appendix A examples (the subset this writer covers).
  it.each([
    [0, '00'],
    [23, '17'],
    [24, '1818'],
    [100, '1864'],
    [1000, '1903e8'],
    [1000000, '1a000f4240'],
    [1000000000000, '1b000000e8d4a51000'],
    [18446744073709551615n, '1bffffffffffffffff'],
    [-1, '20'],
    [-10, '29'],
    [-100, '3863'],
    [-1000, '3903e7'],
    [-18446744073709551616n, '3bffffffffffffffff'],
    ['', '60'],
    ['a', '6161'],
    ['IETF', '6449455446'],
    [String.fromCharCode(0xfc), '62c3bc'],
    [String.fromCharCode(0x6c34), '63e6b0b4'],
    [new Uint8Array([1, 2, 3, 4]), '4401020304'],
    [[], '80'],
    [[1, [2, 3], [4, 5]], '8301820203820405'],
    [{}, 'a0'],
    [{ a: 1, b: [2, 3] }, 'a26161016162820203'],
  ] as [CborWritable, string][])('RFC 8949 example %#', (value, expected) => {
    expect(hex(value)).toBe(expected);
  });

  it('takes the shortest head at every boundary', () => {
    expect(hex(255)).toBe('18ff');
    expect(hex(256)).toBe('190100');
    expect(hex(65535)).toBe('19ffff');
    expect(hex(65536)).toBe('1a00010000');
    expect(hex(4294967295)).toBe('1affffffff');
    expect(hex(4294967296)).toBe('1b0000000100000000');
    expect(hex(-24)).toBe('37');
    expect(hex(-25)).toBe('3818');
    expect(hex(new Uint8Array(24)).slice(0, 4)).toBe('5818');
  });

  it('sorts map keys by their encoded bytes: shorter first, then by bytes', () => {
    expect(hex({ b: 1, a: 2, aa: 3 })).toBe('a3616102616201626161' + '03');
    // A key of 24 bytes or more has a two-byte head, so it sorts after every shorter key.
    const long = 'viewersSeeProposalContents';
    const encoded = hex({ [long]: 0, zz: 1 });
    expect(encoded.startsWith('a2627a7a01')).toBe(true);
  });

  it('agrees with an independent canonical encoder (cborg) on a nested value', () => {
    const value = {
      protocol: 'gero-vault/v1',
      schema: 1,
      roles: { owners: [{ credential: new Uint8Array(28).fill(1), devices: [] }], external: [] },
      viewersSeeProposalContents: false,
      flag: true,
      revisedAt: 1764158400,
      big: 2 ** 40,
      negative: -5,
    };
    expect(hex(value)).toBe(Buffer.from(cborgEncode(value)).toString('hex'));
  });

  it('writes booleans as the two simple values', () => {
    expect(hex(false)).toBe('f4');
    expect(hex(true)).toBe('f5');
    expect(hex([true, false])).toBe('82f5f4');
  });

  it('writes a Map with integer keys in the bytewise order of their encodings', () => {
    // 1 is 01, 24 is 1818, -1 is 20: bytewise order 01, 1818, 20 (RFC 8949 4.2.1).
    expect(hex(new Map<number, CborWritable>([[-1, 0], [24, 0], [1, 0]]))).toBe('a3' + '0100' + '181800' + '2000');
    const inner = new Map<number, CborWritable>([[0, new Uint8Array([7])]]);
    expect(hex(new Map<number, CborWritable>([[18541, inner]]))).toBe('a119486da1004107');
    expect(() => encodeCanonicalCbor(new Map<number | bigint, CborWritable>([[1, 0], [1n, 0]]))).toThrow(TypeError);
    expect(() => encodeCanonicalCbor(new Map([[true, 0]]) as unknown as CborWritable)).toThrow(TypeError);
  });

  it('agrees with cborg on random text-keyed trees, and writes what the strict reader accepts', () => {
    let seed = 12345;
    const rand = () => {
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5; seed >>>= 0;
      return seed;
    };
    const pick = <T>(xs: readonly T[]): T => xs[rand() % xs.length];
    const INTS = [0, 1, 23, 24, 255, 256, 65535, 65536, 4294967295, 4294967296, Number.MAX_SAFE_INTEGER, -1, -24, -25];
    const KEYS = ['a', 'b', 'aa', 'zz', 'credential', 'viewersSeeProposalContents', 'x'.repeat(24), String.fromCharCode(0xe9)];
    const tree = (depth: number): CborWritable => {
      const r = rand() % (depth > 4 ? 5 : 7);
      if (r === 0) return pick([...INTS, 18446744073709551615n, -18446744073709551616n, 2n ** 32n]);
      if (r === 1) return pick(['', 'a', 'x'.repeat(pick([23, 24, 255, 256])), String.fromCodePoint(0x1f600)]);
      if (r === 2) return new Uint8Array(pick([0, 23, 24, 255, 256]));
      if (r === 3) return rand() % 2 === 0;
      if (r === 4) return pick(INTS);
      if (r === 5) return Array.from({ length: rand() % 4 }, () => tree(depth + 1));
      const o: Record<string, CborWritable> = {};
      for (let i = 0; i < rand() % 5; i++) o[pick(KEYS)] = tree(depth + 1);
      return o;
    };
    for (let i = 0; i < 1000; i++) {
      const v = tree(0);
      const mine = encodeCanonicalCbor(v);
      expect(Buffer.from(mine).toString('hex')).toBe(Buffer.from(cborgEncode(v)).toString('hex'));
      expect(() => readCbor(mine, { maxDepth: 64, maxItems: 100000, booleans: true })).not.toThrow();
    }
  });

  it('writes what the strict reader accepts', () => {
    const bytes = encodeCanonicalCbor({ a: [1, 'two', new Uint8Array([3])], bb: { c: -4 } });
    expect(() => readCbor(bytes, { maxDepth: 8, maxItems: 64 })).not.toThrow();
  });

  it('refuses values outside the subset', () => {
    const lone = String.fromCharCode(0xd800);
    for (const bad of [1.5, NaN, Infinity, 2 ** 53, 2n ** 64n, -(2n ** 64n) - 1n, null, undefined, new Date(0), new Set(), lone]) {
      expect(() => encodeCanonicalCbor(bad as unknown as CborWritable)).toThrow(TypeError);
    }
  });
});

describe('the strict reader and booleans (opt in)', () => {
  const limits = { maxDepth: 4, maxItems: 16 };
  it('refuses booleans unless the limits ask for them', () => {
    expect(() => readCbor(Uint8Array.from([0xf5]), limits)).toThrow(expect.objectContaining({ reason: 'UNSUPPORTED_TYPE' }));
    expect(readCbor(Uint8Array.from([0xf5]), { ...limits, booleans: true }).value).toEqual({ type: 'bool', value: true });
    expect(readCbor(Uint8Array.from([0x82, 0xf4, 0x01]), { ...limits, booleans: true }).value.type).toBe('array');
  });

  it('leaves the registration decoder refusing booleans, in metadata and in scripts', () => {
    expect(decodeRegistration({ metadata: { cbor: 'a119073ea1657479706573f5' }, nativeScripts: { cbors: ['8200581c' + '00'.repeat(28)] } }))
      .toMatchObject({ ok: false, code: 'MALFORMED_CBOR' });
    expect(decodeRegistration({ metadata: { json: { types: [0] } }, nativeScripts: { cbors: ['8200f5'] } })).toMatchObject({ ok: false, code: 'MALFORMED_CBOR' });
  });

  it('still refuses every other simple value and floats with booleans on', () => {
    for (const bytes of [[0xf6], [0xf7], [0xf0], [0xf8, 0x20], [0xf9, 0x3c, 0x00], [0xfa, 0, 0, 0, 0], [0xfb, 0, 0, 0, 0, 0, 0, 0, 0]]) {
      expect(() => readCbor(Uint8Array.from(bytes), { ...limits, booleans: true })).toThrow(expect.objectContaining({ reason: 'UNSUPPORTED_TYPE' }));
    }
  });
});

describe('large payloads and hex', () => {
  const reference = {
    toHex: (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''),
    fromHex: (h: string) => (/^(?:[0-9a-fA-F]{2})*$/.test(h) ? Uint8Array.from(h.match(/../g) ?? [], x => parseInt(x, 16)) : undefined),
  };

  it('converts hex both ways exactly as a byte-by-byte reference does', () => {
    const samples = [0, 1, 28, 32, 63, 64, 65, 1000].map(n => Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff));
    for (const bytes of samples) {
      expect(bytesToHex(bytes)).toBe(reference.toHex(bytes));
      expect(hexToBytes(reference.toHex(bytes))).toEqual(bytes);
      expect(hexToBytes(reference.toHex(bytes).toUpperCase())).toEqual(bytes);
    }
    for (const bad of ['0', 'abc', '0g', 'zz', ' 00', '00 ', '0x00', '\u00E900', '00\u0660', '\uFF10\uFF10']) {
      expect(hexToBytes(bad)).toBe(reference.fromHex(bad));
      expect(hexToBytes(bad)).toBeUndefined();
    }
    expect(hexToBytes('')).toEqual(new Uint8Array(0));
    expect(hexToBytes(42)).toBeUndefined();
  });

  it('encodes, reads and converts a payload of 8 MB well under the time a copy byte by byte takes', () => {
    // The shape of a recovery payload: 32 manifests of 256 KiB inside revision maps.
    const blob = (i: number) => Uint8Array.from({ length: 262144 }, (_, j) => (i * 31 + j * 7) & 0xff);
    const value = { revisions: Array.from({ length: 32 }, (_, i) => ({ version: i + 1, manifest: blob(i) })) };
    const ms = (f: () => unknown) => {
      const t0 = performance.now();
      f();
      return performance.now() - t0;
    };
    // The best of three, so that one garbage collection pause cannot fail the test.
    const best = (f: () => unknown) => Math.min(ms(f), ms(f), ms(f));
    const bytes = encodeCanonicalCbor(value);
    expect(bytes.length).toBeGreaterThan(8_000_000);
    expect(bytes.subarray(0, 64)).toEqual(Uint8Array.from(cborgEncode(value).subarray(0, 64)));
    expect(readCbor(bytes, { maxDepth: 8, maxItems: 1000 }).end).toBe(bytes.length);
    const hexes = value.revisions.map(r => bytesToHex(r.manifest));
    expect(hexes.map(h => hexToBytes(h))[31]).toEqual(value.revisions[31].manifest);
    // Baselines measured in the same run, on the same machine and load: the work done byte by byte,
    // which the writer and the hex helpers used to do. Each operation must take less than half its
    // baseline; it takes a small fraction of it, so only a return to per-byte work fails.
    const perByteCopy = ms(() => value.revisions.map(r => Array.from(r.manifest)));
    const perByteToHex = ms(() => value.revisions.map(r => reference.toHex(r.manifest)));
    const perByteFromHex = ms(() => hexes.map(h => reference.fromHex(h)));
    expect(best(() => encodeCanonicalCbor(value))).toBeLessThan(perByteCopy / 2);
    expect(best(() => readCbor(bytes, { maxDepth: 8, maxItems: 1000 }))).toBeLessThan(perByteCopy / 2);
    expect(best(() => value.revisions.map(r => bytesToHex(r.manifest)))).toBeLessThan(perByteToHex / 2);
    expect(best(() => hexes.map(h => hexToBytes(h)))).toBeLessThan(perByteFromHex / 2);
  });
});
