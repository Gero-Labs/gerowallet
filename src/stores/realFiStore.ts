import Vue from 'vue';
import realfiApi from '@/api/realfi-api';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';
import { debugLog } from '@/utils/debug';

export interface RealFiStore {
  tokens: {};
}

// Create observable state
export const realFiStore = Vue.observable<RealFiStore>({
  tokens: {},
});

const STORE_NAME = 'realFiStore';
const context = getContextType();

// Initialize messaging based on context
// IMPORTANT: Only browser context subscribes to background updates
// Background context directly updates local store via broadcastFromBackground()
if (context === 'browser') {
  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<RealFiStore>) => {

    // Apply updates to the observable state
    Object.keys(updates).forEach(key => {
      if (key in realFiStore) {
        (realFiStore as any)[key] = updates[key as keyof RealFiStore];
      }
    });
  });

  // Initial hydration from chrome.storage (fallback for initial state)
  chrome.storage.local.get(STORE_NAME, (result) => {
    if (result[STORE_NAME]) {
      Object.assign(realFiStore, result[STORE_NAME]);
    }
  });
}

/**
 * Broadcast updates from background context
 */
function broadcastFromBackground(updates: Partial<RealFiStore>) {
  if (context === 'background') {
    // Broadcast to all connected browser contexts
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, updates);

    // Also persist to storage as fallback
    chrome.storage.local.get(STORE_NAME, (result) => {
      const current = result[STORE_NAME] || { tokens: {} };
      chrome.storage.local.set({
        [STORE_NAME]: { ...current, ...updates }
      });
    });
  }
}

/**
 * Special handler for token patches (partial updates to nested token data)
 */
async function broadcastTokenPatch(unit: string, patch: { data: any[] }) {
  if (context === 'background') {
    // Get current state
    const result = await chrome.storage.local.get(STORE_NAME);
    const saved: RealFiStore = result[STORE_NAME] || { tokens: {} };

    // Create updated tokens object
    const updatedTokens = {
      ...saved.tokens,
      [unit]: patch.data
    };

    // Update local state
    realFiStore.tokens = updatedTokens;

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
  setTokens(tokens: any) {
    realFiStore.tokens = tokens;

    // Broadcast from background context
    broadcastFromBackground({ tokens });
  },

  async updateTokenHistory(tokensUnits: string[]) {
    for (const unit of tokensUnits) {
      try {
        if (unit !== 'lovelace') {
          const res = await realfiApi.historicalCandles(unit);
          if (res.status === 200) {
            const data = res.data;
            await broadcastTokenPatch(unit, { data });
          }
        }
      } catch (e) {
        // RealFi API failures are expected for some tokens - silently skip
        debugLog(`⚠️ RealFi: Historical data unavailable for ${unit}`);
      }
    }
  },

  // Expose the observable state
  state: realFiStore,

  // Utility method to get current state snapshot
  getSnapshot(): RealFiStore {
    return { ...realFiStore };
  },

  // Utility method to reset state
  reset() {
    const resetState: RealFiStore = {
      tokens: {}
    };

    Object.assign(realFiStore, resetState);
    broadcastFromBackground(resetState);
  },

  // Utility method to get token history
  getTokenHistory(unit: string): any[] | undefined {
    return realFiStore.tokens[unit];
  },

  // Utility method to check if token history exists
  hasTokenHistory(unit: string): boolean {
    return unit in realFiStore.tokens && Array.isArray(realFiStore.tokens[unit]);
  },

  // Utility method to get all tokens with history
  getTokensWithHistory(): string[] {
    return Object.keys(realFiStore.tokens).filter(unit =>
      Array.isArray(realFiStore.tokens[unit]) && realFiStore.tokens[unit].length > 0
    );
  },

  // Utility method to clear token history for a specific token
  clearTokenHistory(unit: string) {
    if (unit in realFiStore.tokens) {
      const updatedTokens = { ...realFiStore.tokens };
      delete updatedTokens[unit];
      realFiStore.tokens = updatedTokens;
      broadcastFromBackground({ tokens: updatedTokens });
    }
  }
};
