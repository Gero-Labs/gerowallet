import { defineStore } from 'pinia';
import dexHunterApi from '@/api/dexhunter-api';
import filters from '@/shared/utils/filters';

export const dexHunterStore = defineStore( 'dexHunterStore', {
  persist: {
    paths: ['dexHunterTokens', 'blacklistPolicies']
  },
  state: () => ({
    dexHunterTokens: undefined,
    blacklistPolicies: [],
  }),
  actions: {
    async loadTokens(force: boolean = false) {
      if (this.dexHunterTokens && !force) {
        return
      }
      try {
        const res = await dexHunterApi.getSwapTokens();
        this.setTokens(res.data.reduce(function(map, token) {
          map[token.token_id] = {
            name: token.token_ascii,
            ticker: token.ticker,
            img: `https://storage.googleapis.com/dexhunter-images/tokens/${token.token_id}.webp`,
            fallback_img: 'https://storage.googleapis.com/dexhunter-images/public/unverified.svg',
            decimals: Number(token.token_decimals),
            unit: token.token_id,
            verified: token.is_verified,
            balance: 0,
            quantity: '0',
            price: token.price,
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
    async searchTokens(query?: string) {
      const res = await dexHunterApi.getSwapTokens(query);
      if (res) {
        return await Promise.all(res.data.map(async token => {
          let assetData;
          try {
            assetData = await dexHunterApi.getAssetData(token.token_id.slice(0, 56) + '.' + token.token_id.slice(56));
          } catch (e) {
            console.log(e)
          }
          let fallbackImg = 'https://storage.googleapis.com/dexhunter-images/public/unverified.svg';
          if (assetData?.logoCID) {
            fallbackImg = filters.toIPFS(assetData.logoCID);
          }

          return this.dexHunterTokens[token.token_id] = {
            name: token.token_ascii,
            ticker: token.ticker,
            img: `https://storage.googleapis.com/dexhunter-images/tokens/${token.token_id}.webp`,
            fallback_img: fallbackImg,
            decimals: Number(token.token_decimals),
            unit: token.token_id,
            verified: token.is_verified,
            balance: 0,
            quantity: '0',
            price: token.price,
          }
        }))
      } else {
        return []
      }
    },
  }
});
