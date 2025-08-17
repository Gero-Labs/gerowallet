import Vue from 'vue';
import { parseHttpError } from '@/shared/utils/parser';
import dexHunterApi from '@/api/dexhunter-api';
import filters from '@/shared/utils/filters';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';

export interface DexHunterStore {
  dexHunterTokens: {};
  blacklistPolicies: string[];
}

// Create an observable state
export const dexHunterStore = Vue.observable<DexHunterStore>({
  dexHunterTokens: {},
  blacklistPolicies: [],
});

const STORE_NAME = 'dexHunterStore';
const context = getContextType();

// Initialize messaging based on context
if (context === 'browser') {
  console.debug(`🔌 Initializing dexHunter store messaging in browser context`);
  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<DexHunterStore>) => {
    console.debug('📥 Received dexHunter store update:', updates);

    // Apply updates to the observable state
    Object.keys(updates).forEach(key => {
      if (key in dexHunterStore) {
        (dexHunterStore as any)[key] = updates[key as keyof DexHunterStore];
      }
    });
  });

  // Initial hydration from chrome.storage (fallback for initial state)
  chrome.storage.local.get(STORE_NAME, (result) => {
    if (result[STORE_NAME]) {
      Object.assign(dexHunterStore, result[STORE_NAME]);
      console.debug('💾 Hydrated dexHunter store from storage:', result[STORE_NAME]);
    }
  });
}

/**
 * Broadcast updates from the background context
 */
function broadcastFromBackground(updates: Partial<DexHunterStore>) {
  if (context === 'background') {
    // Broadcast to all connected browser contexts
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, updates);

    // Also persist to storage as fallback
    chrome.storage.local.get(STORE_NAME, (result) => {
      const current = result[STORE_NAME] || { dexHunterTokens: {}, blacklistPolicies: [] };
      chrome.storage.local.set({
        [STORE_NAME]: { ...current, ...updates }
      });
    });
  }
}

/**
 * Special handler for token patches (partial updates to nested objects)
 */
async function broadcastTokenPatch(unit: string, patch: { price: number; mcap: number }) {
  if (context === 'background') {
    // Get current state
    const result = await chrome.storage.local.get(STORE_NAME);
    const saved: DexHunterStore = result[STORE_NAME] || { dexHunterTokens: {}, blacklistPolicies: [] };

    // Create updated tokens object
    const updatedTokens = {
      ...saved.dexHunterTokens,
      [unit]: {
        ...saved.dexHunterTokens[unit],
        price: patch.price,
        mcap: patch.mcap,
      }
    };

    // Update local state
    dexHunterStore.dexHunterTokens = updatedTokens;

    // Broadcast the update
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, {
      dexHunterTokens: updatedTokens
    });

    // Persist to storage
    await chrome.storage.local.set({
      [STORE_NAME]: {
        ...saved,
        dexHunterTokens: updatedTokens,
      },
    });
  }
}

export default {
  setTokens(dexHunterTokens: any) {
    dexHunterStore.dexHunterTokens = dexHunterTokens;

    // Broadcast from background context
    broadcastFromBackground({ dexHunterTokens });
  },

  setBlacklistPolicies(blacklistPolicies: string[]) {
    dexHunterStore.blacklistPolicies = blacklistPolicies;

    // Broadcast from background context
    broadcastFromBackground({ blacklistPolicies });
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
            await broadcastTokenPatch(unit, { price, mcap });
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

  // Expose the observable state
  state: dexHunterStore,

  // Utility method to get the current state snapshot
  getSnapshot(): DexHunterStore {
    return { ...dexHunterStore };
  },

  // Utility method to reset state
  reset() {
    const resetState: DexHunterStore = {
      dexHunterTokens: {},
      blacklistPolicies: [],
    };

    Object.assign(dexHunterStore, resetState);
    broadcastFromBackground(resetState);
  }
};
