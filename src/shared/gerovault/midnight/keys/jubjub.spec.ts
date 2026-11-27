// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { jubjub as nobleJubjub } from '@noble/curves/misc.js';
import {
  JUBJUB_GENERATOR,
  checkJubjubPoint,
  decodeJubjubPoint,
  encodeJubjubPoint,
  isOnJubjubCurve,
  jubjubMulGenerator,
  jubjubPointFromHex,
  jubjubPointHex,
  jubjubPublicKey,
} from './jubjub';
import { FIELD_MODULUS, JUBJUB_SCALAR_MODULUS, JubjubPoint } from './types';

type NP = InstanceType<typeof nobleJubjub.Point>;
const Point = nobleJubjub.Point;
const RJ = JUBJUB_SCALAR_MODULUS;
const affine = (q: NP): JubjubPoint => q.toAffine();
const fromAffine = (p: JubjubPoint): NP => Point.fromAffine({ x: p.x, y: p.y });
/** `[n]P` for any n >= 0 (noble refuses scalars from r_J up). */
const times = (q: NP, n: bigint): NP => {
  let acc = Point.ZERO;
  let k = n;
  while (k >= RJ) {
    acc = acc.add(q.multiplyUnsafe(RJ - 1n)).add(q);
    k -= RJ;
  }
  return acc.add(q.multiplyUnsafe(k));
};

/** midnight-zk's full-curve generator: v = 11 and the u it names. Its multiple by 8 is the subgroup generator. */
const FULL = fromAffine({ x: 0x62edcbb8bf3787c88b0f03ddd60a8187caf55d1b29bf81afe4b3d35df1a7adfen, y: 11n });
/** A point of order 8, and with it the whole torsion group. */
const T8 = times(FULL, RJ);
const TORSION = Array.from({ length: 8 }, (_, k) => affine(times(T8, BigInt(k))));
const G = fromAffine(JUBJUB_GENERATOR);

const ledgerMulGenerator = (s: bigint): JubjubPoint => {
  const v = ledger.ecMulGenerator(ledger.bigIntToValue(s));
  return { x: ledger.valueToBigInt([v[0]]), y: ledger.valueToBigInt([v[1]]) };
};

describe('jubjub: the generator', () => {
  it('is the runtime\'s ecMulGenerator(1)', () => {
    expect(ledgerMulGenerator(1n)).toEqual({ x: JUBJUB_GENERATOR.x, y: JUBJUB_GENERATOR.y });
  });

  it('is 8 times midnight-zk\'s full-curve generator, and not noble\'s Zcash generator', () => {
    expect(affine(FULL.multiply(8n))).toEqual({ x: JUBJUB_GENERATOR.x, y: JUBJUB_GENERATOR.y });
    expect(affine(Point.BASE)).not.toEqual({ x: JUBJUB_GENERATOR.x, y: JUBJUB_GENERATOR.y });
  });

  it('multiplies like the runtime for any scalar', () => {
    for (const s of [1n, 2n, 7n, 0x1234567890abcdefn, RJ - 1n, RJ / 3n, 0x77b24a6ccf699af0863243aabc078535adc9823d365c479204530baa55afc92n]) {
      expect(jubjubMulGenerator(s)).toEqual(ledgerMulGenerator(s));
    }
  });

  it('refuses a scalar of 0 or from r_J up', () => {
    for (const s of [0n, RJ, RJ + 1n, -1n]) expect(() => jubjubMulGenerator(s)).toThrow(expect.objectContaining({ code: 'INVALID_SCALAR' }));
  });
});

