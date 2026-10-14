/**
 * Float-free conversions between human decimal amounts and smallest-unit
 * (base-unit) integers.
 *
 * `Math.floor(Number(x) * 10 ** decimals)` is NOT safe for money: float64
 * rounding can land just under an integer (0.29 * 100 → 28.999999999999996,
 * floored to 28), silently under-sending by one smallest unit. Very large
 * base-unit quantities (> 2^53) also lose integer precision in Number.
 * These helpers shift the decimal point on the string representation instead.
 */

/**
 * Convert a human decimal amount (e.g. "0.29") to base units (e.g. 29n for a
 * 2-decimal token). Extra fractional digits beyond `decimals` are truncated
 * toward zero. Comma-grouped input and scientific notation are supported.
 * Invalid input yields 0n.
 */
export function decimalToBaseUnits(amount: string | number | null | undefined, decimals: number): bigint {
  const str = String(amount ?? '').trim().replace(/,/g, '');
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(str);
  // Preserve the existing non-finite-input guard; Number never supplies digits
  // for the conversion, so integers above 2^53 retain their exact value.
  if (!match || !Number.isFinite(Number(str))) return BigInt(0);
  const [, sign, whole = '', fraction = '', leadingFraction = '', exponent = '0'] = match;
  const digits = whole + (fraction || leadingFraction);
  if (!/[1-9]/.test(digits)) return BigInt(0);
  const position = whole.length + parseInt(exponent, 10) + decimals;
  // Shift directly to base units, including valid number inputs like ".5e1".
  // Tiny exponents truncate to zero without allocating their leading zeroes.
  if (position <= 0) return BigInt(0);
  const units = BigInt(position < digits.length ? digits.slice(0, position) : digits.padEnd(position, '0'));
  return sign === '-' ? -units : units;
}

/**
 * Convert base units (e.g. 29n) to an exact human decimal string ("0.29")
 * without float division. Trailing fractional zeros are trimmed.
 */
export function baseUnitsToDecimalString(units: bigint | string | number | null | undefined, decimals: number): string {
  const value = typeof units === 'bigint' ? units : decimalToBaseUnits(units, 0);
  const negative = value < BigInt(0);
  const abs = (negative ? -value : value).toString().padStart(Math.max(decimals, 0) + 1, '0');
  const whole = abs.slice(0, abs.length - decimals) || '0';
  const frac = decimals > 0 ? abs.slice(abs.length - decimals).replace(/0+$/, '') : '';
  return (negative ? '-' : '') + whole + (frac ? '.' + frac : '');
}
