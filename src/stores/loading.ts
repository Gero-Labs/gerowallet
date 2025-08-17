import Vue from 'vue';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';

export interface LoadingState {
  loading: boolean;
  text: string;
  isSyncing: boolean;
  isRestoring: boolean;
  connected: boolean;
  loadingTxs: boolean;
}

// Create observable state
export const loadingState = Vue.observable<LoadingState>({
  loading: false,
  text: '',
  isSyncing: false,
  isRestoring: false,
  connected: false,
  loadingTxs: false,
});

const STORE_NAME = 'loadingState';
const context = getContextType();

// Initialize messaging based on context
if (context === 'browser') {
  console.debug(`🔌 Initializing loading store messaging in browser context`);
  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<LoadingState>) => {
    console.debug('📥 Received loading store update:', updates);
    
    // Apply updates to the observable state
    Object.keys(updates).forEach(key => {
      if (key in loadingState) {
        (loadingState as any)[key] = updates[key as keyof LoadingState];
      }
    });
  });

  // Initial hydration from chrome.storage (fallback for initial state)
  chrome.storage.local.get(STORE_NAME, (result) => {
    if (result[STORE_NAME]) {
      Object.assign(loadingState, result[STORE_NAME]);
      console.debug('💾 Hydrated loading store from storage:', result[STORE_NAME]);
    }
  });
}

/**
 * Broadcast updates from background context
 */
function broadcastFromBackground(updates: Partial<LoadingState>) {
  if (context === 'background') {
    // Apply updates locally first
    Object.assign(loadingState, updates);
    
    // Broadcast to all connected browser contexts
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, updates);
    
    // Also persist to storage as fallback
    chrome.storage.local.set({ [STORE_NAME]: loadingState });
  }
}

/**
 * Create a setter that handles both local update and broadcasting
 */
function createSetter<K extends keyof LoadingState>(
  key: K,
  beforeSet?: (value: LoadingState[K]) => void,
  additionalUpdates?: (value: LoadingState[K]) => Partial<LoadingState>
) {
  return (value: LoadingState[K]) => {
    // Run any pre-set logic
    if (beforeSet) {
      beforeSet(value);
    }

    // Update local state
    loadingState[key] = value;

    // Prepare updates
    let updates: Partial<LoadingState> = { [key]: value };
    
    // Add any additional updates
    if (additionalUpdates) {
      updates = { ...updates, ...additionalUpdates(value) };
      // Apply additional updates locally
      Object.keys(updates).forEach(updateKey => {
        if (updateKey !== key && updateKey in loadingState) {
          (loadingState as any)[updateKey] = updates[updateKey as keyof LoadingState];
        }
      });
    }

    // Broadcast from background context
    broadcastFromBackground(updates);
  };
}

export default {
  setLoading: createSetter('loading', (v) => {
    if (context === 'background' && v) {
      console.debug('⏳ Loading state activated');
    }
  }),

  setText: createSetter('text'),

  setSyncing: createSetter('isSyncing', (v) => {
    if (v) {
      console.debug(`🔄 Starting sync operation from ${context} context`);
    }
  }),

  setRestoring: createSetter('isRestoring', 
    (v) => {
      if (v) {
        console.debug(`🔄 Starting wallet restore from ${context} context`);
      } else {
        console.debug(`✅ Wallet restore completed from ${context} context`);
      }
    },
    (v) => ({
      loading: v,
      text: v ? loadingState.text : ''
    })
  ),

  setConnected: createSetter('connected', (v) => {
    if (loadingState.connected !== v) {
      console.debug(`🔗 Connection state changed to ${v ? 'connected' : 'disconnected'}`);
    }
  }),

  setLoadingTxs: createSetter('loadingTxs', (v) => {
    if (loadingState.loadingTxs !== v) {
      console.debug(`💳 Transaction loading state: ${v ? 'loading' : 'completed'}`);
    }
  }),

  // Expose the observable state
  state: loadingState,

  // Utility method to get current state snapshot
  getSnapshot(): LoadingState {
    return { ...loadingState };
  },

  // Utility method to reset state
  reset() {
    const resetState: LoadingState = {
      loading: false,
      text: '',
      isSyncing: false,
      isRestoring: false,
      connected: false,
      loadingTxs: false,
    };
    
    Object.assign(loadingState, resetState);
    broadcastFromBackground(resetState);
  }
};