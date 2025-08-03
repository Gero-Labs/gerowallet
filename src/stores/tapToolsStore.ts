import Vue from 'vue';
import { parseHttpError } from '@/shared/utils/parser';
import tapToolsApi from '@/api/tap-tools-api';
import { createStorageSync, smartPersist, hydrateStore } from '@/utils/storageSync';

export interface TapToolsStore {
  portfolio: any;
  portfolioTrendedValue: any;
  tokens: {};
}

export const tapToolsStore = Vue.observable<TapToolsStore>({
  portfolio: {},
  portfolioTrendedValue: {},
  tokens: {}
});

// Initialize store with centralized storage sync
const SYNC_KEYS = ['portfolio', 'portfolioTrendedValue', 'tokens'];

// Hydrate from storage on initialization
hydrateStore('tapToolsStore', tapToolsStore);

// Set up centralized storage sync
const unsubscribe = createStorageSync(tapToolsStore, {
  storeName: 'tapToolsStore',
  syncKeys: SYNC_KEYS,
  debugPrefix: '🔄 TapToolsStore'
});

// Clean up on unload (for contexts that support it)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', unsubscribe);
}

async function persist(patch: Partial<TapToolsStore>): Promise<void> {
  const next = { ...tapToolsStore, ...patch };
  await smartPersist('tapToolsStore', next);
}

// async function persistTokenPatch(unit: string, patch: { price: number; mcap: number }): Promise<void> {
//   const result = await chrome.storage.local.get('tapToolsStore');
//   const saved: TapToolsStore = result['tapToolsStore'] || { tokens: {} };
//   const tokensCopy = { ...saved.tokens };
//
//   tokensCopy[unit] = {
//     ...tokensCopy[unit],
//     price: patch.price,
//     mcap: patch.mcap,
//   };
//
//   await chrome.storage.local.set({
//     tapToolsStore: {
//       ...saved,
//       dexHunterTokens: tokensCopy,
//     },
//   });
// }

export default {
  setPortfolio(portfolio: any) {
    tapToolsStore.portfolio = portfolio;
    persist({ portfolio: portfolio });
  },
  setPortfolioTrendedValue(portfolioTrendedValue: any) {
    tapToolsStore.portfolioTrendedValue = portfolioTrendedValue;
    persist({ portfolioTrendedValue: portfolioTrendedValue });
  },
  setTokens(tokens: any) {
    tapToolsStore.tokens = tokens;
    persist({ tokens: tokens });
  },
  async loadPortfolio(stakeAddress: string) {
    try {
      const res = await tapToolsApi.getPortfolio(stakeAddress)
      if (res?.status == 200) {
        this.setPortfolio(res.data)
      } else {
        console.log(parseHttpError(res))
      }
    } catch (e) {
      console.error(e);
    }
  },
  async loadPortfolioTrendedValue(stakeAddress: string) {
    try {
      const res = await tapToolsApi.getPortfolioTrendedValue(stakeAddress);
      if (res?.status == 200) {
        this.setPortfolioTrendedValue(res.data.map((element: any) => [element.time * 1000, element.value]))
      } else {
        console.log(parseHttpError(res))
      }
    } catch (e) {
      console.error(e);
    }
  },
  // async updatePrices(tokensUnits: string[]) {
  //   for (const unit of tokensUnits) {
  //     try {
  //       const res = await dexhunterApi.mCap(unit);
  //       if (res.status === 200) {
  //         const { price, mcap } = res.data;
  //         await persistTokenPatch(unit, { price, mcap });
  //       }
  //     } catch (e) {
  //       console.warn(`failed to fetch ${unit}`, e);
  //     }
  //   }
  // },
  state: tapToolsStore
};
