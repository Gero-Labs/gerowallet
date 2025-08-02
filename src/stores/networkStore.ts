import Vue from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { createStorageSync, smartPersist, hydrateStore } from '@/utils/storageSync';

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
    networkStore.assets = assets;
    persist({ assets: assets });
  },
  setDReps(dreps: any) {
    networkStore.dreps = dreps;
    persist({ dreps: dreps });
  },
  setPools(pools: any) {
    networkStore.pools = pools;
    persist({ pools: pools });
  },
  setEpochParams(epochParams: Cardano.ProtocolParameters) {
    networkStore.epochParams = epochParams;
    persist({ epochParams: epochParams });
  },
  setTip(tip: Cardano.Tip & { epoch: number; time: number; epoch_slot: number;}) {
    networkStore.tip = tip;
    persist({ tip: tip });
  },
  setPrice(price: {}) {
    networkStore.price = price;
    persist({ price: price });
  },
  setTickerStatisticsIntervalId(tickerStatisticsIntervalId: any) {
    networkStore.tickerStatisticsIntervalId = tickerStatisticsIntervalId
    persist({ tickerStatisticsIntervalId: tickerStatisticsIntervalId });
  },
  setGenesis(genesis: any) {
    networkStore.genesis = genesis;
    persist({ genesis: genesis });
  },
  state: networkStore
};
