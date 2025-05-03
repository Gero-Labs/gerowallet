import { defineStore } from 'pinia';
import { appWallet } from '@/stores';
import cashbackApi from '@/api/cashback-api';

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
        const bringCache = await cashbackApi.cache(appWallet.baseAddress().toBech32())
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
