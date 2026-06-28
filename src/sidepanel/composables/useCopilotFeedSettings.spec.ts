import { describe, it, expect } from 'vitest';
import { createCopilotFeedSettings } from './useCopilotFeedSettings';
import { defaultPrefs, type CopilotVibe, type CopilotCategoryFlags } from '@/services/copilot/preferences';

function fakeStore() {
  const prefs = defaultPrefs();
  return {
    get vibe() { return prefs.vibe; },
    get categories() { return prefs.categories; },
    get onboardingDone() { return prefs.onboardingDone; },
    setVibe(v: CopilotVibe) { prefs.vibe = v; },
    setCategory(k: keyof CopilotCategoryFlags, on: boolean) {
      prefs.categories = { ...prefs.categories, [k]: on };
    },
    completeOnboarding() { prefs.onboardingDone = true; },
    resetOnboarding() { prefs.onboardingDone = false; },
    reset() { Object.assign(prefs, defaultPrefs()); },
  };
}

describe('useCopilotFeedSettings', () => {
  it('setVibe updates the store and derived thresholds', () => {
    const store = fakeStore();
    const s = createCopilotFeedSettings({ store });
    expect(s.thresholds()).toEqual({ pct24h: 15, pct7d: 25 }); // normal default
    s.setVibe('spicy');
    expect(store.vibe).toBe('spicy');
    expect(s.thresholds()).toEqual({ pct24h: 8, pct7d: 15 });
  });

  it('setCategory flips a flag', () => {
    const store = fakeStore();
    const s = createCopilotFeedSettings({ store });
    s.setCategory('bags', false);
    expect(store.categories.bags).toBe(false);
  });

  it('completeOnboarding / resetOnboarding toggle the onboarded flag', () => {
    const store = fakeStore();
    const s = createCopilotFeedSettings({ store });
    expect(s.onboarded).toBe(false);
    s.completeOnboarding();
    expect(s.onboarded).toBe(true);
    s.resetOnboarding();
    expect(s.onboarded).toBe(false);
  });

  it('reset restores defaults', () => {
    const store = fakeStore();
    const s = createCopilotFeedSettings({ store });
    s.setVibe('chill');
    s.completeOnboarding();
    s.reset();
    expect(store.vibe).toBe('normal');
    expect(store.onboardingDone).toBe(false);
  });
});
