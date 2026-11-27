/**
 * Test-only Jubjub arithmetic on any point, torsion points included, and the 8-torsion group.
 * Noble's `jubjub` is the same curve as Midnight's (only its generator differs), so its point
 * arithmetic serves for points this library would refuse.
 */
import { jubjub } from '@noble/curves/misc.js';
import { JUBJUB_GENERATOR } from '../jubjub';
import { JUBJUB_SCALAR_MODULUS, JubjubPoint } from '../types';

export const NoblePoint = jubjub.Point;
export type NobleJubjubPoint = InstanceType<typeof jubjub.Point>;
const RJ = JUBJUB_SCALAR_MODULUS;

export const toNoble = (p: JubjubPoint): NobleJubjubPoint => NoblePoint.fromAffine({ x: p.x, y: p.y });
export const fromNoble = (q: NobleJubjubPoint): JubjubPoint => {
  const { x, y } = q.toAffine();
  return { x, y };
};

/** `[n]q` for any `n >= 0` (noble refuses scalars from r_J up). */
export function times(q: NobleJubjubPoint, n: bigint): NobleJubjubPoint {
  let acc = NoblePoint.ZERO;
  let k = n;
  while (k >= RJ) {
    acc = acc.add(q.multiplyUnsafe(RJ - 1n)).add(q);
    k -= RJ;
  }
  return acc.add(q.multiplyUnsafe(k));
}

export const addPoints = (a: JubjubPoint, b: JubjubPoint): JubjubPoint => fromNoble(toNoble(a).add(toNoble(b)));
export const mulPoint = (a: JubjubPoint, n: bigint): JubjubPoint => fromNoble(times(toNoble(a), n));
export const pointsEqual = (a: JubjubPoint, b: JubjubPoint): boolean => a.x === b.x && a.y === b.y;

/** midnight-zk's full-curve generator: v = 11 and the u it names. 8 times it is the subgroup generator. */
export const FULL_GENERATOR: JubjubPoint = { x: 0x62edcbb8bf3787c88b0f03ddd60a8187caf55d1b29bf81afe4b3d35df1a7adfen, y: 11n };
/** A point of order 8. */
export const T8: JubjubPoint = mulPoint(FULL_GENERATOR, RJ);
/** The 8-torsion group, `[k]T8` for k = 0 to 7: the identity first. */
export const TORSION: readonly JubjubPoint[] = Array.from({ length: 8 }, (_, k) => mulPoint(T8, BigInt(k)));
/** The subgroup generator, as the library has it. */
export const G: JubjubPoint = { x: JUBJUB_GENERATOR.x, y: JUBJUB_GENERATOR.y };
