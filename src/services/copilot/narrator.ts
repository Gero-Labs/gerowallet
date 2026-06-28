// src/services/copilot/narrator.ts
import type { FeedEvent } from './detectors';
import type { CopilotVibe } from './preferences';

export interface NarratedItem {
  key: string;
  textKey: string;
  params: Record<string, string | number>;
}

/**
 * Every i18n key the narrator can emit (vibe x scope x direction). Single source of
 * truth shared by the narrator, the no-advice scan, and the EN/DE coverage test
 * (Task 11), so a key-prefix typo can never silently surface as a raw key at runtime.
 * `normal` reuses the original 4 keys (no vibe prefix); chill/spicy add 8 more.
 */
export const NARRATION_TEXT_KEYS = [
  'copilot.feed.heldPriceUp',
  'copilot.feed.heldPriceDown',
  'copilot.feed.watchedPriceUp',
  'copilot.feed.watchedPriceDown',
  'copilot.feed.chill.heldPriceUp',
  'copilot.feed.chill.heldPriceDown',
  'copilot.feed.chill.watchedPriceUp',
  'copilot.feed.chill.watchedPriceDown',
  'copilot.feed.spicy.heldPriceUp',
  'copilot.feed.spicy.heldPriceDown',
  'copilot.feed.spicy.watchedPriceUp',
  'copilot.feed.spicy.watchedPriceDown',
] as const;

/**
 * Pure: map a detected event to an i18n template key + params. Observer voice only -
 * no advice. The `vibe` only SELECTS which template family is used (tone); `normal`
 * keeps the original keys. The observational guarantee lives in the i18n strings and
 * is enforced by the no-advice scan over NARRATION_TEXT_KEYS.
 */
export function narrate(event: FeedEvent, vibe: CopilotVibe = 'normal'): NarratedItem {
  const dir = event.kind === 'priceUp' ? 'Up' : 'Down';
  const scope = event.held ? 'held' : 'watched';
  const prefix = vibe === 'normal' ? '' : `${vibe}.`;
  return {
    key: event.key,
    textKey: `copilot.feed.${prefix}${scope}Price${dir}`,
    params: { ticker: event.ticker, pct: event.pct, window: event.window },
  };
}
