import { defineStore } from 'pinia';
import { appWallet } from '@/store';
import Dexie from 'dexie';

const baseUrl = process.env['VUE_APP_BACKEND_URL'];

export const tapToolsStore = defineStore( 'tapToolsStore', {
  persist: {
    paths: ['portfolio']
  },
  state: () => ({
    portfolio: undefined,
  }),
  getters: {
    getNativeTokenStats(state) {
      if (state?.portfolio && 'nativeTokenStats' in state.portfolio) {
        return state.portfolio.nativeTokenStats
      }
      return undefined
    },
  },
  actions: {
    async setNativeTokenBalance(val) {
      if (appWallet) {
        const db: Dexie = await appWallet.getDb()
        db.table('config').put({key: 'nativeTokenStats', value: val})
      }
    },
    async loadPortfolio() {
      if (!appWallet) {
        return
      }
      try {
        const res = await appWallet.api.getAllTokens();
      } catch (e) {
        console.error(e);
      }
    }
  }
});
