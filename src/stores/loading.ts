import Vue from 'vue';

export interface LoadingState {
  loading: boolean;
  text: string;
  isSyncing: boolean;
  isRestoring: boolean;
  connected: boolean;
  loadingTxs: boolean;
}

export const loadingState = Vue.observable<LoadingState>({
  loading: false,
  text: '',
  isSyncing: false,
  isRestoring: false,
  connected: false,
  loadingTxs: false,
});

chrome.storage.local.get('loadingState', (res) => {
  if (res['loadingState']) {
    Object.assign(loadingState, res['loadingState']);
  }
});

const SYNC_KEYS = ['loading', 'text', 'isSyncing', 'isRestoring', 'connected', 'loadingTxs'];

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  const loadingStoreChanges = changes['loadingState'];
  if (!loadingStoreChanges) return;

  const { newValue, oldValue } = loadingStoreChanges;
  if (!newValue) return;

  // Check if any of our sync keys changed
  const hasRelevantChanges = SYNC_KEYS.some(key => {
    const oldVal = oldValue?.[key];
    const newVal = newValue[key];
    return JSON.stringify(oldVal) !== JSON.stringify(newVal);
  });

  if (hasRelevantChanges) {
    console.debug('🔄 Cross-context sync: updating wallet store from background changes');

    // Only update the keys that actually changed to prevent overwrite issues
    SYNC_KEYS.forEach(key => {
      const oldVal = oldValue?.[key];
      const newVal = newValue[key];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        console.debug(`📝 Syncing ${key} from background`);
        loadingState[key] = newVal;
      }
    });
  }
});

function persist(patch: Partial<LoadingState>) {
  const next = { ...loadingState, ...patch };
  chrome.storage.local.set({ loadingState: next });
}

export default {
  setLoading(v: boolean) {
    loadingState.loading = v;
    persist({ loading: v });
  },
  setText(v: string) {
    loadingState.text = v;
    persist({ text: v });
  },
  setSyncing(v: boolean) {
    loadingState.isSyncing = v;
    persist({ isSyncing: v });
  },
  setRestoring(v: boolean)  {
    if (!v)
      persist({ text: '' });
    loadingState.isRestoring = v;
    loadingState.loading     = v;
    persist({ isRestoring: v, loading: v });
  },
  setConnected(v: boolean) {
    loadingState.connected = v;
    persist({ connected: v });
  },
  setLoadingTxs(v: boolean) {
    loadingState.loadingTxs = v;
    persist({ loadingTxs: v });
  },
  state: loadingState
};
