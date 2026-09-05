// src/stores/agentDockPrefsStore.ts
// One persisted user preference: whether the Gero Companion dock (the floating
// support/assistant FAB) is hidden. It is a deliberate user choice, not a
// feature flag — the flags decide whether the dock CAN exist, this decides
// whether the user wants to see it, because the FAB is fixed-positioned and can
// sit over content the user is trying to read.
//
// Mirrors copilotPrefsStore's lightweight pattern: a Vue.observable +
// chrome.storage.local with a load-on-init read and a storage.onChanged
// listener, so the dashboard and the Settings toggle stay in sync while both
// are on screen. No debounce (a single boolean flipped by hand, not a stream of
// writes) and no background broadcast (UI-mutated only).
import Vue from 'vue';

const STORE_KEY = 'agentDockPrefs';

export interface AgentDockPrefs {
  hidden: boolean;
  /**
   * False until the chrome.storage read comes back. Consumers gate the dock's
   * first render on this: the read is async, so rendering on the `hidden: false`
   * default would flash the FAB on every dashboard load for users who hid it.
   */
  hydrated: boolean;
}

export const agentDockPrefsState = Vue.observable<AgentDockPrefs>({
  hidden: false,
  hydrated: false,
});

const hasChromeStorage = typeof chrome !== 'undefined' && !!chrome.storage?.local;

if (hasChromeStorage) {
  chrome.storage.local.get(STORE_KEY, (res) => {
    const saved = res[STORE_KEY] as Partial<AgentDockPrefs> | undefined;
    if (typeof saved?.hidden === 'boolean') agentDockPrefsState.hidden = saved.hidden;
    agentDockPrefsState.hydrated = true;
  });

  // Keep surfaces in sync when more than one is open (e.g. hidden from the dock
  // in one dashboard tab while the Settings toggle is open in another).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORE_KEY]) return;
    const next = changes[STORE_KEY].newValue as Partial<AgentDockPrefs> | undefined;
    const hidden = !!next?.hidden;
    if (hidden !== agentDockPrefsState.hidden) agentDockPrefsState.hidden = hidden;
  });
} else {
  // No extension storage (unit tests, plain-page contexts): nothing to wait for.
  agentDockPrefsState.hydrated = true;
}

export const agentDockPrefsStore = {
  state: agentDockPrefsState,
  get hidden(): boolean {
    return agentDockPrefsState.hidden;
  },
  get hydrated(): boolean {
    return agentDockPrefsState.hydrated;
  },
  setHidden(hidden: boolean): void {
    if (agentDockPrefsState.hidden === hidden) return;
    agentDockPrefsState.hidden = hidden;
    if (hasChromeStorage) chrome.storage.local.set({ [STORE_KEY]: { hidden } });
  },
};

export default agentDockPrefsStore;
