import Vue from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';
import { debugLog } from '@/utils/debug';

/**
 * Cardano tip: the SDK tip enriched with the epoch/time/epoch_slot fields the
 * sync layer attaches. Shape is unchanged from before the BTC union was added.
 */
export type CardanoTip = Cardano.Tip & {
  epoch: number;
  time: number;
  epoch_slot: number;
};

/**
 * Bitcoin tip: height-only (no slot/epoch/epoch_slot). Matches the `BtcBlock`
 * wire shape from CONTRACT-btc-wire.md, plus a `chain` discriminant so the two
 * arms of the union can be told apart. `confirmations` is client-derived.
 */
export interface BitcoinTip {
  chain: 'BITCOIN';
  height: number;
  hash: string;
  time: number;
  confirmations?: number;
}

/**
 * Narrows a stored tip to the Bitcoin arm. Cardano tips have no `chain` field,
 * so the discriminant unambiguously identifies a height-only BTC tip.
 */
export function isBitcoinTip(tip: NetworkStore['tip']): tip is BitcoinTip {
  return !!tip && 'chain' in tip && tip.chain === 'BITCOIN';
}

export interface NetworkStore {
  assets: any;
  epochParams: Cardano.ProtocolParameters;
  tip: CardanoTip | BitcoinTip;
  price: any;
  genesis: any;
}

// Create observable state
export const networkStore = Vue.observable<NetworkStore>({
  assets: {},
  epochParams: null,
  tip: null,
  price: {},
  genesis: null,
});

const STORE_NAME = 'networkStore';
const context = getContextType();

// Initialize messaging based on context
// IMPORTANT: Only browser context subscribes to background updates
// Background context directly updates local store via broadcastFromBackground()
if (context === 'browser') {
  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<NetworkStore>) => {

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
    }
  });
}

// Debounced storage write to reduce I/O operations
let storageWriteTimeout: ReturnType<typeof setTimeout> | null = null;

// Serializer function for complex data types
function serializeValue(key: string, value: any): any {
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
}

/**
 * Broadcast updates from background context
 */
function broadcastFromBackground(updates: Partial<NetworkStore>) {
  if (context === 'background') {
    // Serialize data for broadcasting (handle BigInt, Maps, etc.)
    const serializedUpdates = JSON.parse(JSON.stringify(updates, serializeValue));

    // Broadcast to all connected browser contexts (immediate)
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, serializedUpdates);

    // Debounced storage write to reduce I/O operations during rapid updates
    if (storageWriteTimeout) {
      clearTimeout(storageWriteTimeout);
    }

    storageWriteTimeout = setTimeout(() => {
      try {
        // Use current local store state as the base to avoid race conditions
        const finalState = { ...networkStore };

        chrome.storage.local.set({
          [STORE_NAME]: JSON.parse(JSON.stringify(finalState, serializeValue))
        });
      } catch (error) {
        console.error('Failed to persist network store to storage:', Object.keys(updates), error);
      }
    }, 300); // 300ms debounce
  }
}

export default {
  setAssets(assets: any) {
    const context = getContextType();
    debugLog(`🔍 NetworkStore setAssets called from ${context} context`);
    networkStore.assets = assets;

    // Broadcast from background context
    broadcastFromBackground({ assets });
  },

  setEpochParams(epochParams: Cardano.ProtocolParameters) {
    const context = getContextType();
    debugLog(`🔍 NetworkStore setEpochParams called from ${context} context`);
    networkStore.epochParams = epochParams;

    // Broadcast from a background context
    broadcastFromBackground({ epochParams });
  },

  setTip(tip: CardanoTip | BitcoinTip) {
    // Bitcoin path (Phase 3): height-only monotonic guard, kept in a SEPARATE
    // branch so the Cardano path below stays byte-identical. A BTC tip never
    // overwrites a newer BTC tip (by block height); the two chains never share a
    // wallet, so a BTC tip is only ever compared against another BTC tip.
    if (isBitcoinTip(tip)) {
      const current = networkStore.tip;
      if (current && isBitcoinTip(current) && tip.height <= current.height) {
        debugLog(`⚠️ Ignoring older/duplicate BTC tip - current: ${current.height}, new: ${tip.height}`);
        return;
      }
      debugLog(`✅ Setting new BTC tip - height: ${tip.height}`);
      networkStore.tip = tip;
      broadcastFromBackground({ tip });
      return;
    }

    // RACE CONDITION FIX: Only update tip if it's newer than the current one
    // Prevents old Ably messages from overwriting fresh data
    if (networkStore.tip && !isBitcoinTip(networkStore.tip)) {
      // Compare by block height (blockNo) - higher is newer
      if (tip.blockNo <= networkStore.tip.blockNo) {
        debugLog(`⚠️ Ignoring older/duplicate tip - current: ${networkStore.tip.blockNo}, new: ${tip.blockNo}`);
        return;
      }
    }

    debugLog(`✅ Setting new tip - blockNo: ${tip.blockNo}, epoch: ${tip.epoch}`);
    networkStore.tip = tip;

    // Broadcast from background context
    broadcastFromBackground({ tip });
  },

  setPrice(price: {}) {
    networkStore.price = price;
    // Broadcast from background context
    broadcastFromBackground({ price });
  },

  setGenesis(genesis: any) {
    const context = getContextType();
    debugLog(`🔍 NetworkStore setGenesis called from ${context} context`);
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
      genesis: null
    };

    Object.assign(networkStore, resetState);
    broadcastFromBackground(resetState);
  },

  // Utility method to check if network is synced
  isSynced(): boolean {
    return networkStore.tip !== null && networkStore.epochParams !== null;
  },

  // Utility method to get current epoch (Cardano-only; null for a BTC tip)
  getCurrentEpoch(): number | null {
    const tip = networkStore.tip;
    if (!tip || isBitcoinTip(tip)) return null;
    return tip.epoch || null;
  },

  // Utility method to get current slot (Cardano-only; null for a BTC tip)
  getCurrentSlot(): number | null {
    const tip = networkStore.tip;
    if (!tip || isBitcoinTip(tip)) return null;
    return tip.slot || null;
  },

  // Utility method to get current block height (chain-neutral: `height` for a BTC
  // tip, `blockNo` for a Cardano tip).
  getCurrentBlockHeight(): number | null {
    const tip = networkStore.tip;
    if (!tip) return null;
    if (isBitcoinTip(tip)) return tip.height ?? null;
    return tip.blockNo || null;
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
