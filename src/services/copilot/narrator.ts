// src/services/copilot/narrator.ts
import type { FeedEvent } from './detectors';

export interface NarratedItem {
  key: string;
  textKey: string;
  params: Record<string, string | number>;
}

/** Pure: map a detected event to an i18n template key + params. Observer voice only - no advice. */
export function narrate(event: FeedEvent): NarratedItem {
  const dir = event.kind === 'priceUp' ? 'Up' : 'Down';
  const scope = event.held ? 'held' : 'watched';
  return {
    key: event.key,
    textKey: `copilot.feed.${scope}Price${dir}`,
    params: { ticker: event.ticker, pct: event.pct, window: event.window },
  };
}
