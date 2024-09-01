import { defineStore } from 'pinia';
import { appWallet } from '@/store';

export const dexHunterStore = defineStore( 'dexHunterStore', {
  persist: {
    paths: ['dexHunterTokens']
  },
  state: () => ({
    dexHunterTokens: undefined,
  }),
  actions: {
    async loadTokens() {
      if (!appWallet || this.dexHunterTokens) {
        return
      }

      const res = await appWallet.api.getAllTokens();
      this.setTokens(res.reduce(function(map, token) {
        map[token.token_id] = {
          name: token.token_ascii,
          ticker: token.ticker,
          img: `https://storage.googleapis.com/dexhunter-images/tokens/${token.token_id}.webp`,
          fallback_img: 'https://storage.googleapis.com/dexhunter-images/public/unverified.svg',
          decimals: Number(token.token_decimals),
          unit: token.token_id,
          verified: token.is_verified,
          balance: 0,
          quantity: '0'
        }
        return map;
      }, {}));
    },
    setTokens(val) {
      this.dexHunterTokens = val
    }
  }
});
