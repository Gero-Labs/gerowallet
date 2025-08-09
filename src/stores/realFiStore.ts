import Vue from 'vue';
import realfiApi from '@/api/realfi-api';
import { createStorageSync, smartPersist, hydrateStore, getContextType } from '@/utils/storageSync';

export interface RealFiStore {
  tokens: {};
}

export const realFiStore = Vue.observable<RealFiStore>({
  tokens: {},
});

// Initialize store with centralized storage sync
const SYNC_KEYS = ['tokens'];

// Hydrate from storage on initialization
hydrateStore('realFiStore', realFiStore);

// Set up centralized storage sync
const unsubscribe = createStorageSync(realFiStore, {
  storeName: 'realFiStore',
  syncKeys: SYNC_KEYS,
  debugPrefix: '🔄 RealFiStore'
});

// Clean up on unload (for contexts that support it)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', unsubscribe);
}

async function persist(patch: Partial<RealFiStore>): Promise<void> {
  const context = getContextType();
  
  // Only persist from background context to prevent cross-context conflicts
  if (context !== 'background') {
    console.debug(`🔍 RealFiStore persist skipped from ${context} context for:`, Object.keys(patch));
    return;
  }

  const next = { ...realFiStore, ...patch };
  await smartPersist('realFiStore', next);
}

async function persistTokenPatch(unit: string, patch: { data: any[]; }): Promise<void> {
  const context = getContextType();
  
  // Only persist from background context to prevent cross-context conflicts
  if (context !== 'background') {
    console.debug(`🔍 RealFiStore persistTokenPatch skipped from ${context} context for:`, unit);
    return;
  }

  const result = await chrome.storage.local.get('realFiStore');
  const saved: RealFiStore = result['realFiStore'] || { tokens: {} };
  const tokensCopy = { ...saved.tokens };

  tokensCopy[unit] = patch.data;

  await chrome.storage.local.set({
    realFiStore: {
      ...saved,
      tokens: tokensCopy,
    },
  });
}

export default {
  setTokens(tokens: any) {
    realFiStore.tokens = tokens;
    persist({ tokens: tokens });
  },
  async updateTokenHistory(tokensUnits: string[]) {
    for (const unit of tokensUnits) {
      try {
        if (unit !== 'lovelace') {
          const res = await realfiApi.historicalCandles(unit);
          if (res.status === 200) {
            const data = res.data;
            await persistTokenPatch(unit, { data });
          }
        }
      } catch (e) {
        console.warn(`failed to fetch ${unit}`, e);
      }
    }
  },
  state: realFiStore
};
