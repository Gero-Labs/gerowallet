// src/services/copilot/feedEngine.ts
import {
  detectPriceMoves,
  detectTokenActivitySpikes,
  type PriceThresholds,
  type TokenSnapshot,
  type TokenActivityRow,
  type ActivitySpikeOptions,
} from './detectors';
import { narrate } from './narrator';
import {
  fetchSnapshots as defaultFetch,
  fetchMarketActivity as defaultActivityFetch,
  type TokenRef,
} from './marketSnapshot';
import type { FeedItem } from './feedReducer';
import type { CopilotVibe } from './preferences';

/**
 * Orchestrate one detection pass: fetch snapshots for the refs, run detectors,
 * narrate, and return FeedItems. `bucket` keeps dedupe keys stable within a period;
 * `now` is the caller-supplied timestamp (no Date.now here). `fetchSnapshots` is
 * injectable for tests. `vibe` is the LAST param (after fetch) so existing 5-arg
 * callers keep binding fetch correctly; it only selects the narration tone.
 */
export async function buildFeedItems(
  refs: TokenRef[],
  thresholds: PriceThresholds,
  bucket: string,
  now: number,
  fetchSnapshots: (refs: TokenRef[]) => Promise<TokenSnapshot[]> = defaultFetch,
  vibe: CopilotVibe = 'normal',
): Promise<FeedItem[]> {
  if (refs.length === 0) return [];
  const snapshots = await fetchSnapshots(refs);
  const events = detectPriceMoves(snapshots, thresholds, bucket);
  return events.map((e) => {
    const n = narrate(e, vibe);
    return { id: n.key, key: n.key, ts: now, textKey: n.textKey, params: n.params };
  });
}

/**
 * Orchestrate one identity-free token-anomaly pass: fetch the bulk market activity,
 * detect volume spikes, narrate. Market-wide (not per-user-ref), so it takes no refs.
 * `fetchActivity` is injectable for tests; `now`/`bucket` are caller-supplied.
 */
export async function buildTokenAnomalyItems(
  options: ActivitySpikeOptions,
  bucket: string,
  now: number,
  fetchActivity: () => Promise<TokenActivityRow[]> = defaultActivityFetch,
  vibe: CopilotVibe = 'normal',
): Promise<FeedItem[]> {
  const rows = await fetchActivity();
  if (rows.length === 0) return [];
  const events = detectTokenActivitySpikes(rows, options, bucket);
  return events.map((e) => {
    const n = narrate(e, vibe);
    return { id: n.key, key: n.key, ts: now, textKey: n.textKey, params: n.params };
  });
}
