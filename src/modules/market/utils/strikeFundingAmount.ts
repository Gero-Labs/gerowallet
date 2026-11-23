import { toBaseUnits } from '@/modules/swap/composables/orderSpendBound';

/** User-entered amounts must fit the asset precision without rounding. */
export function parseStrikeAmount(input: string | number, decimals: number): bigint | null {
  const text = String(input).trim().replace(',', '.');
  const point = text.indexOf('.');
  if (point >= 0 && text.length - point - 1 > decimals) return null;
  return toBaseUnits(text, decimals);
}

export function formatStrikeUsd(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}
