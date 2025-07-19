import Vue from 'vue';

export interface GeroStore {
  wallets: any;
  config: any;
}

export const geroStore: GeroStore =  Vue.observable<GeroStore>({
  wallets: {},
  config: {
    welcomeDone: true
  },
});

chrome.storage.local.get('geroStore', (res) => {
  const stored = res['geroStore']
  if (stored) {
    Object.assign(geroStore, stored);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['geroStore']) {
    Object.assign(geroStore, changes['geroStore'].newValue);
  }
});

function persist(patch: Partial<GeroStore>) {
  const next = { ...geroStore, ...patch };
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
  chrome.storage.local.set({ geroStore: JSON.parse(nextString) });
}

export default {
  setWallets(wallets: any) {
    geroStore.wallets = wallets;
    persist({ wallets: wallets });
  },
  setConfig(config: any) {
    geroStore.config = config;
    persist({ config: config });
  },
  state: geroStore
}
