import { defineStore } from 'pinia';
import loading from '@/plugins/loading';

// import { ChromeSyncStorage } from '@/store/chrome-storage'
// import { LocalPersistedStorage} from "@/store/local-storage";

import db from '@/db';
import { Wallet } from '@/models/wallet';
import { Provider } from '@/models/types';
import { Api } from '@/api/api';

// const env = process.env['VUE_APP_ENV']
// const plugin = env === 'production' ? LocalPersistedStorage:
// Vue.use(Vuex)

let appWallet = undefined;

export const useStore = defineStore('store', {
  persist: true,
  state: () => ({
    loggedWallet: undefined,
    wallets: [],
    locale: 'en',
    network: undefined,
    provider: undefined,
  }),
  getters: {
    isLoggedIn: state => !!state.loggedWallet,
    getLoggedWallet: state => state.loggedWallet,
    getWallets: state => state.wallets,
    getLocale: state => state.locale,
    getNetwork: state => state.network,
    getWallet: state => {
      if (!appWallet) {
        appWallet = Wallet.class(state.loggedWallet, state.provider);
      }
      return appWallet;
    },
  },
  actions: {
    async login(walletId) {
      loading.setLoading(true);
      console.log('login');
      const wallet = this.wallets.find(wal => wal.id === walletId);
      if (!wallet) {
        return null;
      }
      this.loggedWallet = wallet;
      this.provider = await db.getProvider(wallet.chain, wallet.network);
      appWallet = Wallet.class(wallet, this.provider);
      const tip = await appWallet.fetchTip();
      await appWallet.sync(tip);
      loading.setLoading(false);
    },
    logout() {
      loading.setLoading(true);
      this.loggedWallet = undefined;
      this.provider = undefined;
      loading.setLoading(false);
    },
    async loadWallets() {
      loading.setLoading(true);
      const wallets = await db.getAllWallets();
      if (Array.isArray(wallets) && wallets.length) {
        this.wallets = wallets;
      }
      loading.setLoading(false);
    },
    setLocale(locale) {
      this.locale = locale;
    },
    setNetwork(network) {
      this.network = network;
    },
  },
});

// export default {
//     namespaced: true,
//     save(key, value) {
//         if (env === 'production') {
//             // eslint-disable-next-line
//             chrome.storage.sync.set({ [key]: value });
//         } else {
//             localStorage.setItem(key, JSON.stringify(value))
//         }
//     },
//     async get(key) {
//         if (env === 'production') {
//             // eslint-disable-next-line
//             const res = await chrome.storage.sync.get([key])
//             if (Object.keys(res).length === 0) {
//                 return null
//             }
//             return res[key];
//         } else {
//             return JSON.parse(localStorage.getItem(key))
//         }
//     }
// }
