/**
 * Shared formatting utilities for market components.
 */

/** Format a number in compact notation (e.g. 1.20B, 3.50M, 800.0K) — matches the market-data site (2dp for B/M, 1dp for K) */
export function formatCompact(value: number): string {
  if (value >= 1e12) return (value / 1e12).toFixed(2) + 'T';
  if (value >= 1e9) return (value / 1e9).toFixed(2) + 'B';
  if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M';
  if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
  return value.toFixed(value < 1 ? 4 : 0);
}

/** Format an integer count with thousands separators (e.g. transaction / maker counts) */
export function formatInt(value: number | null | undefined): string {
  if (value == null) return '—';
  return Math.round(value).toLocaleString('en-US');
}

/** Format a balance (always 2 decimal places, compact for large numbers) */
export function formatBalance(value: number): string {
  if (value >= 1e9) return (value / 1e9).toFixed(2) + 'B';
  if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M';
  if (value >= 1e3) return (value / 1e3).toFixed(2) + 'K';
  return value.toFixed(2);
}

/** Unicode subscript digits for micro-price leading-zero notation */
const SUBSCRIPT_DIGITS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

function toSubscript(n: number): string {
  return String(n).split('').map(d => SUBSCRIPT_DIGITS[Number(d)] ?? d).join('');
}

/**
 * Format a price with adaptive decimal places (no symbol).
 * For micro-cap prices (< 0.01) uses subscript-zero notation preserving 4 significant
 * digits — e.g. 0.000006735 → "0.0₅6735" — to match the market-data site.
 */
export function formatPriceRaw(price: number): string {
  if (price >= 1) return price.toFixed(2);
  if (price >= 0.01) return price.toFixed(4);
  if (price <= 0) return '0.00';

  // Count leading zeros after the decimal point.
  const exponent = Math.floor(Math.log10(price)); // negative for < 1
  const leadingZeros = -exponent - 1; // zeros between '.' and first significant digit

  // Below the subscript threshold, fall back to fixed notation.
  if (leadingZeros < 2) return price.toFixed(6);

  // 4 significant digits, carry-safe: rounding can roll into a 5th digit
  // (e.g. 0.000099999 → 10000), which actually means one fewer leading zero.
  let zeros = leadingZeros;
  let digits = Math.round(price * Math.pow(10, zeros + 4)).toString();
  if (digits.length > 4) {
    zeros -= 1;
    digits = digits.slice(0, 4);
  }
  if (zeros < 2) return price.toFixed(6);
  const significant = digits.padStart(4, '0').slice(0, 4);
  return `0.0${toSubscript(zeros)}${significant}`;
}

/** Format a price with a currency symbol prefix */
export function formatPrice(price: number, symbol: string = '$'): string {
  return symbol + formatPriceRaw(price);
}

/** Format a percentage change (absolute value + %) */
export function formatChange(change: number): string {
  return Math.abs(change).toFixed(1) + '%';
}

/** Return a color string for positive/negative/zero change */
export function changeColor(change: number): string {
  if (change === 0) return '#A3A3A3';
  return change > 0 ? '#47CD89' : '#F97066';
}
