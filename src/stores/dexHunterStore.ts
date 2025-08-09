import Vue from 'vue';
import { parseHttpError } from '@/shared/utils/parser';
import dexHunterApi from '@/api/dexhunter-api';
import filters from '@/shared/utils/filters';
import { createStorageSync, smartPersist, hydrateStore, getContextType } from '@/utils/storageSync';

export interface DexHunterStore {
  dexHunterTokens: {};
  blacklistPolicies: string[];
}

export const dexHunterStore = Vue.observable<DexHunterStore>({
  dexHunterTokens: {},
  blacklistPolicies: [],
});

// Initialize store with centralized storage sync
const SYNC_KEYS = ['dexHunterTokens', 'blacklistPolicies'];

// Hydrate from storage on initialization
hydrateStore('dexHunterStore', dexHunterStore);

// Set up centralized storage sync
const unsubscribe = createStorageSync(dexHunterStore, {
  storeName: 'dexHunterStore',
  syncKeys: SYNC_KEYS,
  debugPrefix: '🔄 DexHunterStore'
});

// Clean up on unload (for contexts that support it)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', unsubscribe);
}

async function persist(patch: Partial<DexHunterStore>): Promise<void> {
  const context = getContextType();
  
  // Only persist from background context to prevent cross-context conflicts
  if (context !== 'background') {
    console.debug(`🔍 DexHunterStore persist skipped from ${context} context for:`, Object.keys(patch));
    return;
  }

  const next = { ...dexHunterStore, ...patch };
  await smartPersist('dexHunterStore', next);
}

async function persistTokenPatch(unit: string, patch: { price: number; mcap: number }): Promise<void> {
  const context = getContextType();
  
  // Only persist from background context to prevent cross-context conflicts
  if (context !== 'background') {
    console.debug(`🔍 DexHunterStore persistTokenPatch skipped from ${context} context for:`, unit);
    return;
  }

  const result = await chrome.storage.local.get('dexHunterStore');
  const saved: DexHunterStore = result['dexHunterStore'] || { dexHunterTokens: {}, blacklistPolicies: [] };
  const tokensCopy = { ...saved.dexHunterTokens };

  tokensCopy[unit] = {
    ...tokensCopy[unit],
    price: patch.price,
    mcap: patch.mcap,
  };

  await chrome.storage.local.set({
    dexHunterStore: {
      ...saved,
      dexHunterTokens: tokensCopy,
    },
  });
}

export default {
  setTokens(dexHunterTokens: any) {
    dexHunterStore.dexHunterTokens = dexHunterTokens;
    persist({ dexHunterTokens: dexHunterTokens });
  },
  setBlacklistPolicies(blacklistPolicies: string[]) {
    dexHunterStore.blacklistPolicies = blacklistPolicies;
    persist({ blacklistPolicies: blacklistPolicies });
  },
  async loadTokens() {
    try {
      const res = await dexHunterApi.getSwapTokens();
      if (res.status === 200) {
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
      } else {
        console.log(res.status)
        console.warn(parseHttpError(res))
      }
    } catch (error) {
      console.error(error);
    }
  },
  async updatePrices(tokensUnits: string[]) {
    for (const unit of tokensUnits) {
      try {
        if (unit !== 'lovelace') {
          const res = await dexHunterApi.mCap(unit);
          if (res.status === 200) {
            const { price, mcap } = res.data;
            await persistTokenPatch(unit, { price, mcap });
          }
        }
      } catch (e) {
        console.warn(`failed to fetch ${unit}`, e);
      }
    }
  },
  async loadBlacklistPolicies() {
    try {
      const res = await dexHunterApi.getAllBlacklistPolicies()
      if (res.status === 200) {
        this.setBlacklistPolicies(res.data)
      } else {
        console.warn(parseHttpError(res))
      }
    } catch (e) {
      console.error(e)
    }
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

        return this.state.dexHunterTokens[token.token_id] = {
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
  state: dexHunterStore
};
