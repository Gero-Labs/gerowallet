import Vue from 'vue';
import coinGeckoApi from '@/api/coinGecko.api';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';

export interface CoinGeckoStore {
  cache: Record<string, any>;
}

// Create observable state
export const coinGeckoStore = Vue.observable<CoinGeckoStore>({
  cache: {}
});

const STORE_NAME = 'coinGeckoStore';
const context = getContextType();

// Initialize messaging based on context
if (context === 'browser') {
  console.debug(`🔌 Initializing coinGecko store messaging in browser context`);
  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<CoinGeckoStore>) => {
    console.debug('📥 Received coinGecko store update:', updates);

    // Apply updates to the observable state
    Object.keys(updates).forEach(key => {
      if (key in coinGeckoStore) {
        (coinGeckoStore as any)[key] = updates[key as keyof CoinGeckoStore];
      }
    });
  });

  // Initial hydration from chrome.storage (fallback for initial state)
  chrome.storage.local.get(STORE_NAME, (result) => {
    if (result[STORE_NAME]) {
      Object.assign(coinGeckoStore, result[STORE_NAME]);
      console.debug('💾 Hydrated coinGecko store from storage:', result[STORE_NAME]);
    }
  });
}

/**
 * Broadcast updates from the background context
 */
function broadcastFromBackground(updates: Partial<CoinGeckoStore>) {
  if (context === 'background') {
    // Broadcast to all connected browser contexts
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, updates);

    // Also persist to storage as fallback
    // Handle serialization for complex types
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

    chrome.storage.local.get(STORE_NAME, (result) => {
      const current = result[STORE_NAME] || { cache: {} };
      chrome.storage.local.set({
        [STORE_NAME]: { ...current, ...serializedUpdates }
      });
    });
  }
}

export default {
  async updatePrices() {
    try {
      const res = await coinGeckoApi.getSimplePrice();
      this.setCache(res.data);
    } catch (e) {
      console.warn('Failed to update CoinGecko prices:', e);
    }
  },

  setCache(cache: Record<string, any>) {
    coinGeckoStore.cache = cache;

    // Broadcast from background context
    broadcastFromBackground({ cache });
  },

  // Expose the observable state
  state: coinGeckoStore,

  // Utility method to get current state snapshot
  getSnapshot(): CoinGeckoStore {
    return { ...coinGeckoStore };
  },

  // Utility method to reset state
  reset() {
    const resetState: CoinGeckoStore = {
      cache: {}
    };

    Object.assign(coinGeckoStore, resetState);
    broadcastFromBackground(resetState);
  },

  // Utility method to get price for a specific coin
  getPrice(coinId: string): number | undefined {
    return coinGeckoStore.cache[coinId]?.usd;
  },

  // Utility method to check if the cache is stale (older than 5 minutes)
  isCacheStale(maxAge: number = 5 * 60 * 1000): boolean {
    const cacheTimestamp = coinGeckoStore.cache._timestamp;
    if (!cacheTimestamp) return true;
    return Date.now() - cacheTimestamp > maxAge;
  }
};
