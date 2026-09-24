import Vue from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { getContextType } from '@/utils/storageSync';
import { StorePersister } from '@/utils/storePersistence';
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

// A native-asset row as written by the assets liveQuery (db/loaders/network.ts).
// resolveAsset() in shared/utils/resolver.ts walks AND mutates its nested metadata
// (asset.metadata.decimals, asset.onchain_metadata['721'], CIP-68 extras), so pinning
// a real shape here means retyping that whole CIP-25/CIP-68 walk. Left dynamic on
// purpose, same as TokenRow in TokensTab.vue.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NetworkAsset = any;

export interface NetworkStore {
  assets: Record<string, NetworkAsset>;
  epochParams: Cardano.ProtocolParameters;
  tip: CardanoTip | BitcoinTip;
  genesis: Record<string, unknown> | null;
}

// Create observable state
export const networkStore = Vue.observable<NetworkStore>({
  assets: {},
  epochParams: null,
  tip: null,
  genesis: null,
});

const STORE_NAME = 'networkStore';
const context = getContextType();

// `assets` (every native-asset row this profile has seen, metadata included) goes to
// IndexedDB; the tip, epoch parameters and genesis stay in the small chrome.storage
// record. Without the split, every new block rewrote the whole asset map through
// chrome.storage (see storeCache.ts).
const persister = new StorePersister(networkStore as unknown as Record<string, unknown>, {
  storeName: STORE_NAME,
  bulkFields: ['assets'],
  replacer: serializeValue,
});

// Initialize messaging based on context
// IMPORTANT: Only browser context subscribes to background updates
// Background context directly updates local store via broadcastFromBackground()
if (context === 'browser') {
  // Fields the port has delivered: fresher than anything hydration reads back.
  const deliveredFields = new Set<string>();

  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<NetworkStore>) => {

    // Apply updates to the observable state
    Object.keys(updates).forEach(key => {
      if (key in networkStore) {
        deliveredFields.add(key);
        (networkStore as unknown as Record<string, unknown>)[key] = updates[key as keyof NetworkStore];
      }
    });
  });

  // Initial hydration from persisted state (fallback for initial state)
  void persister.hydrate({ skip: deliveredFields });
}

// Serializer function for complex data types
function serializeValue(key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  } else if (value instanceof Map) {
    return Array.from(value.entries()).reduce<Record<string, unknown>>((obj, [key, value]) => {
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

    // Persist only what changed: a new tip no longer rewrites the asset map.
    persister.markDirty(Object.keys(updates));
  }
}

export default {
  setAssets(assets: Record<string, NetworkAsset>) {
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

  setGenesis(genesis: Record<string, unknown>) {
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

  // Utility method to check if an asset exists
  hasAsset(unit: string): boolean {
    return unit in networkStore.assets;
  },

  // Utility method to get asset by unit
  getAsset(unit: string): NetworkAsset {
    return networkStore.assets[unit];
  }
};
