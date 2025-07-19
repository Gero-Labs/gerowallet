import Vue from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { WalletBg } from '@/chrome/walletBg';

export interface WalletStore {
  loggedWallet: any;
  account: any;
  transactions: any[];
  utxos: Cardano.Utxo[];
  keys: any;
  tokens: {};
  collections: {};
  config: any;
  fiatRates: {};
  fiatRatesIntervalId: any;
  rewards?: any[];
  contacts?: any;
}

export const walletStore = Vue.observable<WalletStore>({
  loggedWallet: null,
  account: null,
  transactions: [],
  utxos: [],
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
  },
  fiatRates: null,
  fiatRatesIntervalId: null,
  rewards: [],
  contacts: {},
});

chrome.storage.local.get('walletStore', (res) => {
  const stored = res['walletStore']
  if (stored) {
    Object.assign(walletStore, stored);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['walletStore']) {
    const newValue = changes['walletStore'].newValue;
    // Only update if we don't have more tokens than what's in storage
    // This prevents overwriting fresh token data with stale storage data
    if (!newValue.tokens || Object.keys(newValue.tokens || {}).length >= Object.keys(walletStore.tokens || {}).length) {
      Object.assign(walletStore, newValue);
    } else {
      // Update everything except tokens if storage has fewer tokens than current state
      const { tokens, ...otherProps } = newValue;
      Object.assign(walletStore, otherProps);
    }
  }
});

function persist(patch: Partial<WalletStore>) {
  const next = { ...walletStore, ...patch };
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
  )
  chrome.storage.local.set({ walletStore: JSON.parse(nextString) });
}

export default {
  setLoggedWallet(loggedWallet: WalletBg) {
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
    walletStore.utxos = utxos;
    persist({ utxos: utxos });
  },
  setKeys(keys: any) {
    walletStore.keys = keys;
    persist({ keys: keys });
  },
  setTokens(tokens: {}) {
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
  },
  logout() {
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
  },
  state: walletStore
};
