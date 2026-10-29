/** The chart ranges a PriceHeroCard offers; each loader maps them to its own candle source. */
export const PRICE_RANGES = [
  { key: '24h', label: '24H', windowSec: 24 * 3600 },
  { key: '7d', label: '7D', windowSec: 7 * 86400 },
  { key: '30d', label: '30D', windowSec: 30 * 86400 },
  { key: '1y', label: '1Y', windowSec: 365 * 86400 },
] as const;

export type PriceRange = typeof PRICE_RANGES[number];
export type PriceRangeKey = PriceRange['key'];

/** A candle close: `time` in unix seconds. */
export interface PricePoint {
  time: number;
  close: number | null;
}

/** Fetches the candles for one range; the card keeps those inside the range's window. */
export type PricePointsLoader = (range: PriceRange) => Promise<PricePoint[]>;
