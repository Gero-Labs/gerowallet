// src/services/copilot/detectors.ts
export interface TokenSnapshot {
  unit: string;
  ticker: string;
  held: boolean; // true = in wallet, false = watchlist-only
  priceChange24h: number | null;
  priceChange7d: number | null;
}

export interface PriceThresholds {
  pct24h?: number;
  pct7d?: number;
}

export interface FeedEvent {
  key: string;
  kind: 'priceUp' | 'priceDown';
  unit: string;
  ticker: string;
  held: boolean;
  window: '24h' | '7d';
  pct: number; // absolute magnitude, rounded
}

/**
 * Pure: for each snapshot, emit at most one price-move event - the window with the
 * largest absolute change that clears its threshold. `bucket` is a caller-provided
 * time bucket string used to keep the dedupe key stable within a period (no Date.now here).
 */
export function detectPriceMoves(
  snapshots: TokenSnapshot[],
  thresholds: PriceThresholds,
  bucket: string,
): FeedEvent[] {
  const events: FeedEvent[] = [];
  for (const s of snapshots) {
    const candidates: { window: '24h' | '7d'; change: number; min: number }[] = [];
    if (thresholds.pct24h != null && s.priceChange24h != null) {
      candidates.push({ window: '24h', change: s.priceChange24h, min: thresholds.pct24h });
    }
    if (thresholds.pct7d != null && s.priceChange7d != null) {
      candidates.push({ window: '7d', change: s.priceChange7d, min: thresholds.pct7d });
    }
    const cleared = candidates.filter((c) => Math.abs(c.change) >= c.min);
    if (cleared.length === 0) continue;
    cleared.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    const top = cleared[0];
    events.push({
      key: `${top.change >= 0 ? 'priceUp' : 'priceDown'}:${top.window}:${s.unit}:${bucket}`,
      kind: top.change >= 0 ? 'priceUp' : 'priceDown',
      unit: s.unit,
      ticker: s.ticker,
      held: s.held,
      window: top.window,
      pct: Math.round(Math.abs(top.change)),
    });
  }
  return events;
}
