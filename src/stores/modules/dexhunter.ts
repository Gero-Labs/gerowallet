import { defineStore } from 'pinia';
import { appWallet } from '@/stores';
import { Chain } from '@keystonehq/keystone-sdk/dist/chains/keystone';
import { Blockchain, Network } from '@/models/types';
import { parseHttpError } from '@/shared/utils/parser';

export const dexHunterStore = defineStore( 'dexHunterStore', {
  persist: {
    paths: ['dexHunterTokens', 'blacklistPolicies']
  },
  state: () => ({
    dexHunterTokens: undefined,
    blacklistPolicies: [],
  }),
  actions: {
    async loadTokens() {
      if (!appWallet || this.dexHunterTokens) {
        return
      }
      try {
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
      } catch (error) {
        console.error(error);
      }
    },
    setTokens(val) {
      this.dexHunterTokens = val
    },
    async loadBlacklistPolicies() {
      if (!appWallet || appWallet.chain != Blockchain.CARDANO || appWallet.network != Network.MAINNET) {
        return
      }
      try {
        const res = await appWallet.api.getAllBlacklistPolicies()
        if (res.status === 200) {
          this.setBlacklistPolicies(res.data)
        } else {
          console.log(parseHttpError(res))
        }
      } catch (e) {
        console.error(e)
      }
    },
    setBlacklistPolicies(blacklistPolicies) {
      this.blacklistPolicies = blacklistPolicies
    },
  }
});
