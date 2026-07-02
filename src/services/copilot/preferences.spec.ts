import { describe, it, expect } from 'vitest';
import {
  thresholdsForVibe,
  defaultPrefs,
  normalizePrefs,
  VIBE_THRESHOLDS,
} from './preferences';

describe('thresholdsForVibe', () => {
  it('maps each vibe to its sensitivity thresholds', () => {
    expect(thresholdsForVibe('chill')).toEqual({ pct24h: 25, pct7d: 40 });
    expect(thresholdsForVibe('normal')).toEqual({ pct24h: 15, pct7d: 25 });
    expect(thresholdsForVibe('spicy')).toEqual({ pct24h: 8, pct7d: 15 });
  });

  it('falls back to normal for unknown/missing vibe', () => {
    expect(thresholdsForVibe(undefined)).toEqual(VIBE_THRESHOLDS.normal);
    expect(thresholdsForVibe('garbage')).toEqual(VIBE_THRESHOLDS.normal);
  });
});

describe('defaultPrefs', () => {
  it('defaults to normal vibe, bags+watchlist on, coming-soon off, onboarding not done', () => {
    expect(defaultPrefs()).toEqual({
      vibe: 'normal',
      categories: {
        bags: true,
        watchlist: true,
        whales: false,
        launches: false,
        governance: false,
      },
      onboardingDone: false,
    });
  });

  it('returns a fresh object each call (no shared mutable state)', () => {
    const a = defaultPrefs();
    a.categories.bags = false;
    expect(defaultPrefs().categories.bags).toBe(true);
  });
});

describe('normalizePrefs', () => {
  it('returns defaults for undefined/null/non-object input', () => {
    expect(normalizePrefs(undefined)).toEqual(defaultPrefs());
    expect(normalizePrefs(null)).toEqual(defaultPrefs());
    expect(normalizePrefs('nope')).toEqual(defaultPrefs());
  });

  it('keeps known fields, defaults missing ones, and drops junk', () => {
    expect(
      normalizePrefs({ vibe: 'spicy', categories: { bags: false }, onboardingDone: true, junk: 1 }),
    ).toEqual({
      vibe: 'spicy',
      categories: {
        bags: false,
        watchlist: true,
        whales: false,
        launches: false,
        governance: false,
      },
      onboardingDone: true,
    });
  });

  it('falls back to normal for an unknown vibe', () => {
    expect(normalizePrefs({ vibe: 'loud' }).vibe).toBe('normal');
  });

  it('never forces a coming-soon category on when absent', () => {
    const p = normalizePrefs({});
    expect(p.categories.whales).toBe(false);
    expect(p.categories.launches).toBe(false);
    expect(p.categories.governance).toBe(false);
  });

  it('coerces non-boolean category/onboarding values to booleans', () => {
    const p = normalizePrefs({ categories: { bags: 0, whales: 1 }, onboardingDone: 'yes' });
    expect(p.categories.bags).toBe(false);
    expect(p.categories.whales).toBe(true);
    expect(p.onboardingDone).toBe(true);
  });
});
