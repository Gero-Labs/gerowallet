import { defineStore } from 'pinia';
import { appWallet } from '@/store';

export const bringStore = defineStore( 'bringStore', {
  persist: {
    paths: ['bringCache']
  },
  state: () => ({
    bringCache: undefined,
  }),
  actions: {
    async loadBringCache() {
      if (!appWallet) {
        return
      }
      this.setBringCache(await appWallet.api.cache(appWallet.baseAddress().to_address().to_bech32()))
    },
    setBringCache(val) {
      this.bringCache = val
    }
  }
});
