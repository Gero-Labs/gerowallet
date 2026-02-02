import Vue from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';
import { addConnectedDapp, removeDapp, setWalletConfiguration } from '@/db/wallet-db';
import LoadingState from '@/stores/loading';
import priceService from '@/stores/priceStore';
import { Keys } from '@/models/types';

interface WhitelistedEntry {
  domain: string;
  id: number;
}

/**
 * Clear only wallet-specific Chrome alarms
 * Preserves system alarms like 'auto-lock-check' and 'clearProcessedDomains'
 */
function clearWalletSpecificAlarms() {
  const SYSTEM_ALARMS = ['auto-lock-check', 'clearProcessedDomains'];

  chrome.alarms.getAll((alarms) => {
    alarms.forEach((alarm) => {
      if (!SYSTEM_ALARMS.includes(alarm.name)) {
        chrome.alarms.clear(alarm.name);
      }
    });
  });
}

export interface Account {
  active: boolean;
  active_epoch: number;
  controlled_amount: string;
  drep_id: string;
  id: number;
  pool_id: string;
  reserves_sum: string;
  rewards_sum: string;
  treasury_sum: string;
  walletId: number;
  withdrawable_amount: string;
  withdrawals_sum: string;
}

export interface WalletStore {
  loggedWallet: any;
  isLocked: boolean;
  account: Account;
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
  isLocked: false,
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
    websiteProtection: true,
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
if (context === 'browser') {
  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<WalletStore>) => {
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

      // Initialize price service if wallet is logged in
      if (result[STORE_NAME].loggedWallet && result[STORE_NAME].loggedWallet.chain === 'Cardano') {
        priceService.initialize().catch(error => {
          console.error('Failed to initialize price service on hydration:', error);
        });
      }
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
    // Serialize data for broadcasting (handle BigInt, Maps, etc.)
    const serializedUpdates = JSON.parse(JSON.stringify(updates, serializeValue));

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

  setLocked(isLocked: boolean) {
    walletStore.isLocked = isLocked;
    broadcastFromBackground({ isLocked });
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
      const collateralCandidates: Cardano.Utxo[] = utxos.filter((utxo: Cardano.Utxo) => {
        const assetsSize = utxo[1].value.assets?.size || 0;
        return assetsSize === 0 && Number(utxo[1].value.coins.toString()) >= 5000000 && Number(utxo[1].value.coins.toString()) <= 20000000
      }).sort((a, b) => {
        return Number(a[1].value.coins.toString()) - Number(b[1].value.coins.toString())
      })
      if (collateralCandidates && collateralCandidates.length > 0 && utxos.length > 1) {
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
    walletStore.keys = keys;
    broadcastFromBackground({ keys });
  },

  setTokens(tokens: {}) {
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

  async setLocale(value: string) {
    // CRITICAL: Always save to geroStore (global preference, persists across login/logout)
    const { default: GeroStore } = await import('@/stores/geroStore');
    await GeroStore.setLocale(value);

    // Also save to walletStore config if a wallet is logged in (backward compatibility)
    if (walletStore.config && walletStore.loggedWallet) {
      walletStore.config.locale = value;
      broadcastFromBackground({ config: walletStore.config });
      setWalletConfiguration(walletStore.loggedWallet.id, 'locale', value);
    }
  },

  setWebsiteProtection(value: boolean) {
    if (walletStore.config && walletStore.loggedWallet) {
      walletStore.config.websiteProtection = value;
      broadcastFromBackground({ config: walletStore.config });
      setWalletConfiguration(walletStore.loggedWallet.id, 'websiteProtection', value);
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
    // Disconnect price service
    priceService.disconnect();

    // Clear all data at once
    const clearedState: Partial<WalletStore> = {
      loggedWallet: null,
      isLocked: false,  // Reset locked state on logout
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

    // Clear wallet-specific alarms only (keep system alarms like auto-lock-check)
    clearWalletSpecificAlarms();
  },

  clearForWalletSwitch() {
    // Reconnect price service for the new wallet context
    priceService.disconnect();

    // CRITICAL: Clear wallet-specific alarms only (keep system alarms like auto-lock-check)
    clearWalletSpecificAlarms();

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
