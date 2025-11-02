import Vue from 'vue';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';
import { debugLog } from '@/utils/debug';

export interface LoadingState {
  loading: boolean;
  text: string;
  isSyncing: boolean;
  isRestoring: boolean;
  connected: boolean;
  connecting: boolean;
  loadingTxs: boolean;
}

// Create an observable state
export const loadingState = Vue.observable<LoadingState>({
  loading: false,
  text: '',
  isSyncing: false,
  isRestoring: false,
  connected: false,
  connecting: false,
  loadingTxs: false,
});

const STORE_NAME = 'loadingState';
const context = getContextType();

// Initialize messaging based on context
// IMPORTANT: Only browser context subscribes to background updates
// Background context directly updates local store via broadcastFromBackground()
if (context === 'browser') {
  debugLog(`🔌 Initializing loading store messaging in browser context`);

  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<LoadingState>) => {
    debugLog('📥 Received loading store update:', updates);

    // Apply updates to the observable state
    Object.keys(updates).forEach(key => {
      if (key in loadingState) {
        (loadingState as any)[key] = updates[key as keyof LoadingState];
      }
    });
  });

  // Initial hydration from chrome.storage
  // This is important because the port connection might happen AFTER critical state changes
  chrome.storage.local.get(STORE_NAME, (result) => {
    if (result[STORE_NAME]) {
      // Hydrate from storage immediately - this ensures we have the latest persisted state
      Object.assign(loadingState, result[STORE_NAME]);
      debugLog('💾 Hydrated loading store from storage:', {
        connected: result[STORE_NAME].connected,
        connecting: result[STORE_NAME].connecting,
        full: result[STORE_NAME]
      });
    }
  });
}

// Debounced storage write to reduce I/O operations
let storageWriteTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Broadcast updates from background context
 */
function broadcastFromBackground(updates: Partial<LoadingState>, immediate = false) {
  if (context === 'background') {
    // Apply updates locally first
    Object.assign(loadingState, updates);

    // Broadcast to all connected browser contexts (immediate)
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, updates);

    // For critical state changes (connected/connecting), write immediately to storage
    // so browser context gets correct state on hydration
    if (immediate || 'connected' in updates || 'connecting' in updates) {
      if (storageWriteTimeout) {
        clearTimeout(storageWriteTimeout);
        storageWriteTimeout = null;
      }
      chrome.storage.local.set({ [STORE_NAME]: loadingState });
      debugLog('💾 LoadingState persisted immediately:', updates);
    } else {
      // Debounced storage write for other updates to reduce I/O
      if (storageWriteTimeout) {
        clearTimeout(storageWriteTimeout);
      }

      storageWriteTimeout = setTimeout(() => {
        chrome.storage.local.set({ [STORE_NAME]: loadingState });
      }, 300); // 300ms debounce
    }
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
      debugLog('⏳ Loading state activated');
    }
  }),

  setText: createSetter('text'),

  setSyncing: createSetter('isSyncing', (v) => {
    if (v) {
      debugLog(`🔄 Starting sync operation from ${context} context`);
    }
  }),

  setRestoring: createSetter('isRestoring',
    (v) => {
      if (v) {
        debugLog(`🔄 Starting wallet restore from ${context} context`);
      } else {
        debugLog(`✅ Wallet restore completed from ${context} context`);
      }
    },
    (v) => ({
      loading: v,
      text: v ? loadingState.text : ''
    })
  ),

  setConnected: createSetter('connected', (v) => {
    if (loadingState.connected !== v) {
      debugLog(`🔗 Connection state changed to ${v ? 'connected' : 'disconnected'}`);
    }
  }),

  setConnecting: createSetter('connecting', (v) => {
    if (loadingState.connecting !== v) {
      debugLog(`🔌 Connecting state changed to ${v ? 'connecting' : 'idle'}`);
    }
  }),

  setLoadingTxs: createSetter('loadingTxs', (v) => {
    if (loadingState.loadingTxs !== v) {
      debugLog(`💳 Transaction loading state: ${v ? 'loading' : 'completed'}`);
    }
  }),

  // Expose the observable state
  state: loadingState,

  // Utility method to get the current state snapshot
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
      connecting: false,
      loadingTxs: false,
    };

    Object.assign(loadingState, resetState);
    broadcastFromBackground(resetState);
  }
};
