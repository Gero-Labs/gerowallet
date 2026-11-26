import { describe, expect, it } from 'vitest';
import { encode as cborgEncode } from 'cborg';
import { CborWritable, encodeCanonicalCbor } from './canonicalCbor';
import { readCbor } from './cbor';

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
    ['ü', '62c3bc'],
    ['水', '63e6b0b4'],
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
      threshold: 2,
      roles: { owners: [{ credential: new Uint8Array(28).fill(1), devices: [] }], external: [] },
      viewersSeeProposalContents: 0,
      createdAt: 1764158400,
      big: 2 ** 40,
      negative: -5,
    };
    expect(hex(value)).toBe(Buffer.from(cborgEncode(value)).toString('hex'));
  });

  it('writes what the strict reader accepts', () => {
    const bytes = encodeCanonicalCbor({ a: [1, 'two', new Uint8Array([3])], bb: { c: -4 } });
    expect(() => readCbor(bytes, { maxDepth: 8, maxItems: 64 })).not.toThrow();
  });

  it('refuses values outside the subset', () => {
    for (const bad of [1.5, NaN, Infinity, 2 ** 53, 2n ** 64n, -(2n ** 64n) - 1n, true, null, undefined, new Date(0), new Map(), '\ud800']) {
      expect(() => encodeCanonicalCbor(bad as unknown as CborWritable)).toThrow(TypeError);
    }
  });
});
