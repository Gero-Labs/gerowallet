import Vue from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { createStorageSync, smartPersist, hydrateStore, getContextType } from '@/utils/storageSync';
import { removeDapp, setWalletConfiguration, addConnectedDapp } from '@/db/wallet-db';
import LoadingState from '@/stores/loading';

interface WhitelistedEntry {
  domain: string;
  id: number;
}
export interface WalletStore {
  loggedWallet: any;
  account: any;
  transactions: any[];
  utxos: Cardano.Utxo[];
  collateral: any;
  keys: any;
  tokens: {};
  collections: {};
  config: any;
  fiatRates: {};
  fiatRatesIntervalId: any;
  rewards?: any[];
  contacts?: any;
  connectedDapps?: any[];
}

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

// Initialize store with centralized storage sync
const SYNC_KEYS = ['loggedWallet', 'account', 'transactions', 'utxos', 'tokens', 'collections', 'rewards', 'config', 'keys', 'contacts', 'connectedDapps', 'collateral'];

// Hydrate from storage on initialization
hydrateStore('walletStore', walletStore);

// Set up centralized storage sync
const unsubscribe = createStorageSync(walletStore, {
  storeName: 'walletStore',
  syncKeys: SYNC_KEYS,
  debugPrefix: '🔄 WalletStore'
});

// Clean up on unload (for contexts that support it)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', unsubscribe);
}

// Promise-based storage hydration for backward compatibility
export const hydrateWalletStore = (): Promise<void> => {
  return hydrateStore('walletStore', walletStore);
};

async function persist(patch: Partial<WalletStore>): Promise<void> {
  const context = getContextType();
  
  // Only persist from background context to prevent cross-context conflicts
  if (context !== 'background') {
    console.debug(`🔍 WalletStore persist skipped from ${context} context for:`, Object.keys(patch));
    return;
  }

  const next = { ...walletStore, ...patch };
  try {
    const nextString: string = JSON.stringify(next, (key, value) => {
        if (value instanceof Map) {
          return Array.from(value.entries()).reduce((obj, [key, value]) => {
            obj[key] = value;
            return obj;
          }, {});
        } else if (typeof value === 'bigint') {
          return value.toString();
        } else {
          return value;
        }
      }
    );
    await smartPersist('walletStore', JSON.parse(nextString));
  } catch (error) {
    console.error('Persist failed for patch:', Object.keys(patch), error);
    // Try to persist without the problematic patch
    if (Object.keys(patch).length === 1) {
      const key = Object.keys(patch)[0];
      console.warn(`Skipping persist for ${key} due to serialization error`);
    }
  }
}

