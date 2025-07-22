import Vue from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { removeDapp, setWalletConfiguration, addConnectedDapp } from '@/db/wallet-db';

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

chrome.storage.local.get('walletStore', (res) => {
  const stored = res['walletStore']
  if (stored) {
    Object.assign(walletStore, stored);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['walletStore']) {
    const newValue = changes['walletStore'].newValue;

    // Prevent flickering by checking if incoming data is stale for various properties
    const updatedProps = { ...newValue };

    // Check tokens - don't overwrite if current state has more tokens
    if (newValue.tokens && walletStore.tokens &&
        Object.keys(newValue.tokens).length < Object.keys(walletStore.tokens).length) {
      delete updatedProps.tokens;
    }

    // Check collections - don't overwrite if current state has more collections
    if (newValue.collections && walletStore.collections &&
        Object.keys(newValue.collections).length < Object.keys(walletStore.collections).length) {
      delete updatedProps.collections;
    }

    // Check transactions - don't overwrite if current state has more transactions
    if (newValue.transactions && walletStore.transactions &&
        newValue.transactions.length < walletStore.transactions.length) {
      delete updatedProps.transactions;
    }

    // Check utxos - don't overwrite if current state has more utxos
    if (newValue.utxos && walletStore.utxos &&
        newValue.utxos.length < walletStore.utxos.length) {
      delete updatedProps.utxos;
    }

    // Check rewards - don't overwrite if current state has more rewards
    if (newValue.rewards && walletStore.rewards &&
        newValue.rewards.length < walletStore.rewards.length) {
      delete updatedProps.rewards;
    }

    // Check contacts - don't overwrite if current state has more contacts
    if (newValue.contacts && walletStore.contacts &&
        Object.keys(newValue.contacts).length < Object.keys(walletStore.contacts).length) {
      delete updatedProps.contacts;
    }

    // Check connectedDapps - don't overwrite if current state has fewer dapps (user just removed one)
    if (newValue.connectedDapps && walletStore.connectedDapps &&
        newValue.connectedDapps.length > walletStore.connectedDapps.length) {
      delete updatedProps.connectedDapps;
    }

    Object.assign(walletStore, updatedProps);
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
  },
  state: walletStore
};