describe('jubjub: point validation', () => {
  it('accepts subgroup points', () => {
    for (const s of [1n, 5n, RJ - 1n, 0xdeadbeefn]) {
      const p = jubjubMulGenerator(s);
      expect(checkJubjubPoint(p)).toEqual({ ok: true, key: p });
      expect(jubjubPublicKey(p)).toEqual(p);
    }
  });

  it('builds the torsion group correctly: 8 distinct points of order dividing 8', () => {
    expect(new Set(TORSION.map(t => `${t.x},${t.y}`)).size).toBe(8);
    for (const t of TORSION) expect(times(fromAffine(t), 8n).is0()).toBe(true);
    expect(times(T8, 4n).is0()).toBe(false);
  });

  it('refuses the identity', () => {
    expect(TORSION[0]).toEqual({ x: 0n, y: 1n });
    expect(checkJubjubPoint({ x: 0n, y: 1n })).toEqual({ ok: false, code: 'IDENTITY' });
    expect(() => jubjubPublicKey({ x: 0n, y: 1n })).toThrow(expect.objectContaining({ code: 'INVALID_POINT' }));
  });

  it('refuses every small-order point', () => {
    for (const t of TORSION.slice(1)) {
      expect(isOnJubjubCurve(t)).toBe(true);
      expect(checkJubjubPoint(t)).toEqual({ ok: false, code: 'SMALL_ORDER' });
    }
    expect(checkJubjubPoint({ x: 0n, y: FIELD_MODULUS - 1n })).toEqual({ ok: false, code: 'SMALL_ORDER' });
  });

  it('refuses a subgroup point with a torsion component, and the full-curve generator', () => {
    for (const t of TORSION.slice(1)) {
      const mixed = affine(G.multiply(3n).add(fromAffine(t)));
      expect(isOnJubjubCurve(mixed)).toBe(true);
      expect(checkJubjubPoint(mixed)).toEqual({ ok: false, code: 'NOT_IN_SUBGROUP' });
    }
    expect(checkJubjubPoint(affine(FULL))).toEqual({ ok: false, code: 'NOT_IN_SUBGROUP' });
  });

  it('refuses a point off the curve, coordinates out of range, and anything that is not a point', () => {
    const g = JUBJUB_GENERATOR;
    expect(checkJubjubPoint({ x: g.x, y: g.y + 1n })).toEqual({ ok: false, code: 'NOT_ON_CURVE' });
    expect(checkJubjubPoint({ x: g.x + FIELD_MODULUS, y: g.y })).toEqual({ ok: false, code: 'OUT_OF_RANGE' });
    expect(checkJubjubPoint({ x: -1n, y: g.y })).toEqual({ ok: false, code: 'OUT_OF_RANGE' });
    for (const bad of [undefined, null, 'G', { x: 1, y: 2 }, { x: g.x }, [g.x, g.y]]) expect(checkJubjubPoint(bad)).toEqual({ ok: false, code: 'MALFORMED' });
  });
});

describe('jubjub: the 64-byte encoding', () => {
  it('is x then y, each 32 bytes little-endian', () => {
    const p = jubjubMulGenerator(9n);
    const bytes = encodeJubjubPoint(p);
    expect(bytes).toHaveLength(64);
    expect(bytes[0]).toBe(Number(p.x & 0xffn));
    expect(bytes[32]).toBe(Number(p.y & 0xffn));
    expect(decodeJubjubPoint(bytes)).toEqual(p);
    expect(jubjubPointFromHex(jubjubPointHex(p))).toEqual(p);
  });

  it('decodes nothing out of range or of the wrong length', () => {
    const bytes = new Uint8Array(64).fill(0xff);
    expect(decodeJubjubPoint(bytes)).toBeUndefined();
    expect(decodeJubjubPoint(new Uint8Array(63))).toBeUndefined();
    expect(jubjubPointFromHex('00'.repeat(63))).toBeUndefined();
    expect(jubjubPointFromHex(jubjubPointHex(JUBJUB_GENERATOR).toUpperCase())).toBeUndefined();
    expect(() => encodeJubjubPoint({ x: FIELD_MODULUS, y: 0n })).toThrow(expect.objectContaining({ code: 'INVALID_POINT' }));
  });
});
