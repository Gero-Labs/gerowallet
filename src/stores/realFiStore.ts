import Vue from 'vue';
import realfiApi from '@/api/realfi-api';

export interface RealFiStore {
  tokens: {};
}

export const realFiStore = Vue.observable<RealFiStore>({
  tokens: {},
});

chrome.storage.local.get('realFiStore', (res) => {
  if (res['realFiStore']) {
    Object.assign(realFiStore, res['realFiStore']);
  }
});

// Removed chrome.storage.onChanged listener to prevent data overwrite issues

function persist(patch: Partial<RealFiStore>) {
  const next = { ...realFiStore, ...patch };
  chrome.storage.local.set({ realFiStore: next });
}

async function persistTokenPatch(unit: string, patch: { data: any[]; }): Promise<void> {
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
