import Vue from 'vue';
import {
  deleteWallet,
  createNewWallet,
  createNewHardwareWallet,
  getAllWallets,
  setWalletName as dbSetWalletName,
  setWalletIcon as dbSetWalletIcon,
  updatePrivateKeyAndMnemonic as dbUpdatePrivateKeyAndMnemonic
} from '@/db/gero-db';
import { ERROR, Wallet, WalletType } from '@/models/types';
import { Buffer } from 'buffer';
import { Bip32PrivateKey } from '@cardano-sdk/crypto';
import { decrypt, decryptWithPassword, encrypt } from '@/shared/utils/crypto';
import networks, { NetworkInfo } from '@/utils/networks';
import { encryptPrivateKey } from '@/shared/utils/crypto';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';

export interface GeroStore {
  wallets: Record<number, Wallet>;
  network: NetworkInfo;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- config is a dynamic settings bag: ~20 varied fields (hideBalances, currency, txAutoSubmit, spend caps, …) are read/written across the app; a strict type would break many consumers
  config: any;
}

export const geroStore: GeroStore =  Vue.observable<GeroStore>({
  wallets: {},
  network: networks[0],
  config: {
    welcomeDone: true,
    locale: 'us'  // Global locale preference (persists across login/logout)
  },
});

const STORE_NAME = 'geroStore';
const context = getContextType();

// Initialize messaging based on context
// IMPORTANT: Only browser context subscribes to background updates
// Background context directly updates local store via broadcastFromBackground()
if (context === 'browser') {
  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<GeroStore>) => {

    // Apply updates to the observable state
    Object.keys(updates).forEach(key => {
      if (key in geroStore) {
        geroStore[key] = updates[key as keyof GeroStore];
      }
    });
  });

  // Initial hydration from chrome.storage (fallback for initial state)
  chrome.storage.local.get(STORE_NAME, (result) => {
    if (result[STORE_NAME]) {
      Object.assign(geroStore, result[STORE_NAME]);
    }
  });
}

// Serializer function for complex data types (used with JSON.stringify replacer)
function serializeValue(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    return Array.from(value.entries()).reduce((obj, [k, v]) => {
      obj[String(k)] = v;
      return obj;
    }, {} as Record<string, unknown>);
  } else if (typeof value === 'bigint') {
    return value.toString();
  } else {
    return value;
  }
}

// Debounced storage write to reduce I/O operations during rapid updates
let storageWriteTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Broadcast updates from background context
 *
 * CRITICAL: Uses in-memory state (geroStore) as the base for Chrome storage writes
 * instead of reading from chrome.storage.local.get() to prevent race conditions.
 * The previous async read pattern caused locale to alternate between values
 * because the liveQuery and storage writes were racing.
 *
 * @param updates - Partial GeroStore updates to broadcast
 * @param immediate - If true, write to chrome.storage immediately (no debounce)
 */
function broadcastFromBackground(updates: Partial<GeroStore>, immediate = false) {
  if (context === 'background') {
    // Serialize data for broadcasting
    const serializedUpdates = JSON.parse(JSON.stringify(updates, serializeValue));

    // Broadcast to all connected browser contexts (immediate)
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, serializedUpdates);

    // For critical state changes (e.g., locale), write immediately to storage
    // so browser context gets correct state on hydration
    if (immediate || (updates.config && 'locale' in updates.config)) {
      if (storageWriteTimeout) {
        clearTimeout(storageWriteTimeout);
        storageWriteTimeout = null;
      }
      try {
        // CRITICAL: Use the current in-memory store state as the base to avoid race conditions
        // DO NOT use chrome.storage.local.get() - it causes race conditions with liveQuery
        const finalState = { ...geroStore };
        chrome.storage.local.set({
          [STORE_NAME]: JSON.parse(JSON.stringify(finalState, serializeValue))
        });
      } catch (error) {
        console.error('Failed to persist gero store to storage (immediate):', Object.keys(updates), error);
      }
    } else {
      // Debounced storage write to reduce I/O operations during rapid updates
      // This batches multiple updates together while maintaining data consistency
      if (storageWriteTimeout) {
        clearTimeout(storageWriteTimeout);
      }

      storageWriteTimeout = setTimeout(() => {
        try {
          // CRITICAL: Use the current in-memory store state as the base to avoid race conditions
          // DO NOT use chrome.storage.local.get() - it causes race conditions with liveQuery
          const finalState = { ...geroStore };
          chrome.storage.local.set({
            [STORE_NAME]: JSON.parse(JSON.stringify(finalState, serializeValue))
          });
        } catch (error) {
          console.error('Failed to persist gero store to storage:', Object.keys(updates), error);
        }
      }, 300); // 300ms debounce - balances performance with data safety
    }
  }
}

