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
      try {
        const bringCache = await appWallet.api.cache(appWallet.baseAddress().to_address().to_bech32())
        this.setBringCache(bringCache)
      } catch (e) {
        // console.log(e)
      }
    },
    setBringCache(val) {
      this.bringCache = val
    }
  }
});
