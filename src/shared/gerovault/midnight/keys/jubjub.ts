/**
 * Jubjub, Midnight's embedded curve, on noble's twisted Edwards arithmetic: `-x^2 + y^2 = 1 + d x^2 y^2`
 * over BLS12-381's scalar field, cofactor 8, prime-order subgroup of order `r_J`.
 *
 * The generator is the runtime's (`ecMulGenerator(1)`): midnight-zk's `JubjubSubgroup` generator,
 * which is 8 times its full-curve generator (the point with `v = 11` it names). It is not the
 * generator Zcash and noble's `jubjub` use. `jubjub.spec.ts` pins it against the ledger.
 *
 * A point travels as 64 bytes: `x` then `y`, each 32 bytes little-endian (the runtime's
 * representation), in hex when inside JSON.
 *
 * Point validation (`checkJubjubPoint`) is what the wallet runs on every key it did not derive:
 * coordinates below the field modulus, on the curve, not the identity, not of small order
 * (`[8]P = O`), and in the prime-order subgroup (`[r_J]P = O`). The contract refuses only the
 * identity, so the rest is the wallet's job.
 */
import { edwards } from '@noble/curves/abstract/edwards.js';
import { MidnightKeyError } from './errors';
import { concatBytes, fromHex, le2ip, le32, toHex } from './bytes';
import { FIELD_MODULUS, JUBJUB_SCALAR_MODULUS, JubjubPoint, JubjubPublicKey } from './types';

const P = FIELD_MODULUS;
const A = P - 1n;
const D = 0x2a9318e74bfa2b48f5fd9207e6bd7fd4292d7f6d37579d2601065fd6d6343eb1n;
const GX = 0x3ea5c4673a121ca35ed37ee3b172f5ee04315c657fbe375f512dfea318d56fe5n;
const GY = 0x57137b83ea6edb4f78f7d30d3f616cb3b9aa6e8e40808413c10cea38d50c55cbn;

const Point = edwards({ p: P, n: JUBJUB_SCALAR_MODULUS, h: 8n, a: A, d: D, Gx: GX, Gy: GY });
type NoblePoint = InstanceType<typeof Point>;

/** The runtime's Jubjub generator. */
export const JUBJUB_GENERATOR = Object.freeze({ x: GX, y: GY }) as JubjubPublicKey;
/** The identity point `(0, 1)`. */
export const JUBJUB_IDENTITY: JubjubPoint = Object.freeze({ x: 0n, y: 1n });

export type JubjubPointRefusal = 'MALFORMED' | 'OUT_OF_RANGE' | 'NOT_ON_CURVE' | 'IDENTITY' | 'SMALL_ORDER' | 'NOT_IN_SUBGROUP';

const mod = (x: bigint): bigint => ((x % P) + P) % P;

function shapeOk(p: unknown): p is JubjubPoint {
  return Boolean(p) && typeof p === 'object' && typeof (p as JubjubPoint).x === 'bigint' && typeof (p as JubjubPoint).y === 'bigint';
}

/**
 * A frozen copy of a caller's point, reading each coordinate once, or `undefined` when it is not a
 * point object. Checks run on the copy, so an object whose properties change between reads (a
 * getter, a proxy) cannot pass validation with one value and be used with another.
 */
export function snapshotJubjubPoint(p: unknown): JubjubPoint | undefined {
  if (!p || typeof p !== 'object') return undefined;
  const copy = { x: (p as JubjubPoint).x, y: (p as JubjubPoint).y };
  return shapeOk(copy) ? Object.freeze(copy) : undefined;
}

function inRange(p: JubjubPoint): boolean {
  return p.x >= 0n && p.x < P && p.y >= 0n && p.y < P;
}

/** Whether `(x, y)` satisfies the curve equation; coordinates must already be in range. */
export function isOnJubjubCurve(p: JubjubPoint): boolean {
  if (!shapeOk(p) || !inRange(p)) return false;
  const x2 = (p.x * p.x) % P;
  const y2 = (p.y * p.y) % P;
  return mod(A * x2 + y2) === mod(1n + D * ((x2 * y2) % P));
}

function toNoble(p: JubjubPoint): NoblePoint {
  return Point.fromAffine({ x: p.x, y: p.y });
}

function fromNoble(q: NoblePoint): JubjubPoint {
  const { x, y } = q.toAffine();
  return Object.freeze({ x, y });
}

