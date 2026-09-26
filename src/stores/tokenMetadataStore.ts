import Vue from 'vue';
import { parseHttpError } from '@/shared/utils/parser';
import swapApi from '@/api/swap-api';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';
import { StorePersister } from '@/utils/storePersistence';

export interface TokenMetadataStore {
  tokens: {};
  blacklistPolicies: string[];
}

// Create an observable state
export const tokenMetadataStore = Vue.observable<TokenMetadataStore>({
  tokens: {},
  blacklistPolicies: [],
});

const STORE_NAME = 'tokenMetadataStore';
const context = getContextType();
const persister = new StorePersister(tokenMetadataStore as unknown as Record<string, unknown>, {
  storeName: STORE_NAME,
  // Registry data can grow large. Only the blacklist stays in Chrome's compact
  // record; token writes must not fan out through storage.onChanged in every tab.
  bulkFields: ['tokens'],
});
let hydration: Promise<void> | null = null;
const deliveredFields = new Set<string>();

// Initialize messaging based on context
// IMPORTANT: Only browser context subscribes to background updates
// Background context directly updates local store via broadcastFromBackground()
if (context === 'browser') {
  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<TokenMetadataStore>) => {

    // Apply updates to the observable state
    Object.keys(updates).forEach(key => {
      if (key in tokenMetadataStore) {
        deliveredFields.add(key);
        (tokenMetadataStore as unknown as Record<string, unknown>)[key] = updates[key as keyof TokenMetadataStore];
      }
    });
  });

  hydration = persister.hydrate({ skip: deliveredFields }).then(() => undefined);
}

if (context === 'background') {
  // Preserve the untouched field on worker restart and migrate old inline token
  // maps only after IndexedDB has accepted them. Setters win over a late read.
  hydration = persister.hydrate({ migrate: true }).then(() => undefined);
}

export const hydrateTokenMetadataStore = (): Promise<void> => hydration ?? Promise.resolve();
export const flushTokenMetadataPersistence = (): Promise<void> => persister.flush();

/**
 * Broadcast updates from the background context
 */
function broadcastFromBackground(updates: Partial<TokenMetadataStore>) {
  // Browser-side registry refreshes are newer than an in-flight disk hydrate,
  // just like port messages. They still must never persist from this context.
  if (context === 'browser') Object.keys(updates).forEach((key) => deliveredFields.add(key));
  if (context === 'background') {
    // Broadcast to all connected browser contexts
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, updates);

    persister.markDirty(Object.keys(updates));
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
      const res = await swapApi.getSwapTokens();
      if (res.status === 200) {
        this.setTokens(res.data.reduce(function(map, token) {
          // Images/metadata for display come from market data (useMarketData), keyed by unit.
          // Registry tokens only define what is swappable + provide pricing/routing.
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
        console.warn(parseHttpError(res))
      }
    } catch (error) {
      console.error(error);
    }
  },

  async loadBlacklistPolicies() {
    try {
      const res = await swapApi.getAllBlacklistPolicies()
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
    const res = await swapApi.getSwapTokens(query);
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
    };

    Object.assign(tokenMetadataStore, resetState);
    broadcastFromBackground(resetState);
  },
};
