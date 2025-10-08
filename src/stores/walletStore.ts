import Vue from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';
import { addConnectedDapp, removeDapp, setWalletConfiguration } from '@/db/wallet-db';
import LoadingState from '@/stores/loading';
import priceService from '@/stores/priceStore';
import { Keys } from '@/models/types';
import { debugLog } from '@/utils/debug';

interface WhitelistedEntry {
  domain: string;
  id: number;
}

export interface WalletStore {
  loggedWallet: any;
  account: any;
  transactions: any[];
  utxos: Cardano.Utxo[];
  collateral: Cardano.Utxo | null;
  keys: Keys;
  tokens: {};
  collections: {};
  config: any;
  fiatRates: {};
  fiatRatesIntervalId: any;
  rewards?: any[];
  contacts?: any;
  connectedDapps?: any[];
}

// Create observable state
export const walletStore = Vue.observable<WalletStore>({
  loggedWallet: null,
  account: null,
  transactions: [],
  utxos: [],
  collateral: null,
  keys: null,
  tokens: {},
  collections: {},
  config: {
    tokenAllocationSort: {
      by: 'allocation',
      desc: true
    },
    hideScamTokens: false,
    hideUnratedTokens: false,
    hideUnverifiedTokens: false,
    stakingProView: false,
    currency: 'usd',
    locale: 'us',
    txAutoSubmit: true,
    useSidePanel: true,
  },
  fiatRates: null,
  fiatRatesIntervalId: null,
  rewards: [],
  contacts: {},
  connectedDapps: []
});

const STORE_NAME = 'walletStore';
const context = getContextType();

// Initialize messaging based on context
// IMPORTANT: Only browser context subscribes to background updates
// Background context directly updates local store via broadcastFromBackground()
if (context === 'browser') {
  debugLog(`🔌 Initializing wallet store messaging in browser context`);
  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<WalletStore>) => {
    debugLog('📥 Received wallet store update:', updates);

    // Apply updates to the observable state
    Object.keys(updates).forEach(key => {
      if (key in walletStore) {
        (walletStore as any)[key] = updates[key as keyof WalletStore];
      }
    });
  });

  // Initial hydration from chrome.storage (fallback for initial state)
  chrome.storage.local.get(STORE_NAME, (result) => {
    if (result[STORE_NAME]) {
      Object.assign(walletStore, result[STORE_NAME]);
      debugLog('💾 Hydrated wallet store from storage');
    }
  });
}

// Promise-based storage hydration for backward compatibility
export const hydrateWalletStore = (): Promise<void> => {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORE_NAME, (result) => {
      if (result[STORE_NAME]) {
        Object.assign(walletStore, result[STORE_NAME]);
      }
      resolve();
    });
  });
};

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
function broadcastFromBackground(updates: Partial<WalletStore>) {
  if (context === 'background') {
    // Log what we're trying to broadcast (only for critical updates)
    if ('keys' in updates) {
      debugLog('📤 Broadcasting keys update:', updates.keys ? 'keys present' : 'keys null');
    }

    // Serialize data for broadcasting (handle BigInt, Maps, etc.)
    const serializedUpdates = JSON.parse(JSON.stringify(updates, serializeValue));

    // Check if keys survived serialization
    if ('keys' in updates && 'keys' in serializedUpdates) {
      debugLog('📤 Keys after serialization:', serializedUpdates.keys ? 'keys present' : 'keys null');
    }

    // Broadcast to all connected browser contexts (immediate)
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, serializedUpdates);

    // Debounced storage write to reduce I/O operations during rapid updates
    // This batches multiple updates together while maintaining data consistency
    if (storageWriteTimeout) {
      clearTimeout(storageWriteTimeout);
    }

    storageWriteTimeout = setTimeout(() => {
      try {
        // Use the current local store state as the base to avoid race conditions
        const finalState = { ...(walletStore) };

        // Log if keys are being stored
        if ('keys' in finalState) {
          debugLog('💾 Storing keys to chrome.storage:', finalState.keys ? 'keys present' : 'keys null');
        }

        chrome.storage.local.set({
          [STORE_NAME]: JSON.parse(JSON.stringify(finalState, serializeValue))
        });
      } catch (error) {
        console.error('Failed to persist wallet store to storage:', Object.keys(updates), error);
      }
    }, 300); // 300ms debounce - balances performance with data safety
  }
}