export default {
  setWallets(wallets: Record<number, Wallet>) {
    geroStore.wallets = wallets;
    broadcastFromBackground({ wallets });
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- config is the dynamic settings bag (see GeroStore.config)
  setConfig(config: any) {
    // CRITICAL: Trust the incoming locale from database if it exists
    // The database is the source of truth after setLocale() saves to it
    const currentLocale = geroStore.config?.locale;
    const incomingLocale = config.locale;

    // Determine final locale value
    let finalLocale: string;
    if (incomingLocale) {
      // Trust the database locale (it's the result of a recent setLocale call)
      finalLocale = incomingLocale;
    } else if (currentLocale) {
      // No incoming locale, preserve current in-memory value
      finalLocale = currentLocale;
    } else {
      // No locale anywhere, use default
      finalLocale = 'us';
    }

    // CRITICAL: Check if anything actually changed to prevent unnecessary reactive updates
    // This helps break potential circular loops from liveQuery -> setConfig -> broadcast -> liveQuery
    let hasChanges = false;

    // Check non-locale keys for changes
    Object.keys(config).forEach(key => {
      // openMiniGeroOnClick is stored under its own chrome.storage key (not in geroStore),
      // so skip it here to avoid accidental overwrite if it somehow ends up in a persisted config snapshot.
      if (key !== 'locale' && key !== 'openMiniGeroOnClick' && geroStore.config[key] !== config[key]) {
        geroStore.config[key] = config[key];
        hasChanges = true;
      }
    });

    // Check locale for changes
    if (geroStore.config.locale !== finalLocale) {
      geroStore.config.locale = finalLocale;
      hasChanges = true;

      // CRITICAL: Also update i18n.locale when locale changes
      // This ensures UI updates when database liveQuery loads locale on startup
      (async () => {
        const { updateI18nLocale } = await import('@/plugins/i18n');
        await updateI18nLocale(finalLocale);
      })();
    }

    // Only broadcast if something actually changed
    if (hasChanges) {
      broadcastFromBackground({ config: geroStore.config });
    }
  },
  async setLocale(locale: string) {
    // CRITICAL: Skip if locale hasn't actually changed to prevent loops
    if (geroStore.config.locale === locale) {
      return;
    }

    // Capture previous locale for error recovery
    const previousLocale = geroStore.config.locale;

    // Update in-memory state first
    geroStore.config.locale = locale;

    // CRITICAL: Use immediate flag for locale changes to prevent race conditions
    // This ensures browser context hydrates the correct state on initialization
    broadcastFromBackground({ config: geroStore.config }, true);

    // Update i18n.locale directly to ensure UI updates immediately
    const { updateI18nLocale } = await import('@/plugins/i18n');
    await updateI18nLocale(locale);

    // Save to gero-db to persist the change
    // The liveQuery will fire but setConfig() will detect no change and skip broadcasting
    try {
      const { setConfiguration } = await import('@/db/gero-db');
      await setConfiguration('locale', locale);
    } catch (error) {
      console.error('Failed to save locale to database:', error);

      // Error recovery: Revert in-memory state if database write fails
      // This ensures consistency between memory and persisted state
      geroStore.config.locale = previousLocale;
      broadcastFromBackground({ config: geroStore.config }, true);
      await updateI18nLocale(previousLocale);
    }
  },
  setNetwork(network: NetworkInfo) {
    geroStore.network = network;
    broadcastFromBackground({ network });
  },
  removeWallet(walletId: number) {
    if (geroStore.wallets && geroStore.wallets[walletId]) {
      delete geroStore.wallets[walletId];
      broadcastFromBackground({ wallets: geroStore.wallets });
      deleteWallet(walletId);
    }
  },
  async createNewWallet(
    name: string,
    icon: string,
    theme: string,
    mnemonic: string,
    password: string,
    chain: string,
    network: string,
    addressType?: string,
    options?: {
      usePrf?: boolean;
      credentialId?: string;
      passwordUnlockEnabled?: boolean;
      backupMnemonic?: boolean;
      prfOutput?: ArrayBuffer;
      walletId?: number;
      midnightAddresses?: { unshielded: string; shielded: string; dust: string };
    }
  ) {
    const walletId = await createNewWallet(name, icon, theme, mnemonic, password, chain, network, addressType, options);
    // Update the wallets field with the latest wallets from the database
    const updatedWallets: Record<number, Wallet> = await getAllWallets();
    geroStore.wallets = updatedWallets;
    broadcastFromBackground({ wallets: updatedWallets });
    return geroStore.wallets[walletId];
  },
  async createNewHardwareWallet(wallet: unknown) {
    const walletId = await createNewHardwareWallet(wallet);
    // Update the wallets field with the latest wallets from the database
    const updatedWallets = await getAllWallets();
    geroStore.wallets = updatedWallets;
    broadcastFromBackground({ wallets: updatedWallets });
    return geroStore.wallets[walletId];
  },

  /**
   * Refresh wallets from database
   * Used after operations that modify wallets outside the store (e.g., Google wallet activation)
   */
  async refreshWallets() {
    const updatedWallets = await getAllWallets();
    geroStore.wallets = updatedWallets;
    broadcastFromBackground({ wallets: updatedWallets });
  },

  /**
   * Set wallet name
   * @param walletId - The wallet ID
   * @param name - The new wallet name
   */
  async setWalletName(walletId: number, name: string) {
    // 1) Persist the change in Dexie
    await dbSetWalletName(walletId, name);
    // 2) immediately reload local state
    const updatedWallets = await getAllWallets();
    geroStore.wallets = updatedWallets;
    broadcastFromBackground({ wallets: updatedWallets });
  },

  /**
   * Set wallet icon
   * @param walletId - The wallet ID
   * @param icon - The new wallet icon
   */
  async setWalletIcon(walletId: number, icon: string) {
    // 1) Persist the change in Dexie
    await dbSetWalletIcon(walletId, icon);
    // 2) immediately reload local state
    const updatedWallets = await getAllWallets();
    geroStore.wallets = updatedWallets;
    broadcastFromBackground({ wallets: updatedWallets });
  },

  /**
   * Update spending password for a wallet
   * @param walletId - The wallet ID
   * @param currentPassword - Current password
   * @param newPassword - New password
   */
  async updateSpendingPassword(walletId: number, currentPassword: string, newPassword: string) {
    const wallet = geroStore.wallets[walletId];
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    if (wallet.type === WalletType.Normal) {
      try {
        // Decrypt current private key
        const decrypted = decrypt(wallet.encryptedPrivateKey, currentPassword);
        const buffer: Buffer = decryptWithPassword(currentPassword, JSON.parse(decrypted));
        const rootKey = Bip32PrivateKey.fromBytes(buffer);

        // Re-encrypt with new password
        const encryptedPrivateKey = encryptPrivateKey(rootKey, newPassword);

        // Handle mnemonic if it exists
        let encryptedMnemonic = null;
        if (wallet.encryptedMnemonic) {
          const decryptedMnemonic = decrypt(wallet.encryptedMnemonic, currentPassword);
          encryptedMnemonic = encrypt(decryptedMnemonic, newPassword);
        }

        // Update database
        await dbUpdatePrivateKeyAndMnemonic(walletId, encryptedPrivateKey, encryptedMnemonic);

        // Reload local state
        const updatedWallets = await getAllWallets();
        geroStore.wallets = updatedWallets;
        broadcastFromBackground({ wallets: updatedWallets });

      } catch (e) {
        console.error('❌ Failed to update spending password:', e);
        console.error('❌ Error details:', {
          walletId,
          walletType: wallet.type,
          hasEncryptedPrivateKey: !!wallet.encryptedPrivateKey,
          hasEncryptedMnemonic: !!wallet.encryptedMnemonic,
          errorMessage: e instanceof Error ? e.message : String(e)
        });
        throw ERROR.wrongPassword;
      }
    }
  },

  state: geroStore,

  // Utility method to get current state snapshot
  getSnapshot(): GeroStore {
    return { ...geroStore };
  },

  // Utility method to reset state
  reset() {
    const resetState: GeroStore = {
      wallets: {},
      network: networks[0],
      config: {
        welcomeDone: true,
        locale: geroStore.config?.locale || 'us'  // Preserve locale during reset
      }
    };

    Object.assign(geroStore, resetState);
    broadcastFromBackground(resetState);
  },

  // Utility method to check if user has completed welcome
  isWelcomeDone(): boolean {
    return geroStore.config?.welcomeDone || false;
  },

  // Utility method to get current network
  getCurrentNetwork(): NetworkInfo {
    return geroStore.network;
  },

  // Utility method to get all wallets
  getAllWallets(): Record<number, Wallet> {
    return geroStore.wallets;
  },

  // Utility method to get wallet by ID
  getWallet(walletId: number): Wallet {
    return geroStore.wallets?.[walletId];
  },

  // Utility method to check if wallet exists
  hasWallet(walletId: number): boolean {
    return geroStore.wallets && walletId in geroStore.wallets;
  },

  // Utility method to get current locale
  getLocale(): string {
    return geroStore.config?.locale || 'us';
  }
}
