// src/sidepanel/composables/useCopilotFeedSettings.ts
// Thin, testable wrapper over copilotPrefsStore so feed UI (wizard + settings sheet,
// on both surfaces) reads/writes prefs through one surface. Deps-injected like
// createCopilotFeed so tests can pass a fake store. Reads stay live because the
// store is a Vue.observable (getters proxy straight through).
import { thresholdsForVibe, type CopilotVibe, type CopilotCategoryFlags } from '@/services/copilot/preferences';
import type { PriceThresholds } from '@/services/copilot/detectors';
import { copilotPrefsStore } from '@/stores/copilotPrefsStore';

export interface PrefsStoreLike {
  readonly vibe: CopilotVibe;
  readonly categories: CopilotCategoryFlags;
  readonly onboardingDone: boolean;
  setVibe(v: CopilotVibe): void;
  setCategory(k: keyof CopilotCategoryFlags, on: boolean): void;
  completeOnboarding(): void;
  resetOnboarding(): void;
  reset(): void;
}

export function createCopilotFeedSettings(deps: { store?: PrefsStoreLike } = {}) {
  const store = deps.store ?? copilotPrefsStore;

  return {
    get vibe(): CopilotVibe {
      return store.vibe;
    },
    get categories(): CopilotCategoryFlags {
      return store.categories;
    },
    get onboarded(): boolean {
      return store.onboardingDone;
    },
    thresholds(): PriceThresholds {
      return thresholdsForVibe(store.vibe);
    },
    setVibe: (v: CopilotVibe) => store.setVibe(v),
    setCategory: (k: keyof CopilotCategoryFlags, on: boolean) => store.setCategory(k, on),
    completeOnboarding: () => store.completeOnboarding(),
    resetOnboarding: () => store.resetOnboarding(),
    reset: () => store.reset(),
  };
}

export const copilotFeedSettings = createCopilotFeedSettings();
