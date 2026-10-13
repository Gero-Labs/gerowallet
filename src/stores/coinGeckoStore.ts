import { plainStoreSnapshot } from '@/stores/serialization';
import { reactive } from 'vue';
import coinGeckoApi from '@/api/coinGecko.api';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';

interface CoinQuote { usd?: number; usd_24h_change?: number; usd_market_cap?: number; usd_24h_vol?: number }
interface CoinCache {
  [key: string]: CoinQuote | number;
  'apex-4'?: CoinQuote;
  cardano?: CoinQuote;
  _timestamp?: number;
}
export interface CoinGeckoStore {
  cache: CoinCache;
}

// Create observable state
export const coinGeckoStore = reactive<CoinGeckoStore>({
  cache: {}
});

const STORE_NAME = 'coinGeckoStore';
const context = getContextType();

// Initialize messaging based on context
// IMPORTANT: Only browser context subscribes to background updates
// Background context directly updates local store via broadcastFromBackground()
if (context === 'browser') {
  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<CoinGeckoStore>) => {

    // Apply updates to the observable state
    Object.keys(updates).forEach(key => {
      if (key in coinGeckoStore) {
        (coinGeckoStore as unknown as Record<string, unknown>)[key] = updates[key as keyof CoinGeckoStore];
      }
    });
  });

  // Initial hydration from chrome.storage (fallback for initial state)
  chrome.storage.local.get(STORE_NAME, (result) => {
    if (result[STORE_NAME]) {
      Object.assign(coinGeckoStore, result[STORE_NAME]);
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
      const current = (result[STORE_NAME] as Partial<CoinGeckoStore> | undefined) || { cache: {} };
      chrome.storage.local.set(plainStoreSnapshot({
        [STORE_NAME]: { ...current, ...serializedUpdates }
      }));
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

  setCache(cache: CoinGeckoStore['cache']) {
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
    const entry = coinGeckoStore.cache[coinId];
    return typeof entry === 'object' ? entry.usd : undefined;
  },

  // Utility method to check if the cache is stale (older than 5 minutes)
  isCacheStale(maxAge: number = 5 * 60 * 1000): boolean {
    const cacheTimestamp = coinGeckoStore.cache['_timestamp'];
    if (typeof cacheTimestamp !== 'number' || !cacheTimestamp) return true;
    return Date.now() - cacheTimestamp > maxAge;
  }
};
