import Vue from 'vue';
import { Cardano } from '@cardano-sdk/core';

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

chrome.storage.local.get('networkStore', (res) => {
  if (res['networkStore']) {
    Object.assign(networkStore, res['networkStore']);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['networkStore']) {
    const newValue = changes['networkStore'].newValue;
    
    // Prevent flickering by checking if incoming data is stale for various properties
    const updatedProps = { ...newValue };
    
    // Check assets - don't overwrite if current state has more assets
    if (newValue.assets && networkStore.assets && 
        Object.keys(newValue.assets).length < Object.keys(networkStore.assets).length) {
      delete updatedProps.assets;
    }
    
    // Check dreps - don't overwrite if current state has more dreps
    if (newValue.dreps && networkStore.dreps && 
        Object.keys(newValue.dreps).length < Object.keys(networkStore.dreps).length) {
      delete updatedProps.dreps;
    }
    
    // Check pools - don't overwrite if current state has more pools
    if (newValue.pools && networkStore.pools && 
        Object.keys(newValue.pools).length < Object.keys(networkStore.pools).length) {
      delete updatedProps.pools;
    }
    
    Object.assign(networkStore, updatedProps);
  }
});

function persist(patch: Partial<NetworkStore>) {
  const next = { ...networkStore, ...patch };
  chrome.storage.local.set({ networkStore: next });
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
