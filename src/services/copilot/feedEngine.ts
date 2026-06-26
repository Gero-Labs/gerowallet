// src/services/copilot/feedEngine.ts
import { detectPriceMoves, type PriceThresholds, type TokenSnapshot } from './detectors';
import { narrate } from './narrator';
import { fetchSnapshots as defaultFetch, type TokenRef } from './marketSnapshot';
import type { FeedItem } from './feedReducer';

/**
 * Orchestrate one detection pass: fetch snapshots for the refs, run detectors,
 * narrate, and return FeedItems. `bucket` keeps dedupe keys stable within a period;
 * `now` is the caller-supplied timestamp (no Date.now here). `fetchSnapshots` is
 * injectable for tests.
 */
export async function buildFeedItems(
  refs: TokenRef[],
  thresholds: PriceThresholds,
  bucket: string,
  now: number,
  fetchSnapshots: (refs: TokenRef[]) => Promise<TokenSnapshot[]> = defaultFetch,
): Promise<FeedItem[]> {
  if (refs.length === 0) return [];
  const snapshots = await fetchSnapshots(refs);
  const events = detectPriceMoves(snapshots, thresholds, bucket);
  return events.map((e) => {
    const n = narrate(e);
    return { id: n.key, key: n.key, ts: now, textKey: n.textKey, params: n.params };
  });
}
