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
    Object.assign(networkStore, changes['networkStore'].newValue);
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
