import Vue from 'vue';
import { parseHttpError } from '@/shared/utils/parser';
import dexHunterApi from '@/api/dexhunter-api';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';
import { debugLog } from '@/utils/debug';

export interface TokenMetadataStore {
  tokens: {};
  blacklistPolicies: string[];
  registeredAddresses: string[];
}

// Create an observable state
export const tokenMetadataStore = Vue.observable<TokenMetadataStore>({
  tokens: {},
  blacklistPolicies: [],
  registeredAddresses: [],
});

const STORE_NAME = 'tokenMetadataStore';
const context = getContextType();

// Initialize messaging based on context
// IMPORTANT: Only browser context subscribes to background updates
// Background context directly updates local store via broadcastFromBackground()
if (context === 'browser') {
  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<TokenMetadataStore>) => {

    // Apply updates to the observable state
    Object.keys(updates).forEach(key => {
      if (key in tokenMetadataStore) {
        (tokenMetadataStore as unknown as Record<string, unknown>)[key] = updates[key as keyof TokenMetadataStore];
      }
    });
  });

  // Initial hydration from chrome.storage (fallback for initial state)
  chrome.storage.local.get(STORE_NAME, (result) => {
    if (result[STORE_NAME]) {
      Object.assign(tokenMetadataStore, result[STORE_NAME]);
    }
  });
}

/**
 * Broadcast updates from the background context
 */
function broadcastFromBackground(updates: Partial<TokenMetadataStore>) {
  if (context === 'background') {
    // Broadcast to all connected browser contexts
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, updates);

    // Also persist to storage as fallback
    chrome.storage.local.get(STORE_NAME, (result) => {
      const current = result[STORE_NAME] || { tokens: {}, blacklistPolicies: [], registeredAddresses: [] };
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
    const saved: TokenMetadataStore = result[STORE_NAME] || { tokens: {}, blacklistPolicies: [], registeredAddresses: [] };

    // Create updated tokens object
    const updatedTokens = {
      ...saved.tokens,
      [unit]: {
        ...saved.tokens[unit],
        price: patch.price,
        mcap: patch.mcap,
      }
    };

    // Update local state
    tokenMetadataStore.tokens = updatedTokens;

    // Broadcast the update
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, {
      tokens: updatedTokens
    });

    // Persist to storage
    await chrome.storage.local.set({
      [STORE_NAME]: {
        ...saved,
        tokens: updatedTokens,
      },
    });
  }
}

export default {
  setTokens(tokens: Record<string, unknown>) {
    tokenMetadataStore.tokens = tokens;

    // Broadcast from a background context
    broadcastFromBackground({ tokens });
  },

  setBlacklistPolicies(blacklistPolicies: string[]) {
    tokenMetadataStore.blacklistPolicies = blacklistPolicies;

    // Broadcast from a background context
    broadcastFromBackground({ blacklistPolicies });
  },

  async loadTokens() {
    try {
      const res = await dexHunterApi.getSwapTokens();
      if (res.status === 200) {
        this.setTokens(res.data.reduce(function(map, token) {
          // Images/metadata for display come from market data (useMarketData), keyed by unit.
          // DexHunter tokens only define what is swappable + provide pricing/routing.
          map[token.token_id] = {
            name: token.token_ascii,
            ticker: token.ticker,
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
      // Images/metadata for display come from market data (useMarketData), keyed by unit.
      return res.data.map(token => {
        return this.state.tokens[token.token_id] = {
          name: token.token_ascii,
          ticker: token.ticker,
          decimals: Number(token.token_decimals),
          unit: token.token_id,
          verified: token.is_verified,
          balance: 0,
          quantity: '0',
          price: token.price,
        }
      })
    } else {
      return []
    }
  },

  // Expose the observable state
  state: tokenMetadataStore,

  // Utility method to get the current state snapshot
  getSnapshot(): TokenMetadataStore {
    return { ...tokenMetadataStore };
  },

  // Utility method to reset state
  reset() {
    const resetState: TokenMetadataStore = {
      tokens: {},
      blacklistPolicies: [],
      registeredAddresses: [],
    };

    Object.assign(tokenMetadataStore, resetState);
    broadcastFromBackground(resetState);
  },

  /**
   * Check if an address is already registered with DexHunter
   */
  isAddressRegistered(address: string): boolean {
    return tokenMetadataStore.registeredAddresses.includes(address);
  },

  /**
   * Register address with DexHunter backend (for wallet balance tracking)
   * This should be called before performing swaps to enable DexHunter to track wallet state
   * Called from browser context, so we update store directly
   */
  async registerAddress(address: string): Promise<void> {
    // Check if already registered
    if (this.isAddressRegistered(address)) {
      return;
    }

    try {
      debugLog(`📝 Registering address with DexHunter: ${address}`);
      const res = await dexHunterApi.walletBalance([address]);

      if (res.status === 200) {
        // Update store directly (browser context)
        tokenMetadataStore.registeredAddresses = [...tokenMetadataStore.registeredAddresses, address];

        // Persist to storage
        const result = await chrome.storage.local.get(STORE_NAME);
        const current = result[STORE_NAME] || { tokens: {}, blacklistPolicies: [], registeredAddresses: [] };
        await chrome.storage.local.set({
          [STORE_NAME]: { ...current, registeredAddresses: tokenMetadataStore.registeredAddresses }
        });

        debugLog(`✅ Address registered successfully with DexHunter: ${address}`);
      } else {
        console.warn(`Failed to register address with DexHunter: ${parseHttpError(res)}`);
      }
    } catch (e) {
      console.error(`Error registering address with DexHunter:`, e);
    }
  }
};
