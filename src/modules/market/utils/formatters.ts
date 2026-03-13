/**
 * Shared formatting utilities for market components.
 */

/** Format a number in compact notation (e.g. 1.2B, 3.5M, 800K) */
export function formatCompact(value: number): string {
  if (value >= 1e9) return (value / 1e9).toFixed(1) + 'B';
  if (value >= 1e6) return (value / 1e6).toFixed(1) + 'M';
  if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
  return value.toFixed(value < 1 ? 4 : 0);
}

/** Format a price with adaptive decimal places (no symbol) */
export function formatPriceRaw(price: number): string {
  if (price >= 1) return price.toFixed(2);
  if (price >= 0.01) return price.toFixed(4);
  return price.toFixed(6);
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
