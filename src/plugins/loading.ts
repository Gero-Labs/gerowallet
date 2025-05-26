// src/plugins/loading.ts
import Vue from 'vue';

export interface LoadingState {
  loading:     boolean;
  text:        string;
  isSyncing:   boolean;
  isRestoring: boolean;
}

// 1) Reactive state for Vue‐2
export const loadingState = Vue.observable<LoadingState>({
  loading:     false,
  text:        '',
  isSyncing:   false,
  isRestoring: false
});

// 2) Hydrate from storage on load
chrome.storage.local.get('loadingState', (res) => {
  if (res.loadingState) {
    Object.assign(loadingState, res.loadingState);
  }
});

// 3) Listen for changes from any context
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.loadingState) {
    Object.assign(loadingState, changes.loadingState.newValue);
  }
});

// 4) Helper to persist partial updates
function persist(patch: Partial<LoadingState>) {
  const next = { ...loadingState, ...patch };
  chrome.storage.local.set({ loadingState: next });
}

// 5) Export setters that both BG & UI can call
export default {
  setLoading(v: boolean)    { loadingState.loading = v;    persist({ loading: v }); },
  setText(v: string)        { loadingState.text    = v;    persist({ text: v }); },
  setSyncing(v: boolean)    { loadingState.isSyncing = v;  persist({ isSyncing: v }); },
  setRestoring(v: boolean)  {
    if (!v) persist({ text: '' });
    loadingState.isRestoring = v;
    loadingState.loading     = v;
    persist({ isRestoring: v, loading: v });
  },
  // expose the state for the UI
  state: loadingState
};
