// src/services/copilot/preferences.ts
// Pure preferences model for the proactive Copilot feed: the single source of truth
// for the "vibe" sensitivity dial and which event categories are active. No chrome,
// no Date.now, no Vue - persistence lives in copilotPrefsStore.ts.
import type { PriceThresholds } from './detectors';

export type CopilotVibe = 'chill' | 'normal' | 'spicy';

export interface CopilotCategoryFlags {
  bags: boolean; // held tokens (walletStore.tokens)
  watchlist: boolean; // watched tokens (useWatchlist)
  whales: boolean; // coming soon - no detector yet
  launches: boolean; // coming soon - no detector yet
  governance: boolean; // coming soon - no detector yet
}

export interface CopilotPrefs {
  vibe: CopilotVibe;
  categories: CopilotCategoryFlags;
  onboardingDone: boolean;
}

/**
 * Vibe -> price-move sensitivity. chill surfaces only the bigger moves; spicy
 * surfaces smaller ones; normal == the original hardcoded thresholds. The vibe
 * changes WHAT clears the bar (and the narration tone), never adds advice.
 */
export const VIBE_THRESHOLDS: Record<CopilotVibe, PriceThresholds> = {
  chill: { pct24h: 25, pct7d: 40 },
  normal: { pct24h: 15, pct7d: 25 },
  spicy: { pct24h: 8, pct7d: 15 },
};

const VIBES: readonly CopilotVibe[] = ['chill', 'normal', 'spicy'];

function isVibe(v: unknown): v is CopilotVibe {
  return typeof v === 'string' && (VIBES as readonly string[]).includes(v);
}

/** Thresholds for a vibe; unknown/missing falls back to normal. */
export function thresholdsForVibe(vibe: string | undefined): PriceThresholds {
  return VIBE_THRESHOLDS[isVibe(vibe) ? vibe : 'normal'];
}

/** A fresh default-prefs object (no shared mutable state between calls). */
export function defaultPrefs(): CopilotPrefs {
  return {
    vibe: 'normal',
    categories: {
      bags: true,
      watchlist: true,
      whales: false,
      launches: false,
      governance: false,
    },
    onboardingDone: false,
  };
}

/**
 * Clamp arbitrary (e.g. persisted) input into a valid CopilotPrefs: unknown vibe
 * -> normal, missing categories -> their defaults, junk dropped, values coerced
 * to booleans. Coming-soon categories are never forced on when absent.
 */
export function normalizePrefs(raw: unknown): CopilotPrefs {
  const base = defaultPrefs();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;

  if (isVibe(r['vibe'])) base.vibe = r['vibe'];

  if (r['categories'] && typeof r['categories'] === 'object') {
    const c = r['categories'] as Record<string, unknown>;
    (Object.keys(base.categories) as (keyof CopilotCategoryFlags)[]).forEach((k) => {
      if (k in c) base.categories[k] = Boolean(c[k]);
    });
  }

  if ('onboardingDone' in r) base.onboardingDone = Boolean(r['onboardingDone']);

  return base;
}
