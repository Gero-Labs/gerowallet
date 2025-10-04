import Vue from 'vue';
import cashbackApi from '@/api/cashback-api';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';
import { debugLog } from '@/utils/debug';

export interface BringStore {
  bringCache: any;
}

export const bringStore = Vue.observable<BringStore>({
  bringCache: undefined,
});

const STORE_NAME = 'bringStore';
const context = getContextType();

// Initialize messaging based on context
// IMPORTANT: Only browser context subscribes to background updates
// Background context directly updates local store via broadcastFromBackground()
if (context === 'browser') {
  debugLog(`🔌 Initializing bring store messaging in browser context`);
  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<BringStore>) => {
    debugLog('📥 Received bring store update:', updates);

    // Apply updates to the observable state
    Object.keys(updates).forEach(key => {
      if (key in bringStore) {
        (bringStore as any)[key] = updates[key as keyof BringStore];
      }
    });
  });

  // Initial hydration from chrome.storage (fallback for initial state)
  chrome.storage.local.get(STORE_NAME, (result) => {
    if (result[STORE_NAME]) {
      Object.assign(bringStore, result[STORE_NAME]);
      debugLog('💾 Hydrated bring store from storage');
    }
  });
}

/**
 * Broadcast updates from background context
 */
function broadcastFromBackground(updates: Partial<BringStore>) {
  if (context === 'background') {
    // Serialize data for broadcasting
    const serializedUpdates = JSON.parse(JSON.stringify(updates, (key, value) => {
      if (value instanceof Map) {
        return Array.from(value.entries()).reduce((obj, [key, value]) => {
          obj[key] = value;
          return obj;
        }, {});
      } else if (typeof value === 'bigint') {
        return value.toString();
      } else {
        return value;
      }
    }));
    
    // Broadcast to all connected browser contexts
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, serializedUpdates);
    
    // Also persist to storage as fallback
    chrome.storage.local.get(STORE_NAME, (result) => {
      const current = result[STORE_NAME] || { bringCache: undefined };
      chrome.storage.local.set({ 
        [STORE_NAME]: { ...current, ...serializedUpdates } 
      });
    });
  }
}

export default {
  async loadBringCache(baseAddress: string) {
    try {
      const bringCache = await cashbackApi.cache(baseAddress);
      this.setBringCache(bringCache);
    } catch (e) {
      console.log(e)
    }
  },
  setBringCache(bringCache: any) {
    bringStore.bringCache = bringCache;
    broadcastFromBackground({ bringCache });
  },
  state: bringStore,
  
  // Utility method to get current state snapshot
  getSnapshot(): BringStore {
    return { ...bringStore };
  },
  
  // Utility method to reset state
  reset() {
    const resetState: BringStore = {
      bringCache: undefined
    };
    
    Object.assign(bringStore, resetState);
    broadcastFromBackground(resetState);
  },
  
  // Utility method to check if cache exists
  hasCache(): boolean {
    return bringStore.bringCache !== undefined;
  },
  
  // Utility method to get cache data
  getCache(): any {
    return bringStore.bringCache;
  },
  
  // Utility method to clear cache
  clearCache() {
    bringStore.bringCache = undefined;
    broadcastFromBackground({ bringCache: undefined });
  }
};
