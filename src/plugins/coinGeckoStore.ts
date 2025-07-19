import Vue from 'vue';
import coinGeckoApi from '@/api/coinGecko.api';

export interface CoinGeckoStore {
  cache: Record<string, any>;
}

export const coinGeckoStore: CoinGeckoStore = Vue.observable<CoinGeckoStore>({
  cache: {}
});

chrome.storage.local.get('coinGeckoStore', (res) => {
  const stored = res['coinGeckoStore']
  if (stored) {
    Object.assign(coinGeckoStore, stored);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['coinGeckoStore']) {
    Object.assign(coinGeckoStore, changes['coinGeckoStore'].newValue);
  }
});

function persist(patch: Partial<CoinGeckoStore>) {
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
  )
  chrome.storage.local.set({ coinGeckoStore: JSON.parse(nextString) });
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
