import Vue from 'vue';
import cashbackApi from '@/api/cashback-api';
import { createStorageSync, smartPersist, hydrateStore } from '@/utils/storageSync';

export interface BringStore {
  bringCache: any;
}

export const bringStore = Vue.observable<BringStore>({
  bringCache: undefined,
});

// Initialize store with centralized storage sync
const SYNC_KEYS = ['bringCache'];

// Hydrate from storage on initialization
hydrateStore('bringStore', bringStore);

// Set up centralized storage sync
const unsubscribe = createStorageSync(bringStore, {
  storeName: 'bringStore',
  syncKeys: SYNC_KEYS,
  debugPrefix: '🔄 BringStore'
});

// Clean up on unload (for contexts that support it)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', unsubscribe);
}

async function persist(patch: Partial<BringStore>): Promise<void> {
  const next = { ...bringStore, ...patch };
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
  await smartPersist('bringStore', JSON.parse(nextString));
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
    persist({ bringCache: bringCache });
  },
  state: bringStore
};
