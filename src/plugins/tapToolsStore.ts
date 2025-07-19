import Vue from 'vue';
import { parseHttpError } from '@/shared/utils/parser';
import tapToolsApi from '@/api/tap-tools-api';

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

chrome.storage.local.get('tapToolsStore', (res) => {
  if (res['tapToolsStore']) {
    Object.assign(tapToolsStore, res['tapToolsStore']);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['tapToolsStore']) {
    Object.assign(tapToolsStore, changes['tapToolsStore'].newValue);
  }
});

function persist(patch: Partial<TapToolsStore>) {
  const next = { ...tapToolsStore, ...patch };
  chrome.storage.local.set({ tapToolsStore: next });
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
