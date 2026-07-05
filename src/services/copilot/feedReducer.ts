// src/services/copilot/feedReducer.ts
export interface FeedItem {
  id: string;
  key: string; // dedupe key (e.g. "priceUp:SNEK:2026-06-26")
  ts: number; // event time (ms) - passed in; do not call Date.now() here
  textKey: string; // i18n key for the friend message
  params: Record<string, string | number>;
}

export interface FeedState {
  items: FeedItem[]; // newest-first
  seen: string[]; // recently-seen keys (oldest-first), capped to max
}

/** Pure: append new (unseen) items newest-first, dedupe by key, cap items and seen-set to max. */
export function addFeedItems(state: FeedState, incoming: FeedItem[], max: number): FeedState {
  const seenSet = new Set(state.seen);
  const fresh = incoming.filter((i) => !seenSet.has(i.key));
  const items = [...fresh].sort((a, b) => b.ts - a.ts).concat(state.items).slice(0, max);
  const seen = [...state.seen, ...fresh.map((i) => i.key)].slice(-max);
  return { items, seen };
}