export default {
  setLoggedWallet(loggedWallet: any) {
    walletStore.loggedWallet = loggedWallet;
    broadcastFromBackground({ loggedWallet });

    // Initialize price service when wallet is set
    if (loggedWallet && loggedWallet.chain === 'Cardano') {
      priceService.initialize().catch(error => {
        console.error('Failed to initialize price service:', error);
      });
    }
  },

  setAccount(account: any) {
    walletStore.account = account;
    broadcastFromBackground({ account });
  },

  setTransactions(transactions: any[]) {
    walletStore.transactions = transactions;
    broadcastFromBackground({ transactions });
  },

  setUtxos(utxos: Cardano.Utxo[]) {
    if (utxos) {
      console.log('collateral')
      const collateralCandidates: Cardano.Utxo[] = utxos.filter((utxo: Cardano.Utxo) => {
        const assetsSize = utxo[1].value.assets?.size || 0;
        return assetsSize === 0 && Number(utxo[1].value.coins.toString()) >= 5000000 && Number(utxo[1].value.coins.toString()) <= 20000000
      }).sort((a, b) => {
        return Number(a[1].value.coins.toString()) - Number(b[1].value.coins.toString())
      })
      if (collateralCandidates && collateralCandidates.length > 0) {
        this.setCollateral(collateralCandidates[0])
      }
    }
    walletStore.utxos = utxos;
    broadcastFromBackground({ utxos });
  },

  setCollateral(collateral: Cardano.Utxo) {
    walletStore.collateral = collateral;
    broadcastFromBackground({ collateral });
  },

  setKeys(keys: any) {
    debugLog('🔑 Setting keys in walletStore:', keys);
    walletStore.keys = keys;
    broadcastFromBackground({ keys });
  },

  setTokens(tokens: {}) {
    debugLog('Setting tokens:', Object.keys(tokens).length, 'tokens');
    walletStore.tokens = tokens;
    broadcastFromBackground({ tokens });
  },

  setCollections(collections: {}) {
    walletStore.collections = collections;
    broadcastFromBackground({ collections });
  },

  setConfig(config: {}) {
    walletStore.config = config;
    broadcastFromBackground({ config });
  },

  setFiatRates(fiatRates: any) {
    walletStore.fiatRates = fiatRates;
    broadcastFromBackground({ fiatRates });
  },

  setFiatRatesIntervalId(fiatRatesIntervalId: any) {
    walletStore.fiatRatesIntervalId = fiatRatesIntervalId;
    broadcastFromBackground({ fiatRatesIntervalId });
  },

  setRewards(rewards: any[]) {
    walletStore.rewards = rewards;
    broadcastFromBackground({ rewards });
  },

  getTxAutoSubmit(state) {
    if (state?.config && 'txAutoSubmit' in state.config) {
      return state.config.txAutoSubmit
    }
    return true
  },

  getUseSidePanel(state) {
    if (state?.config && 'useSidePanel' in state.config) {
      return state.config.useSidePanel
    }
    return false
  },

  hasBackup(): boolean {
    return 'backup' in walletStore.config;
  },

  getBackup(): boolean {
    if (walletStore.config && this.hasBackup) {
      return walletStore.config.backup
    }
    return true
  },

  setContacts(contacts: any) {
    walletStore.contacts = contacts;
    broadcastFromBackground({ contacts });
  },

  setBackup(value: boolean) {
    if (walletStore.config && walletStore.loggedWallet) {
      walletStore.config.backuzp = value;
      broadcastFromBackground({ config: walletStore.config });
      setWalletConfiguration(walletStore.loggedWallet.id, 'backup', value);
    }
  },

  setHideScamTokens(value: boolean) {
    if (walletStore.config && walletStore.loggedWallet) {
      walletStore.config.hideScamTokens = value;
      broadcastFromBackground({ config: walletStore.config });
      setWalletConfiguration(walletStore.loggedWallet.id, 'hideScamTokens', value);
    }
  },

  setHideUnverifiedTokens(value: boolean) {
    if (walletStore.config && walletStore.loggedWallet) {
      walletStore.config.hideUnverifiedTokens = value;
      broadcastFromBackground({ config: walletStore.config });
      setWalletConfiguration(walletStore.loggedWallet.id, 'hideUnverifiedTokens', value);
    }
  },

  setHideUnratedTokens(value: boolean) {
    if (walletStore.config && walletStore.loggedWallet) {
      walletStore.config.hideUnratedTokens = value;
      broadcastFromBackground({ config: walletStore.config });
      setWalletConfiguration(walletStore.loggedWallet.id, 'hideUnratedTokens', value);
    }
  },

  setLocale(value: string) {
    if (walletStore.config && walletStore.loggedWallet) {
      walletStore.config.locale = value;
      broadcastFromBackground({ config: walletStore.config });
      setWalletConfiguration(walletStore.loggedWallet.id, 'locale', value);
    }
  },

  setConnectedDapps(connectedDapps: any[]) {
    walletStore.connectedDapps = connectedDapps;
    broadcastFromBackground({ connectedDapps });
  },

  async addConnectedDapp(walletId: number, domain: string) {
    try {
      // Use the database function to add the dapp
      const domainObject = await addConnectedDapp(walletId, domain);

      if (domainObject) {
        // Update store immediately for instant UI feedback
        const updatedDapps = [...walletStore.connectedDapps, domainObject];
        walletStore.connectedDapps = updatedDapps;
        broadcastFromBackground({ connectedDapps: updatedDapps });
      }
    } catch (err) {
      console.error(`Failed to add connected dapp in walletStore: ${err}`);
    }
  },

  disconnectDapp(walletId: number, id: string) {
    // Update UI immediately for instant feedback
    const updatedDapps = walletStore.connectedDapps.filter(dapp => dapp.id !== id);
    walletStore.connectedDapps = updatedDapps;
    broadcastFromBackground({ connectedDapps: updatedDapps });

    // Remove from database - the loadConnectedDapps() subscription will sync
    // but won't cause UI flickering since we already updated the store
    removeDapp(walletId, id);
  },

  isWhitelisted(origin: string): boolean {
    if (!walletStore.connectedDapps || !Array.isArray(walletStore.connectedDapps)) return false;
    const whitelisted = walletStore.connectedDapps as WhitelistedEntry[]
    return !!whitelisted.find(el => origin.includes(el.domain));
  },

  logout() {
    debugLog('🚪 LOGOUT: Clearing all wallet data including tokens');

    // Disconnect price service
    priceService.disconnect();

    // Clear all data at once
    const clearedState: Partial<WalletStore> = {
      loggedWallet: null,
      account: null,
      transactions: [],
      contacts: {},
      utxos: [],
      collateral: null,
      keys: null,
      tokens: {},
      collections: {},
      config: {},
      fiatRates: null,
      fiatRatesIntervalId: null,
      rewards: [],
      connectedDapps: []
    };

    // Apply to local state
    Object.assign(walletStore, clearedState);

    // Broadcast all changes at once
    broadcastFromBackground(clearedState);

    // Clear Chrome alarms
    chrome.alarms.clearAll();
  },

  clearForWalletSwitch() {
    debugLog('🧹 clearForWalletSwitch called - clearing keys and other wallet data');

    // Reconnect price service for the new wallet context
    priceService.disconnect();

    // CRITICAL: Clear all Chrome alarms to prevent memory leaks during wallet switching
    chrome.alarms.clearAll();
    debugLog('🧹 Cleared all Chrome alarms during wallet switch');

    // Clear intervals to prevent memory leaks
    if (walletStore.fiatRatesIntervalId) {
      clearInterval(walletStore.fiatRatesIntervalId);
      walletStore.fiatRatesIntervalId = null;
    }

    // Clear all wallet-specific data immediately during wallet switching
    // This prevents cross-wallet data contamination
    const clearedState: Partial<WalletStore> = {
      account: null,
      transactions: [],
      utxos: [],
      collateral: null,
      keys: null,
      tokens: {},
      collections: {},
      rewards: [],
      contacts: {},
      connectedDapps: [],
      fiatRatesIntervalId: null
    };

    // Apply to a local state
    Object.assign(walletStore, clearedState);

    // Clear loading state
    LoadingState.setLoadingTxs(false);

    // Note: We don't broadcast here because the background script
    // will update with new wallet data shortly
  },

  // Expose the observable state
  state: walletStore,

  // Utility method to get the current state snapshot
  getSnapshot(): WalletStore {
    return { ...walletStore };
  },

  // Utility method to check if a wallet is logged in
  isLoggedIn(): boolean {
    return walletStore.loggedWallet !== null;
  },

  // Utility method to get current wallet ID
  getWalletId(): number | null {
    return walletStore.loggedWallet?.id || null;
  }
};
