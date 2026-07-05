// src/stores/copilotPrefsStore.ts
// Persisted user preferences for the proactive Copilot feed (vibe sensitivity +
// active categories + first-run flag). Mirrors copilotFeedStore's lightweight
// pattern: a Vue.observable + chrome.storage.local with a debounced write and a
// load-on-init read. UI-mutated only, so no background broadcast - but it DOES
// listen for cross-surface changes so the sidepanel and dashboard stay in sync
// when both are open (self-echo guarded to avoid write churn).
import Vue from 'vue';
import {
  defaultPrefs,
  normalizePrefs,
  type CopilotPrefs,
  type CopilotVibe,
  type CopilotCategoryFlags,
} from '@/services/copilot/preferences';

const STORE_KEY = 'copilotPrefsStore';

export const copilotPrefsState = Vue.observable<CopilotPrefs>(defaultPrefs());

const hasChromeStorage = typeof chrome !== 'undefined' && !!chrome.storage?.local;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function snapshot(): CopilotPrefs {
  return {
    vibe: copilotPrefsState.vibe,
    categories: { ...copilotPrefsState.categories },
    onboardingDone: copilotPrefsState.onboardingDone,
  };
}

function apply(prefs: CopilotPrefs): void {
  copilotPrefsState.vibe = prefs.vibe;
  copilotPrefsState.categories = prefs.categories;
  copilotPrefsState.onboardingDone = prefs.onboardingDone;
}

if (hasChromeStorage) {
  chrome.storage.local.get(STORE_KEY, (res) => {
    const saved = res[STORE_KEY];
    if (saved) apply(normalizePrefs(saved));
  });

  // Keep surfaces in sync when both are open. Ignore our own echoed writes.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORE_KEY]?.newValue) return;
    const incoming = JSON.stringify(changes[STORE_KEY].newValue);
    if (incoming === JSON.stringify(snapshot())) return; // our own write echoing back
    apply(normalizePrefs(changes[STORE_KEY].newValue));
  });
}

function persist(): void {
  if (!hasChromeStorage) return;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    chrome.storage.local.set({ [STORE_KEY]: snapshot() });
  }, 300);
}

export const copilotPrefsStore = {
  state: copilotPrefsState,
  get vibe(): CopilotVibe {
    return copilotPrefsState.vibe;
  },
  get categories(): CopilotCategoryFlags {
    return copilotPrefsState.categories;
  },
  get onboardingDone(): boolean {
    return copilotPrefsState.onboardingDone;
  },
  setVibe(v: CopilotVibe): void {
    copilotPrefsState.vibe = v;
    persist();
  },
  setCategory(k: keyof CopilotCategoryFlags, on: boolean): void {
    // reassign the object so Vue 2 picks up the change reactively
    copilotPrefsState.categories = { ...copilotPrefsState.categories, [k]: on };
    persist();
  },
  completeOnboarding(): void {
    copilotPrefsState.onboardingDone = true;
    persist();
  },
  resetOnboarding(): void {
    copilotPrefsState.onboardingDone = false;
    persist();
  },
  reset(): void {
    apply(defaultPrefs());
    persist();
  },
};
