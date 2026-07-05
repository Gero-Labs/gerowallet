/**
 * Order-book helpers used by Strike perpetuals order forms.
 *
 *  - `calcVwapMarketFill` walks one side of the book to estimate a market
 *    order's average fill price and slippage in basis points.
 *  - `groupOrderBookLevels` aggregates raw price/size pairs into
 *    visual buckets at a given tick size.
 *
 * Inputs are the raw `[price, size]` tuples returned by Strike's depth
 * endpoint and `depthUpdate` WS event.
 */

export type OrderBookLevels = ReadonlyArray<readonly [string, string]>;

export interface VwapFillResult {
  /** Volume-weighted average price across the consumed levels. 0 when nothing is fillable. */
  avgPrice: number;
  /** Quantity that could actually be filled given the available depth. */
  filled: number;
  /** Slippage vs. the best price on the book, expressed in basis points (1 bps = 0.01%). */
  slippageBps: number;
  /** True when book depth is too thin to fill the requested size. */
  insufficientDepth: boolean;
}

/**
 * Estimate a market order's fill against one side of the book.
 *
 * `levels` MUST be sorted in execution order:
 *   - asks ascending (best ask first) for a buy
 *   - bids descending (best bid first) for a sell
 *
 * Strike's REST/WS payloads already deliver them in this order.
 *
 * `size` is the desired base-asset quantity. `slippageBps` is computed
 * relative to the top-of-book (level 0) reference price.
 */
export function calcVwapMarketFill(
  levels: OrderBookLevels,
  size: number,
): VwapFillResult {
  const empty: VwapFillResult = {
    avgPrice: 0, filled: 0, slippageBps: 0, insufficientDepth: false,
  };
  if (!levels || levels.length === 0 || !isFinite(size) || size <= 0) return empty;

  const refPrice = parseFloat(levels[0][0]);
  if (!isFinite(refPrice) || refPrice <= 0) return empty;

  let remaining = size;
  let totalCost = 0;
  let filled = 0;

  for (const [priceStr, qtyStr] of levels) {
    if (remaining <= 0) break;
    const price = parseFloat(priceStr);
    const qty = parseFloat(qtyStr);
    if (!isFinite(price) || !isFinite(qty) || price <= 0 || qty <= 0) continue;

    const take = Math.min(qty, remaining);
    totalCost += take * price;
    filled += take;
    remaining -= take;
  }

  if (filled <= 0) return empty;

  const avgPrice = totalCost / filled;
  const slippageBps = Math.abs((avgPrice - refPrice) / refPrice) * 10_000;

  return {
    avgPrice,
    filled,
    slippageBps,
    insufficientDepth: remaining > 0,
  };
}

/**
 * Bucket a side of the book into visual rows of width `tickSize`.
 * Aggregates sizes that fall into the same price bucket. Output is
 * sorted in the same direction as input (best-first).
 *
 * `depth` caps the number of returned buckets.
 */
export function groupOrderBookLevels(
  levels: OrderBookLevels,
  tickSize: number,
  depth: number,
): Array<[string, number]> {
  if (!levels || levels.length === 0 || tickSize <= 0 || depth <= 0) return [];

  // Detect side direction from the first two distinct prices so we can
  // sort buckets back into book order at the end.
  let direction: 1 | -1 = 1;
  for (let i = 1; i < levels.length; i++) {
    const a = parseFloat(levels[0][0]);
    const b = parseFloat(levels[i][0]);
    if (a !== b) { direction = b > a ? 1 : -1; break; }
  }

  const decimals = decimalsForStep(tickSize);
  const buckets = new Map<string, number>();

  for (const [priceStr, qtyStr] of levels) {
    const price = parseFloat(priceStr);
    const qty = parseFloat(qtyStr);
    if (!isFinite(price) || !isFinite(qty) || qty <= 0) continue;

    const bucketed = Math.floor(price / tickSize) * tickSize;
    const key = bucketed.toFixed(decimals);
    buckets.set(key, (buckets.get(key) ?? 0) + qty);
    // Read enough source rows to fill `depth` buckets without scanning the
    // entire book on every recompute.
    if (buckets.size > depth + 4) break;
  }

  const entries = Array.from(buckets.entries());
  entries.sort((a, b) => (parseFloat(a[0]) - parseFloat(b[0])) * direction);
  return entries.slice(0, depth);
}

function decimalsForStep(step: number): number {
  if (step <= 0 || !isFinite(step)) return 0;
  if (step >= 1) return 0;
  // e.g. 0.0005 → 4
  const txt = step.toExponential().split('e');
  const exp = parseInt(txt[1] ?? '0', 10);
  return Math.max(0, -exp);
}
