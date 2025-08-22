import Vue from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';

export interface NetworkStore {
  assets: any;
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

// Create observable state
export const networkStore = Vue.observable<NetworkStore>({
  assets: {},
  epochParams: null,
  tip: null,
  price: {},
  tickerStatisticsIntervalId: null,
  genesis: null,
});

const STORE_NAME = 'networkStore';
const context = getContextType();

// Initialize messaging based on context
if (context === 'browser') {
  console.debug(`🔌 Initializing network store messaging in browser context`);
  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<NetworkStore>) => {
    console.debug('📥 Received network store update:', updates);

    // Apply updates to the observable state
    Object.keys(updates).forEach(key => {
      if (key in networkStore) {
        (networkStore as any)[key] = updates[key as keyof NetworkStore];
      }
    });
  });

  // Initial hydration from chrome.storage (fallback for initial state)
  chrome.storage.local.get(STORE_NAME, (result) => {
    if (result[STORE_NAME]) {
      Object.assign(networkStore, result[STORE_NAME]);
      console.debug('💾 Hydrated network store from storage');
    }
  });
}

/**
 * Broadcast updates from background context
 */
function broadcastFromBackground(updates: Partial<NetworkStore>) {
  if (context === 'background') {
    // Serialize data for broadcasting (handle BigInt, Maps, etc.)
    const serializedUpdates = JSON.parse(JSON.stringify(updates, (key, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      } else if (value instanceof Map) {
        return Array.from(value.entries()).reduce((obj, [key, value]) => {
          obj[key] = value;
          return obj;
        }, {});
      } else if (value instanceof Set) {
        return Array.from(value);
      } else {
        return value;
      }
    }));

    // Broadcast to all connected browser contexts
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, serializedUpdates);

    // Also persist to storage as fallback
    chrome.storage.local.get(STORE_NAME, (result) => {
      const current = result[STORE_NAME] || {
        assets: {},
        epochParams: null,
        tip: null,
        price: {},
        tickerStatisticsIntervalId: null,
        genesis: null
      };
      chrome.storage.local.set({
        [STORE_NAME]: { ...current, ...serializedUpdates }
      });
    });
  }
}

export default {
  setAssets(assets: any) {
    const context = getContextType();
    console.debug(`🔍 NetworkStore setAssets called from ${context} context`);
    networkStore.assets = assets;

    // Broadcast from background context
    broadcastFromBackground({ assets });
  },

  setEpochParams(epochParams: Cardano.ProtocolParameters) {
    const context = getContextType();
    console.debug(`🔍 NetworkStore setEpochParams called from ${context} context`);
    networkStore.epochParams = epochParams;

    // Broadcast from a background context
    broadcastFromBackground({ epochParams });
  },

  setTip(tip: Cardano.Tip & { epoch: number; time: number; epoch_slot: number;}) {
    const context = getContextType();
    console.debug(`🔍 NetworkStore setTip called from ${context} context`);
    networkStore.tip = tip;

    // Broadcast from background context
    broadcastFromBackground({ tip });
  },

  setPrice(price: {}) {
    const context = getContextType();
    console.debug(`🔍 NetworkStore setPrice called from ${context} context`);
    networkStore.price = price;

    // Broadcast from background context
    broadcastFromBackground({ price });
  },

  setTickerStatisticsIntervalId(tickerStatisticsIntervalId: any) {
    const context = getContextType();
    console.debug(`🔍 NetworkStore setTickerStatisticsIntervalId called from ${context} context`);
    networkStore.tickerStatisticsIntervalId = tickerStatisticsIntervalId;

    // Broadcast from background context
    broadcastFromBackground({ tickerStatisticsIntervalId });
  },

  setGenesis(genesis: any) {
    const context = getContextType();
    console.debug(`🔍 NetworkStore setGenesis called from ${context} context`);
    networkStore.genesis = genesis;

    // Broadcast from background context
    broadcastFromBackground({ genesis });
  },

  // Expose the observable state
  state: networkStore,

  // Utility method to get current state snapshot
  getSnapshot(): NetworkStore {
    return { ...networkStore };
  },

  // Utility method to reset state
  reset() {
    const resetState: NetworkStore = {
      assets: {},
      epochParams: null,
      tip: null,
      price: {},
      tickerStatisticsIntervalId: null,
      genesis: null
    };

    Object.assign(networkStore, resetState);
    broadcastFromBackground(resetState);
  },

  // Utility method to check if network is synced
  isSynced(): boolean {
    return networkStore.tip !== null && networkStore.epochParams !== null;
  },

  // Utility method to get current epoch
  getCurrentEpoch(): number | null {
    return networkStore.tip?.epoch || null;
  },

  // Utility method to get current slot
  getCurrentSlot(): number | null {
    return networkStore.tip?.slot || null;
  },

  // Utility method to get current block height
  getCurrentBlockHeight(): number | null {
    return networkStore.tip?.blockNo || null;
  },

  // Utility method to get ADA price in USD
  getAdaPrice(): number {
    return networkStore.price?.lastPrice || 0;
  },

  // Utility method to get price change percentage
  getPriceChangePercent(): number {
    return networkStore.price?.priceChangePercentage || 0;
  },

  // Utility method to check if an asset exists
  hasAsset(unit: string): boolean {
    return unit in networkStore.assets;
  },

  // Utility method to get asset by unit
  getAsset(unit: string): any {
    return networkStore.assets[unit];
  }
};