export default {
  setLoggedWallet(loggedWallet: any) {
    walletStore.loggedWallet = loggedWallet;
    persist({ loggedWallet: loggedWallet });
  },
  setAccount(account: any) {
    walletStore.account = account;
    persist({ account: account });
  },
  setTransactions(transactions: any[]) {
    walletStore.transactions = transactions;
    persist({ transactions: transactions });
  },
  setUtxos(utxos: Cardano.Utxo[]) {
    if (utxos) {
      console.log('collateral')
      const collateralCandidates = utxos.filter((utxo: Cardano.Utxo) => {
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
    persist({ utxos: utxos });
  },
  setCollateral(collateral: Cardano.Utxo) {
    walletStore.collateral = collateral;
    persist({ collateral: collateral });
  },
  setKeys(keys: any) {
    walletStore.keys = keys;
    persist({ keys: keys });
  },
  setTokens(tokens: {}) {
    console.debug('Setting tokens:', Object.keys(tokens).length, 'tokens');
    walletStore.tokens = tokens;
    persist({ tokens: tokens });
  },
  setCollections(collections: {}) {
    walletStore.collections = collections
    persist({ collections: collections })
  },
  setConfig(config: {}) {
    walletStore.config = config;
    persist({ config: config });
  },
  setFiatRates(fiatRates: any) {
    walletStore.fiatRates = fiatRates;
    persist({ fiatRates: fiatRates });
  },
  setFiatRatesIntervalId(fiatRatesIntervalId: any) {
    walletStore.fiatRatesIntervalId = fiatRatesIntervalId;
    persist({ fiatRatesIntervalId: fiatRatesIntervalId });
  },
  setRewards(rewards: any[]) {
    walletStore.rewards = rewards;
    persist({ rewards: rewards });
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
    persist({ contacts: contacts });
  },
  setBackup(value: boolean) {
    if (walletStore.config && walletStore.loggedWallet) {
      walletStore.config.backup = value;
      persist({ config: walletStore.config });
      setWalletConfiguration(walletStore.loggedWallet.id, 'backup', value);
    }
  },
  setHideScamTokens(value: boolean) {
    if (walletStore.config && walletStore.loggedWallet) {
      walletStore.config.hideScamTokens = value;
      persist({ config: walletStore.config });
      setWalletConfiguration(walletStore.loggedWallet.id, 'hideScamTokens', value);
    }
  },
  setHideUnverifiedTokens(value: boolean) {
    if (walletStore.config && walletStore.loggedWallet) {
      walletStore.config.hideUnverifiedTokens = value;
      persist({ config: walletStore.config });
      setWalletConfiguration(walletStore.loggedWallet.id, 'hideUnverifiedTokens', value);
    }
  },
  setHideUnratedTokens(value: boolean) {
    if (walletStore.config && walletStore.loggedWallet) {
      walletStore.config.hideUnratedTokens = value;
      persist({ config: walletStore.config });
      setWalletConfiguration(walletStore.loggedWallet.id, 'hideUnratedTokens', value);
    }
  },
  setLocale(value: string) {
    if (walletStore.config && walletStore.loggedWallet) {
      walletStore.config.locale = value;
      persist({ config: walletStore.config });
      setWalletConfiguration(walletStore.loggedWallet.id, 'locale', value);
    }
  },
  setConnectedDapps(connectedDapps: any[]) {
    walletStore.connectedDapps = connectedDapps;
    persist({ connectedDapps: connectedDapps });
  },
  async addConnectedDapp(walletId: number, domain: string) {
    try {
      // Use the database function to add the dapp
      const domainObject = await addConnectedDapp(walletId, domain);

      if (domainObject) {
        // Update store immediately for instant UI feedback
        const updatedDapps = [...walletStore.connectedDapps, domainObject];
        walletStore.connectedDapps = updatedDapps;
        persist({ connectedDapps: updatedDapps });
      }
    } catch (err) {
      console.error(`Failed to add connected dapp in walletStore: ${err}`);
    }
  },
  disconnectDapp(walletId: number, id: string) {
    // Update UI immediately for instant feedback
    const updatedDapps = walletStore.connectedDapps.filter(dapp => dapp.id !== id);
    walletStore.connectedDapps = updatedDapps;
    persist({ connectedDapps: updatedDapps });

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
    console.debug('🚪 LOGOUT: Clearing all wallet data including tokens');
    this.setLoggedWallet(null);
    this.setAccount(null);
    this.setTransactions([]);
    this.setUtxos([]);
    this.setKeys(null);
    this.setTokens({});
    this.setCollections({});
    this.setConfig({});
    this.setFiatRates(null);
    this.setFiatRatesIntervalId(null);
    this.setRewards([]);
    this.setConnectedDapps([]);
    chrome.alarms.clearAll();
  },
  clearForWalletSwitch() {
    // Clear all wallet-specific data immediately during wallet switching
    // This prevents cross-wallet data contamination
    walletStore.account = null;
    walletStore.transactions = [];
    walletStore.utxos = [];
    walletStore.collateral = null;
    walletStore.keys = null;
    walletStore.tokens = {};
    walletStore.collections = {};
    walletStore.rewards = [];
    walletStore.contacts = {};
    walletStore.connectedDapps = [];
    // Reset loading states to prevent stuck loading indicators
    LoadingState.setLoadingTxs(false);
    // Note: loggedWallet and config are updated separately during login process
  },
  state: walletStore
};
