import Vue from 'vue';
import coinGeckoApi from '@/api/coinGecko.api';
import { createStorageSync, smartPersist, hydrateStore } from '@/utils/storageSync';

export interface CoinGeckoStore {
  cache: Record<string, any>;
}

export const coinGeckoStore: CoinGeckoStore = Vue.observable<CoinGeckoStore>({
  cache: {}
});

// Initialize store with centralized storage sync
const SYNC_KEYS = ['cache'];

// Hydrate from storage on initialization
hydrateStore('coinGeckoStore', coinGeckoStore);

// Set up centralized storage sync
const unsubscribe = createStorageSync(coinGeckoStore, {
  storeName: 'coinGeckoStore',
  syncKeys: SYNC_KEYS,
  debugPrefix: '🔄 CoinGeckoStore'
});

// Clean up on unload (for contexts that support it)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', unsubscribe);
}

async function persist(patch: Partial<CoinGeckoStore>): Promise<void> {
  const next = { ...coinGeckoStore, ...patch };
  const nextString: string = JSON.stringify(next, (key, value) => {
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
    }
  );
  await smartPersist('coinGeckoStore', JSON.parse(nextString));
}

export default {
  async updatePrices() {
    try {
      const res = await coinGeckoApi.getSimplePrice();
      this.setCache(res.data);
    } catch (e) {
      console.warn(e);
    }
  },
  setCache(cache: Record<string, any>) {
    coinGeckoStore.cache = cache;
    persist({ cache: cache });
  },
  state: coinGeckoStore
}
