import Vue from 'vue';
import cashbackApi from '@/api/cashback-api';

export interface BringStore {
  bringCache: any;
}

export const bringStore = Vue.observable<BringStore>({
  bringCache: undefined,
});

chrome.storage.local.get('bringStore', (res) => {
  const stored = res['bringStore']
  if (stored) {
    Object.assign(bringStore, stored);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['bringStore']) {
    Object.assign(bringStore, changes['bringStore'].newValue);
  }
});

function persist(patch: Partial<BringStore>) {
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
  )
  chrome.storage.local.set({ bringStore: JSON.parse(nextString) });
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
