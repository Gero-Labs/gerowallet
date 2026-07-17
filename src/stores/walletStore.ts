import Vue from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';
import { addConnectedDapp, removeDapp, setWalletConfiguration } from '@/db/wallet-db';
import LoadingState from '@/stores/loading';
import priceService from '@/stores/priceStore';
import { Contact, Keys } from '@/models/types';
import type { IUnifiedUtxo, IBalance } from '@/chains/common/interfaces';

interface WhitelistedEntry {
  domain: string;
  id: number;
}

/**
 * Exact origin/host match for the connected-dApp whitelist. Entries store the
 * dApp's full origin (scheme+host+port) captured at connect time. Compare by
 * canonicalized-origin equality — NEVER substring, which would let
 * `https://app.trusted.com.evil.com` match an entry for `https://app.trusted.com`
 * and bypass the connect/sign consent gate. Falls back to exact host equality for
 * any legacy entry stored as a bare hostname.
 */
export function matchesDappWhitelistEntry(origin: string, entryDomain: string): boolean {
  if (!origin || !entryDomain) return false;
  let reqUrl: URL;
  try {
    reqUrl = new URL(origin);
  } catch {
    return false;
  }
  try {
    return new URL(entryDomain).origin === reqUrl.origin;
  } catch {
    // Legacy entry stored as a bare hostname → exact host match (case-insensitive).
    const host = entryDomain.toLowerCase();
    return host === reqUrl.host.toLowerCase() || host === reqUrl.hostname.toLowerCase();
  }
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
  isSyncing: boolean;
  account: Account;
  transactions: any[];
  utxos: Cardano.Utxo[] | IUnifiedUtxo[];  // Support both Cardano and Bitcoin UTXOs
  collateral: Cardano.Utxo | null;
  keys: Keys;
  tokens: {};
  collections: {};
  config: any;
  rewards?: any[];
  contacts?: Record<string, Contact>;
  connectedDapps?: any[];
  // Bitcoin-specific state
  bitcoinBalance?: IBalance;  // Bitcoin balance (available, total, locked)
}

// Create observable state
export const walletStore = Vue.observable<WalletStore>({
  loggedWallet: null,
  isLocked: false,
  isSyncing: false,  // true during first restore sync — prevents navigation to dashboard
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
    hideUnverifiedTokens: false,
    hideBalances: false,
    stakingProView: false,
    currency: 'usd',
    locale: 'us',
    txAutoSubmit: true,
    websiteProtection: true,
    autoWithdrawRewards: false,
  },
  rewards: [],
  contacts: {},
  connectedDapps: [],
  // Bitcoin state
  bitcoinBalance: { available: BigInt(0), total: BigInt(0), locked: BigInt(0) }
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
      const hydratedWallet = result[STORE_NAME].loggedWallet;
      if (hydratedWallet && (hydratedWallet.chain === 'Cardano' || hydratedWallet.chain === 'Bitcoin')) {
        priceService.initialize(hydratedWallet.chain).catch(error => {
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
  setSyncing(isSyncing: boolean) {
    walletStore.isSyncing = isSyncing;
    broadcastFromBackground({ isSyncing });
  },

  setLoggedWallet(loggedWallet: any) {
    const prevAddress = walletStore.loggedWallet?.baseAddress;
    const newAddress = loggedWallet?.baseAddress;
    walletStore.loggedWallet = loggedWallet;
    broadcastFromBackground({ loggedWallet });

    // Notify every tab's content script that the active wallet address
    // changed, so the Bring SDK (listening for `gero:login` / `gero:logout`)
    // can refresh its cached walletAddress and trigger a fresh cashback token
    // fetch. Without this, tabs loaded before login keep Bring's cache at
    // null and cashback tokens are generated with walletAddress=null.
    // Fires on login (null → addr), logout (addr → null), and wallet switch
    // (addrA → addrB), but not on repeated sets with the same address.
    if (typeof chrome !== 'undefined' && chrome.tabs?.query && prevAddress !== newAddress) {
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (typeof tab.id !== 'number') continue;
          chrome.tabs.sendMessage(
            tab.id,
            { action: 'geroLoggedWalletChanged', loggedIn: !!newAddress },
            // Swallow "Receiving end does not exist" — many tabs have no content script
            () => void chrome.runtime.lastError,
          );
        }
      });
    }

    // Initialize price service when wallet is set (chain-aware)
    if (loggedWallet && (loggedWallet.chain === 'Cardano' || loggedWallet.chain === 'Bitcoin')) {
      priceService.initialize(loggedWallet.chain).catch(error => {
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

  async setUtxos(utxos: Cardano.Utxo[] | IUnifiedUtxo[]) {
    if (utxos && utxos.length > 0) {
      // Determine if these are Cardano UTXOs by checking structure
      const isCardanoUtxos = Array.isArray(utxos[0]) && utxos[0].length === 2;

      if (isCardanoUtxos) {
        // Cardano UTXO handling (existing logic)
        const cardanoUtxos = utxos as Cardano.Utxo[];
        const collateralCandidates: Cardano.Utxo[] = cardanoUtxos.filter((utxo: Cardano.Utxo) => {
          const assetsSize = utxo[1].value.assets?.size || 0;
          return assetsSize === 0 && Number(utxo[1].value.coins.toString()) >= 5000000 && Number(utxo[1].value.coins.toString()) <= 20000000
        }).sort((a, b) => {
          return Number(a[1].value.coins.toString()) - Number(b[1].value.coins.toString())
        })
        if (collateralCandidates && collateralCandidates.length > 0 && cardanoUtxos.length > 1) {
          this.setCollateral(collateralCandidates[0])
        }
      } else {
        // Bitcoin UTXO handling - calculate and store balance
        const bitcoinUtxos = utxos as IUnifiedUtxo[];
        const { calculateBitcoinBalance } = await import('@/chains/bitcoin/bitcoinUtxoManager');
        const balance = calculateBitcoinBalance(bitcoinUtxos);
        walletStore.bitcoinBalance = balance;
        broadcastFromBackground({ bitcoinBalance: balance });
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

  setHideBalances(value: boolean) {
    if (walletStore.config && walletStore.loggedWallet) {
      walletStore.config.hideBalances = value;
      broadcastFromBackground({ config: walletStore.config });
      setWalletConfiguration(walletStore.loggedWallet.id, 'hideBalances', value);
    }
  },

  setHideUnverifiedTokens(value: boolean) {
    if (walletStore.config && walletStore.loggedWallet) {
      walletStore.config.hideUnverifiedTokens = value;
      broadcastFromBackground({ config: walletStore.config });
      setWalletConfiguration(walletStore.loggedWallet.id, 'hideUnverifiedTokens', value);
    }
  },

  async setLocale(value: string) {
    // CRITICAL: Only save to geroStore (global preference, persists across login/logout)
    // DO NOT save to wallet-specific config to avoid duplicate liveQuery triggers
    const { default: GeroStore } = await import('@/stores/geroStore');
    await GeroStore.setLocale(value);
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
    return whitelisted.some(el => el.domain && matchesDappWhitelistEntry(origin, String(el.domain)));
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
      rewards: [],
      connectedDapps: [],
      bitcoinBalance: { available: BigInt(0), total: BigInt(0), locked: BigInt(0) }
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
      bitcoinBalance: { available: BigInt(0), total: BigInt(0), locked: BigInt(0) }
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
