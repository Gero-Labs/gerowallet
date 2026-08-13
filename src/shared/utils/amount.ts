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
 * (floor semantics, matching the previous behavior for valid inputs).
 * Invalid input yields 0n.
 */
export function decimalToBaseUnits(amount: string | number | null | undefined, decimals: number): bigint {
  let str = String(amount ?? '').trim().replace(/,/g, '');
  if (!str || !Number.isFinite(Number(str))) return BigInt(0);
  // Normalize scientific notation ("1e-7") to plain decimal before splitting
  if (/e/i.test(str)) {
    str = Number(str).toFixed(Math.max(decimals, 0));
  }
  const negative = str.startsWith('-');
  const unsigned = negative ? str.slice(1) : str;
  const [wholeRaw = '', fracRaw = ''] = unsigned.split('.');
  const whole = wholeRaw.replace(/\D/g, '') || '0';
  const frac = fracRaw.replace(/\D/g, '').slice(0, decimals).padEnd(Math.max(decimals, 0), '0');
  const units = BigInt(whole + frac);
  return negative ? -units : units;
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
