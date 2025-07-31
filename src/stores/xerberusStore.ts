import Vue from 'vue';
import xerberusApi from '@/api/xerberus.api';

export interface XerberusStore {
  risks: object;
}

export const xerberusStore = Vue.observable<XerberusStore>({
  risks: {},
});

chrome.storage.local.get('xerberusStore', (res) => {
  if (res['xerberusStore']) {
    Object.assign(xerberusStore, res['xerberusStore']);
  }
});

// Removed chrome.storage.onChanged listener to prevent data overwrite issues

function persist(patch: Partial<XerberusStore>) {
  const next = { ...xerberusStore, ...patch };
  chrome.storage.local.set({ xerberusStore: next });
}

async function persistTokenPatch(fingerprint: string, patch: { risk: string; }): Promise<void> {
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
