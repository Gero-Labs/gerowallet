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
 * Split a decimal amount into its significant digits and the position of the
 * decimal point within them, or null for invalid or non-finite input.
 */
function parseDecimal(amount: string | number | null | undefined): { negative: boolean; digits: string; point: number } | null {
  const str = String(amount ?? '').trim().replace(/,/g, '');
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(str);
  // Preserve the existing non-finite-input guard; Number never supplies digits
  // for the conversion, so integers above 2^53 retain their exact value.
  if (!match || !Number.isFinite(Number(str))) return null;
  const [, sign, whole = '', fraction = '', leadingFraction = '', exponent = '0'] = match;
  return { negative: sign === '-', digits: whole + (fraction || leadingFraction), point: whole.length + parseInt(exponent, 10) };
}

/** Token metadata may carry decimals as a string; anything but a non-negative integer is unusable. */
function decimalPlaces(decimals: number): number | null {
  const places = Number(decimals);
  return Number.isSafeInteger(places) && places >= 0 ? places : null;
}

/**
 * Convert a human decimal amount (e.g. "0.29") to base units (e.g. 29n for a
 * 2-decimal token). Extra fractional digits beyond `decimals` are truncated
 * toward zero. Comma-grouped input and scientific notation are supported.
 * Invalid input or invalid `decimals` yields 0n.
 */
export function decimalToBaseUnits(amount: string | number | null | undefined, decimals: number): bigint {
  const parsed = parseDecimal(amount);
  const places = decimalPlaces(decimals);
  if (!parsed || places === null || !/[1-9]/.test(parsed.digits)) return BigInt(0);
  const { digits } = parsed;
  const position = parsed.point + places;
  // Shift directly to base units, including valid number inputs like ".5e1".
  // Tiny exponents truncate to zero without allocating their leading zeroes.
  if (position <= 0) return BigInt(0);
  const units = BigInt(position < digits.length ? digits.slice(0, position) : digits.padEnd(position, '0'));
  return parsed.negative ? -units : units;
}

/**
 * True when `amount` has non-zero digits beyond `decimals` places, i.e. when
 * decimalToBaseUnits would silently truncate part of it.
 */
export function exceedsDecimals(amount: string | number | null | undefined, decimals: number): boolean {
  const parsed = parseDecimal(amount);
  const places = decimalPlaces(decimals);
  if (!parsed || places === null) return false;
  return /[1-9]/.test(parsed.digits.slice(Math.max(parsed.point + places, 0)));
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