/**
 * Point validation of a key the wallet did not derive. Never throws.
 * Refusals, in the order they are checked: `MALFORMED` (not a point object), `OUT_OF_RANGE`,
 * `NOT_ON_CURVE`, `IDENTITY`, `SMALL_ORDER` (one of the 8 torsion points), `NOT_IN_SUBGROUP`
 * (a subgroup point plus a torsion component).
 */
export function checkJubjubPoint(p: unknown): { readonly ok: true; readonly key: JubjubPublicKey } | { readonly ok: false; readonly code: JubjubPointRefusal } {
  try {
    const copy = snapshotJubjubPoint(p);
    if (!copy) return { ok: false, code: 'MALFORMED' };
    if (!inRange(copy)) return { ok: false, code: 'OUT_OF_RANGE' };
    if (!isOnJubjubCurve(copy)) return { ok: false, code: 'NOT_ON_CURVE' };
    if (copy.x === 0n && copy.y === 1n) return { ok: false, code: 'IDENTITY' };
    const q = toNoble(copy);
    if (q.isSmallOrder()) return { ok: false, code: 'SMALL_ORDER' };
    if (!q.isTorsionFree()) return { ok: false, code: 'NOT_IN_SUBGROUP' };
    return { ok: true, key: copy as JubjubPublicKey };
  } catch {
    return { ok: false, code: 'MALFORMED' };
  }
}

/** `p` as a validated public key. Throws `MidnightKeyError('INVALID_POINT')` naming the refusal. */
export function jubjubPublicKey(p: JubjubPoint): JubjubPublicKey {
  const checked = checkJubjubPoint(p);
  if (checked.ok === false) throw new MidnightKeyError('INVALID_POINT', `Not a Jubjub public key: ${checked.code}`);
  return checked.key;
}

/** `s * G` for `1 <= s < r_J`, with noble's constant-time ladder. Throws `MidnightKeyError('INVALID_SCALAR')`. */
export function jubjubMulGenerator(s: bigint): JubjubPoint {
  if (typeof s !== 'bigint' || s <= 0n || s >= JUBJUB_SCALAR_MODULUS) throw new MidnightKeyError('INVALID_SCALAR', 'A Jubjub scalar is from 1 below r_J');
  return fromNoble(Point.BASE.multiply(s));
}

/** Internal: `s * G + 0` for `0 <= s < r_J`, not constant time (public scalars only). */
export function mulGeneratorPublic(s: bigint): NoblePoint {
  return Point.BASE.multiplyUnsafe(s);
}

/** Internal: `s * p` for `0 <= s < r_J`, not constant time (public scalars and points only). */
export function mulPublic(p: JubjubPoint, s: bigint): NoblePoint {
  return toNoble(p).multiplyUnsafe(s);
}

/** Internal: `a + b`. */
export function addPoints(a: NoblePoint, b: JubjubPoint): JubjubPoint {
  return fromNoble(a.add(toNoble(b)));
}

/** Internal: the affine form of a noble point. */
export function affine(q: NoblePoint): JubjubPoint {
  return fromNoble(q);
}

export function jubjubPointsEqual(a: JubjubPoint, b: JubjubPoint): boolean {
  return shapeOk(a) && shapeOk(b) && a.x === b.x && a.y === b.y;
}

/** The 64-byte encoding: `x` then `y`, each 32 bytes little-endian. Throws for coordinates out of range. */
export function encodeJubjubPoint(p: JubjubPoint): Uint8Array {
  if (!shapeOk(p) || !inRange(p)) throw new MidnightKeyError('INVALID_POINT', 'Jubjub coordinates are below the field modulus');
  return concatBytes(le32(p.x), le32(p.y));
}

/** The point a 64-byte encoding names, unchecked apart from the coordinate range; `undefined` otherwise. */
export function decodeJubjubPoint(bytes: Uint8Array): JubjubPoint | undefined {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 64) return undefined;
  const p = { x: le2ip(bytes.subarray(0, 32)), y: le2ip(bytes.subarray(32, 64)) };
  return inRange(p) ? Object.freeze(p) : undefined;
}

/** The encoding as 128 lowercase hex characters. */
export function jubjubPointHex(p: JubjubPoint): string {
  return toHex(encodeJubjubPoint(p));
}

/** The point 128 lowercase hex characters name, unchecked apart from the coordinate range. */
export function jubjubPointFromHex(hex: unknown): JubjubPoint | undefined {
  const bytes = fromHex(hex, 64);
  return bytes ? decodeJubjubPoint(bytes) : undefined;
}
