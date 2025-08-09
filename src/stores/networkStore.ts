import Vue from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { createStorageSync, smartPersist, hydrateStore, getContextType } from '@/utils/storageSync';

export interface NetworkStore {
  assets: any;
  dreps: any;
  pools: any;
  epochParams: Cardano.ProtocolParameters;
  tip: Cardano.Tip & {
    epoch: number;
    time: number;
    epoch_slot: number;
  };
  price: any;
  tickerStatisticsIntervalId: number;
  genesis: any;
}

export const networkStore = Vue.observable<NetworkStore>({
  assets: {},
  dreps: {},
  pools: {},
  epochParams: null,
  tip: null,
  price: {},
  tickerStatisticsIntervalId: null,
  genesis: null,
});

// Initialize store with centralized storage sync
const SYNC_KEYS = ['assets', 'dreps', 'pools', 'epochParams', 'tip', 'price', 'tickerStatisticsIntervalId', 'genesis'];

// Hydrate from storage on initialization
hydrateStore('networkStore', networkStore);

// Set up centralized storage sync
const unsubscribe = createStorageSync(networkStore, {
  storeName: 'networkStore',
  syncKeys: SYNC_KEYS,
  debugPrefix: '🔄 NetworkStore'
});

// Clean up on unload (for contexts that support it)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', unsubscribe);
}

async function persist(patch: Partial<NetworkStore>): Promise<void> {
  const next = { ...networkStore, ...patch };
  await smartPersist('networkStore', next);
}

export default {
  setAssets(assets: any) {
    const context = getContextType();
    console.debug(`🔍 NetworkStore setAssets called from ${context} context`);
    networkStore.assets = assets;
    
    // Only persist from background context to prevent cross-context conflicts
    if (context === 'background') {
      persist({ assets: assets });
    }
  },
  setDReps(dreps: any) {
    const context = getContextType();
    console.debug(`🔍 NetworkStore setDReps called from ${context} context`);
    networkStore.dreps = dreps;
    
    // Only persist from background context to prevent cross-context conflicts
    if (context === 'background') {
      persist({ dreps: dreps });
    }
  },
  setPools(pools: any) {
    const context = getContextType();
    console.debug(`🔍 NetworkStore setPools called from ${context} context`);
    networkStore.pools = pools;
    
    // Only persist from background context to prevent cross-context conflicts
    if (context === 'background') {
      persist({ pools: pools });
    }
  },
  setEpochParams(epochParams: Cardano.ProtocolParameters) {
    const context = getContextType();
    console.debug(`🔍 NetworkStore setEpochParams called from ${context} context`);
    networkStore.epochParams = epochParams;
    
    // Only persist from background context to prevent cross-context conflicts
    if (context === 'background') {
      persist({ epochParams: epochParams });
    }
  },
  setTip(tip: Cardano.Tip & { epoch: number; time: number; epoch_slot: number;}) {
    const context = getContextType();
    console.debug(`🔍 NetworkStore setTip called from ${context} context`);
    networkStore.tip = tip;
    
    // Only persist from background context to prevent cross-context conflicts
    if (context === 'background') {
      persist({ tip: tip });
    }
  },
  setPrice(price: {}) {
    const context = getContextType();
    console.debug(`🔍 NetworkStore setPrice called from ${context} context`);
    networkStore.price = price;
    
    // Only persist from background context to prevent cross-context conflicts
    if (context === 'background') {
      persist({ price: price });
    }
  },
  setTickerStatisticsIntervalId(tickerStatisticsIntervalId: any) {
    const context = getContextType();
    console.debug(`🔍 NetworkStore setTickerStatisticsIntervalId called from ${context} context`);
    networkStore.tickerStatisticsIntervalId = tickerStatisticsIntervalId;
    
    // Only persist from background context to prevent cross-context conflicts
    if (context === 'background') {
      persist({ tickerStatisticsIntervalId: tickerStatisticsIntervalId });
    }
  },
  setGenesis(genesis: any) {
    const context = getContextType();
    console.debug(`🔍 NetworkStore setGenesis called from ${context} context`);
    networkStore.genesis = genesis;
    
    // Only persist from background context to prevent cross-context conflicts
    if (context === 'background') {
      persist({ genesis: genesis });
    }
  },
  state: networkStore
};
