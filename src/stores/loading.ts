import Vue from 'vue';
import { createStorageSync, smartPersist, hydrateStore } from '@/utils/storageSync';

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

// Initialize store with centralized storage sync
const SYNC_KEYS = ['loading', 'text', 'isSyncing', 'isRestoring', 'connected', 'loadingTxs'];

// Hydrate from storage on initialization
hydrateStore('loadingState', loadingState);

// Set up centralized storage sync
const unsubscribe = createStorageSync(loadingState, {
  storeName: 'loadingState',
  syncKeys: SYNC_KEYS,
  debugPrefix: '🔄 LoadingStore'
});

// Clean up on unload (for contexts that support it)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', unsubscribe);
}

async function persist(patch: Partial<LoadingState>): Promise<void> {
  const next = { ...loadingState, ...patch };
  await smartPersist('loadingState', next);
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
