import Vue from 'vue';
import { createStorageSync, smartPersist, hydrateStore, getContextType } from '@/utils/storageSync';

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
// loadingTxs is included in sync but only persisted from background context
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
    const context = getContextType();
    loadingState.loading = v;
    
    // Only persist from background context to prevent cross-context conflicts
    if (context === 'background') {
      persist({ loading: v });
    }
  },
  setText(v: string) {
    const context = getContextType();
    loadingState.text = v;
    
    // Only persist from background context to prevent cross-context conflicts
    if (context === 'background') {
      persist({ text: v });
    }
  },
  setSyncing(v: boolean) {
    const context = getContextType();
    // Only log when actually starting sync operations (crucial state change)
    if (v) {
      console.debug(`🔄 Starting sync operation from ${context} context`);
    }
    loadingState.isSyncing = v;
    
    // Only persist from background context to prevent cross-context conflicts
    if (context === 'background') {
      persist({ isSyncing: v });
    }
  },
  setRestoring(v: boolean)  {
    const context = getContextType();
    // Only log when starting/finishing restore operations (crucial state change)
    if (v) {
      console.debug(`🔄 Starting wallet restore from ${context} context`);
    } else {
      console.debug(`✅ Wallet restore completed from ${context} context`);
    }
    
    loadingState.isRestoring = v;
    loadingState.loading     = v;
    
    // Only persist from background context to prevent cross-context conflicts
    if (context === 'background') {
      if (!v) {
        persist({ text: '', isRestoring: v, loading: v });
      } else {
        persist({ isRestoring: v, loading: v });
      }
    }
  },
  setConnected(v: boolean) {
    const context = getContextType();
    // Only log connection state changes (crucial for user awareness)
    if (loadingState.connected !== v) {
      console.debug(`🔗 Connection state changed to ${v ? 'connected' : 'disconnected'}`);
    }
    loadingState.connected = v;
    
    // Only persist from background context to prevent cross-context conflicts
    if (context === 'background') {
      persist({ connected: v });
    }
  },
  setLoadingTxs(v: boolean) {
    const context = getContextType();
    // Only log when there's an actual state change and only for crucial debugging
    if (loadingState.loadingTxs !== v) {
      console.debug(`💳 Transaction loading state: ${v ? 'loading' : 'completed'}`);
    }
    loadingState.loadingTxs = v;
    
    // Only persist from background context to prevent cross-context conflicts
    if (context === 'background') {
      persist({ loadingTxs: v });
    }
  },
  state: loadingState
};
