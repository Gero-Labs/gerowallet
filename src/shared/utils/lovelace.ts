/**
 * BigInt-safe lovelace arithmetic.
 *
 * Cardano stake figures exceed JavaScript's safe integer range: total active
 * DRep stake is ~2.5e16 lovelace against a Number.MAX_SAFE_INTEGER of 9.007e15.
 * Parsing a lovelace string with Number() is therefore lossy for large holders
 * and for every aggregate. The backend already sends these values as decimal
 * STRINGS (`amount`, `deposit`, `voting_power`) — keep them exact.
 *
 * Rule for the whole codebase: lovelace crosses the wire as a decimal string,
 * is parsed to BigInt here, and percentages are computed with pctOf(). Never
 * `Number(a) / Number(b)`.
 */

export type LovelaceLike = string | number | bigint | null | undefined;

/**
 * Parse any lovelace-ish value to BigInt. Never throws: unparseable input
 * yields 0n, because a governance table must render even if one row is junk.
 * A fractional Number is truncated (lovelace is an integer unit).
 */
export function toLovelace(value: LovelaceLike): bigint {
  if (value === null || value === undefined || value === '') return 0n;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0n;
    return BigInt(Math.trunc(value));
  }
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return 0n;
  return BigInt(trimmed);
}

/** Comparator for Array.prototype.sort — returns -1, 0 or 1. */
export function compareLovelace(a: LovelaceLike, b: LovelaceLike): number {
  const left = toLovelace(a);
  const right = toLovelace(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Sum a list of lovelace values exactly. */
export function sumLovelace(values: LovelaceLike[]): bigint {
  return values.reduce<bigint>((acc, v) => acc + toLovelace(v), 0n);
}

/**
 * `numerator / denominator` as a percentage with two decimal places.
 *
 * Scales by 10000n BEFORE dividing so the division happens in BigInt and only
 * the final small quotient is converted to Number. Returns 0 when the
 * denominator is zero — callers that need to distinguish "0%" from "no data"
 * must check the denominator themselves.
 */
export function pctOf(numerator: LovelaceLike, denominator: LovelaceLike): number {
  const den = toLovelace(denominator);
  if (den === 0n) return 0;
  const num = toLovelace(numerator);
  return Number((num * 10000n) / den) / 100;
}
