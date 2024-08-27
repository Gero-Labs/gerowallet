import { defineStore } from 'pinia';
import { appWallet } from '@/store';

export const dexHunterStore = defineStore( 'dexHunterStore', {
  persist: {
    paths: ['tokens']
  },
  state: () => ({
    tokens: undefined,
  }),
  actions: {
    async loadTokens() {
      if (!appWallet || this.tokens) {
        return
      }
      const res = await appWallet.api.getAllTokens();
      console.log(res)
      this.setTokens(res.reduce(function(map, token) {
        map[token.token_id] = {
          name: token.token_ascii,
          ticker: token.ticker,
          img: `https://storage.googleapis.com/dexhunter-images/tokens/${token.token_id}.webp`,
          decimals: Number(token.token_decimals),
          unit: token.token_id,
          verified: token.is_verified,
        }
        return map;
      }, {}));
    },
    setTokens(val) {
      this.tokens = val
    }
  }
});
