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

export interface PriceMoveEvent {
  key: string;
  kind: 'priceUp' | 'priceDown';
  unit: string;
  ticker: string;
  held: boolean;
  window: '24h' | '7d';
  pct: number; // absolute magnitude, rounded
}

export interface TokenActivitySpikeEvent {
  key: string;
  kind: 'tokenActivitySpike';
  unit: string;
  ticker: string;
  mult: number; // 24h volume as a multiple of the recent daily average, rounded
}

/** Discriminated union over `kind`. Price events keep their original shape verbatim. */
export type FeedEvent = PriceMoveEvent | TokenActivitySpikeEvent;

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

export interface TokenActivityRow {
  unit: string;
  ticker: string;
  volume24h: number | null;
  volume7d: number | null;
}

export interface ActivitySpikeOptions {
  spikeMultiple: number; // 24h volume must be >= this x the recent daily average
  minVolume24h: number; // ADA floor so illiquid noise can't post a spike
  limit?: number; // cap the number of events (loudest spikes first)
}

/**
 * Pure, identity-free token-level anomaly: flag tokens whose 24h volume is a large
 * multiple of their recent daily average (volume7d / 7). This is an aggregate market
 * signal (no wallet identity, nothing to game as a single trader) and uses only fields
 * the bulk price list already returns. A token with no 7d baseline is skipped (can't
 * compute a multiple). `bucket` keeps the dedupe key stable within a period.
 */
export function detectTokenActivitySpikes(
  rows: TokenActivityRow[],
  options: ActivitySpikeOptions,
  bucket: string,
): TokenActivitySpikeEvent[] {
  const events: TokenActivitySpikeEvent[] = [];
  for (const r of rows) {
    if (r.volume24h == null || r.volume7d == null) continue;
    if (r.volume24h < options.minVolume24h) continue;
    const dailyAvg = r.volume7d / 7;
    if (dailyAvg <= 0) continue;
    const mult = r.volume24h / dailyAvg;
    if (mult < options.spikeMultiple) continue;
    events.push({
      key: `tokenActivitySpike:${r.unit}:${bucket}`,
      kind: 'tokenActivitySpike',
      unit: r.unit,
      ticker: r.ticker,
      mult: Math.round(mult),
    });
  }
  events.sort((a, b) => b.mult - a.mult);
  return options.limit != null ? events.slice(0, options.limit) : events;
}
