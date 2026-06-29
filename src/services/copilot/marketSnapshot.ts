import marketApi from '@/api/market-api';
import type { TokenSnapshot } from './detectors';

export interface TokenRef {
  unit: string;
  ticker: string;
  held: boolean;
}

/**
 * Fetch price snapshots for the given refs using ONE bulk market call, not N
 * per-token requests. This matters for correctness, not just performance:
 *  - the per-token `/api/market/prices/{assetId}` endpoint is rate-limited (429 on
 *    a real multi-token portfolio) AND its payload omits priceChange24h/7d, so
 *    detection could never fire from it;
 *  - the bulk `/api/market/prices` list is a single request and DOES populate the
 *    change fields (it is the same source the market table reads).
 * Refs absent from the list (no market data) are skipped; a total failure returns
 * [] so one bad fetch never breaks the feed.
 */
export async function fetchSnapshots(refs: TokenRef[]): Promise<TokenSnapshot[]> {
  if (refs.length === 0) return [];

  let prices;
  try {
    prices = await marketApi.getAllPrices();
  } catch {
    return [];
  }

  const byAsset = new Map(prices.map((p) => [p.assetId, p]));
  const snapshots: TokenSnapshot[] = [];
  for (const ref of refs) {
    const p = byAsset.get(ref.unit);
    if (!p) continue;
    snapshots.push({
      unit: ref.unit,
      ticker: ref.ticker,
      held: ref.held,
      priceChange24h: p.priceChange24h ?? null,
      priceChange7d: p.priceChange7d ?? null,
    });
  }
  return snapshots;
}
