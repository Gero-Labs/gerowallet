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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['loadingState']) {
    Object.assign(loadingState, changes['loadingState'].newValue);
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
