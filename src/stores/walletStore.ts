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
  /** Spendable lovelace. The provider reports a stake-level total; setAccount() subtracts
   *  the CIP-113 locked share before the value reaches any consumer. */
  controlled_amount: string;
  /** The provider's unadjusted stake-level total, carried so setAccount() stays idempotent.
   *  Derived in the store only — never written to the `account` table. */
  controlled_amount_total?: string;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wallet record carries chain-specific runtime fields (baseAddress, stakeAddress, …) beyond the DB Wallet shape; a strict type breaks many consumers
  loggedWallet: any;
  isLocked: boolean;
  isSyncing: boolean;
  account: Account | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mixed Cardano/Apex/BTC tx records with chain-specific shapes; consumers narrow per chain
  transactions: any[];
  utxos: Cardano.Utxo[] | IUnifiedUtxo[];  // Support both Cardano and Bitcoin UTXOs
  collateral: Cardano.Utxo | null;
  keys: Keys | null;
  tokens: {};
  collections: {};
  // CIP-113: display-only balances. NOT itself the spend/disclosure guard — that is
  // applyUtxos() keeping programmable UTxOs out of `utxos`, which is what input selection
  // and the CIP-30/WalletConnect getBalance handlers actually read.
  //
  // Kept apart from `tokens` because ~9 other consumers (SendSheet, SwapCard,
  // useCopilotFeed, useAgentDock, HomePage, MarketPage, popup TransactionCard,
  // useCnightDustRegistration, DAppOverlay) read `tokens` for balance and spend-adjacent
  // logic. Separate means they stay spendable-only by default; merged would mean each of
  // them has to remember to opt out, and a forgotten one counts locked tokens as
  // spendable. Fails toward a missing display row rather than an overstated balance.
  programmableTokens: {};
  /** Lovelace locked in CIP-113 UTxOs: owned but not Gero-spendable — kept out of `utxos`
   *  and adaBalance, yet priced and counted in portfolio totals (see useHoldingsValuation). */
  programmableLockedLovelace: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- config is a dynamic settings bag (~20 varied fields read/written across the app); see GeroStore.config
  config: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reward history entries come straight from the provider payload
  rewards?: any[];
  contacts?: Record<string, Contact>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DB dapp rows plus legacy bare-hostname entries; narrowed to WhitelistedEntry where matched
  connectedDapps?: any[];
  // Bitcoin-specific state
  bitcoinBalance?: IBalance;  // Bitcoin balance (available, total, locked)
}

/**
 * `controlled_amount` is reported per stake address, and CIP-113 UTxOs sit at the shared
 * programmable-logic-base script address carrying that same stake credential, so their
 * lovelace is part of the reported total. Consumers read the field as spendable ADA
 * (max-send, swap sizing, delegation), so the locked share comes off here, at the single
 * point the account enters the store, rather than at each of them.
 */
export function spendableControlledAmount(total: string | number | null | undefined): string {
  if (total == null) return '0';
  try {
    const remaining = BigInt(total) - BigInt(walletStore.programmableLockedLovelace || '0');
    return (remaining > 0n ? remaining : 0n).toString();
  } catch {
    return String(total);
  }
}

/**
 * True when this wallet holds lovelace locked in CIP-113 UTxOs.
 *
 * Exists so the empty-state gates don't each hand-roll a `BigInt()` parse: they run
 * inside render computeds, where a throw on a malformed stored value takes the whole
 * page down rather than mis-reporting one number.
 */
export function hasProgrammableLockedLovelace(): boolean {
  try {
    return BigInt(walletStore.programmableLockedLovelace || '0') > 0n;
  } catch {
    return false;
  }
}

/** Re-derive `controlled_amount` from the provider total, tolerating repeated application. */
function withSpendableControlledAmount(account: Account | null): Account | null {
  if (!account) return account;
  const total = account.controlled_amount_total ?? account.controlled_amount;
  if (total == null) return account;
  return { ...account, controlled_amount: spendableControlledAmount(total), controlled_amount_total: total };
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
  programmableTokens: {},
  programmableLockedLovelace: '0',
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
        (walletStore as unknown as Record<string, unknown>)[key] = updates[key as keyof WalletStore];
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
function serializeValue(key: string, value: unknown): unknown {
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

  setLoggedWallet(loggedWallet: WalletStore['loggedWallet']) {
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

  setAccount(account: Account | null) {
    const adjusted = withSpendableControlledAmount(account);
    walletStore.account = adjusted;
    broadcastFromBackground({ account: adjusted });
  },

  setTransactions(transactions: WalletStore['transactions']) {
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
        } else if (walletStore.collateral) {
          this.setCollateral(null)
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

  setCollateral(collateral: Cardano.Utxo | null) {
    walletStore.collateral = collateral;
    broadcastFromBackground({ collateral });
  },

  setKeys(keys: Keys | null) {
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

  // Kept out of `tokens` on purpose: the send pickers read `tokens`, so these can only
  // appear where a surface has explicitly opted in to showing locked holdings.
  setProgrammableTokens(programmableTokens: {}, programmableLockedLovelace = '0') {
    walletStore.programmableTokens = programmableTokens;
    walletStore.programmableLockedLovelace = programmableLockedLovelace;
    broadcastFromBackground({ programmableTokens, programmableLockedLovelace });
    // A SYNC push carries the account and the UTxOs together, so the account can land
    // before this partition is known. Re-derive it against the locked total just set.
    this.setAccount(walletStore.account);
  },

  setConfig(config: {}) {
    walletStore.config = config;
    broadcastFromBackground({ config });
  },

  setRewards(rewards: WalletStore['rewards']) {
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
    if (walletStore.config && this.hasBackup()) {
      return walletStore.config.backup
    }
    return true
  },

  setContacts(contacts: Record<string, Contact>) {
    walletStore.contacts = contacts;
    broadcastFromBackground({ contacts });
  },

  setBackup(value: boolean) {
    if (walletStore.config && walletStore.loggedWallet) {
      walletStore.config.backup = value;
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

  setConnectedDapps(connectedDapps: WalletStore['connectedDapps']) {
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
      programmableTokens: {},
      programmableLockedLovelace: '0',
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
      programmableTokens: {},
      programmableLockedLovelace: '0',
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
