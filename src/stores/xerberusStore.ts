import Vue from 'vue';
import xerberusApi from '@/api/xerberus.api';
import { createStorageSync, smartPersist, hydrateStore, getContextType } from '@/utils/storageSync';

export interface XerberusStore {
  risks: object;
}

export const xerberusStore = Vue.observable<XerberusStore>({
  risks: {},
});

// Initialize store with centralized storage sync
const SYNC_KEYS = ['risks'];

// Hydrate from storage on initialization
hydrateStore('xerberusStore', xerberusStore);

// Set up centralized storage sync
const unsubscribe = createStorageSync(xerberusStore, {
  storeName: 'xerberusStore',
  syncKeys: SYNC_KEYS,
  debugPrefix: '🔄 XerberusStore'
});

// Clean up on unload (for contexts that support it)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', unsubscribe);
}

async function persist(patch: Partial<XerberusStore>): Promise<void> {
  const context = getContextType();
  
  // Only persist from background context to prevent cross-context conflicts
  if (context !== 'background') {
    console.debug(`🔍 XerberusStore persist skipped from ${context} context for:`, Object.keys(patch));
    return;
  }

  const next = { ...xerberusStore, ...patch };
  await smartPersist('xerberusStore', next);
}

async function persistTokenPatch(fingerprint: string, patch: { risk: string; }): Promise<void> {
  const context = getContextType();
  
  // Only persist from background context to prevent cross-context conflicts
  if (context !== 'background') {
    console.debug(`🔍 XerberusStore persistTokenPatch skipped from ${context} context for:`, fingerprint);
    return;
  }

  const result = await chrome.storage.local.get('xerberusStore');
  const saved: XerberusStore = result['xerberusStore'] || { risks: {} };
  const risksCopy = { ...saved.risks };

  risksCopy[fingerprint] = {
    ...(risksCopy[fingerprint] || {}),
    risk: patch.risk
  };

  await chrome.storage.local.set({
    xerberusStore: {
      ...saved,
      risks: risksCopy,
    },
  });
}


export default {
  setRisks(risks: any) {
    xerberusStore.risks = risks;
    persist({ risks: risks });
  },
  async updateRisks(fingerprints: string[]) {
    const promises = fingerprints
      .filter(Boolean)
      .map(fingerprint =>
        xerberusApi.assetRisk(fingerprint)
          .catch(() => {
            console.warn('Failed to fetch risk for:', fingerprint);
            return null;
          })
      );

    const results = await Promise.all(promises);
    const risks = {};

    for (const item of results) {
      if (item && item.status === 200) {
        const risk = item.data.data.risk_category;
        const fingerprint = item.data.data.fingerprint;
        risks[fingerprint] = { risk };
        await persistTokenPatch(fingerprint, { risk });
      }
    }
  },
  state: xerberusStore
};
