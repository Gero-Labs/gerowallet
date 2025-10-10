import Vue from 'vue';
import xerberusApi from '@/api/xerberus.api';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';
import { debugLog } from '@/utils/debug';

export interface XerberusStore {
  risks: object;
}

// Create observable state
export const xerberusStore = Vue.observable<XerberusStore>({
  risks: {},
});

const STORE_NAME = 'xerberusStore';
const context = getContextType();

// Initialize messaging based on context
// IMPORTANT: Only browser context subscribes to background updates
// Background context directly updates local store via broadcastFromBackground()
if (context === 'browser') {
  debugLog(`🔌 Initializing xerberus store messaging in browser context`);
  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<XerberusStore>) => {
    debugLog('📥 Received xerberus store update:', updates);
    
    // Apply updates to the observable state
    Object.keys(updates).forEach(key => {
      if (key in xerberusStore) {
        (xerberusStore as any)[key] = updates[key as keyof XerberusStore];
      }
    });
  });

  // Initial hydration from chrome.storage (fallback for initial state)
  chrome.storage.local.get(STORE_NAME, (result) => {
    if (result[STORE_NAME]) {
      Object.assign(xerberusStore, result[STORE_NAME]);
      debugLog('💾 Hydrated xerberus store from storage:', result[STORE_NAME]);
    }
  });
}

/**
 * Broadcast updates from background context
 */
function broadcastFromBackground(updates: Partial<XerberusStore>) {
  if (context === 'background') {
    // Broadcast to all connected browser contexts
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, updates);
    
    // Also persist to storage as fallback
    chrome.storage.local.get(STORE_NAME, (result) => {
      const current = result[STORE_NAME] || { risks: {} };
      chrome.storage.local.set({ 
        [STORE_NAME]: { ...current, ...updates } 
      });
    });
  }
}

/**
 * Special handler for risk patches (partial updates to nested risk objects)
 */
async function broadcastRiskPatch(fingerprint: string, patch: { risk: string }) {
  if (context === 'background') {
    // Get current state
    const result = await chrome.storage.local.get(STORE_NAME);
    const saved: XerberusStore = result[STORE_NAME] || { risks: {} };
    
    // Create updated risks object
    const updatedRisks = {
      ...saved.risks,
      [fingerprint]: {
        ...saved.risks[fingerprint],
        risk: patch.risk
      }
    };
    
    // Update local state
    xerberusStore.risks = updatedRisks;
    
    // Broadcast the update
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, { 
      risks: updatedRisks 
    });
    
    // Persist to storage
    await chrome.storage.local.set({
      [STORE_NAME]: {
        ...saved,
        risks: updatedRisks,
      },
    });
  }
}

export default {
  setRisks(risks: any) {
    xerberusStore.risks = risks;
    
    // Broadcast from background context
    broadcastFromBackground({ risks });
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

    for (const item of results) {
      if (item && item.status === 200) {
        const risk = item.data.data.risk_category;
        const fingerprint = item.data.data.fingerprint;
        await broadcastRiskPatch(fingerprint, { risk });
      }
    }
  },
  
  // Expose the observable state
  state: xerberusStore,
  
  // Utility method to get current state snapshot
  getSnapshot(): XerberusStore {
    return { ...xerberusStore };
  },
  
  // Utility method to reset state
  reset() {
    const resetState: XerberusStore = {
      risks: {}
    };
    
    Object.assign(xerberusStore, resetState);
    broadcastFromBackground(resetState);
  },
  
  // Utility method to get risk for a specific token
  getRisk(fingerprint: string): string | undefined {
    return xerberusStore.risks[fingerprint]?.risk;
  },
  
  // Utility method to check if token has high risk
  isHighRisk(fingerprint: string): boolean {
    const risk = this.getRisk(fingerprint);
    return risk === 'HIGH' || risk === 'CRITICAL';
  },
  
  // Utility method to get all risky tokens
  getRiskyTokens(): { fingerprint: string; risk: string }[] {
    return Object.entries(xerberusStore.risks)
      .filter(([_, data]: [string, any]) => data.risk && data.risk !== 'LOW')
      .map(([fingerprint, data]: [string, any]) => ({
        fingerprint,
        risk: data.risk
      }));
  }
};
