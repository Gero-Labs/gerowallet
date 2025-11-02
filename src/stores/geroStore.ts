import Vue from 'vue';
import { debugLog } from '@/utils/debug';
import {
  deleteWallet,
  createNewWallet,
  createNewGoogleWallet,
  createNewHardwareWallet,
  getAllWallets,
  setWalletName as dbSetWalletName,
  setWalletIcon as dbSetWalletIcon,
  updatePrivateKeyAndMnemonic as dbUpdatePrivateKeyAndMnemonic
} from '@/db/gero-db';
import { ERROR, WalletType } from '@/models/types';
import { Buffer } from 'buffer';
import { Bip32PrivateKey } from '@cardano-sdk/crypto';
import { decrypt, encrypt } from '@/shared/utils/crypto';
import networks from '@/utils/networks';
import { encryptPrivateKey } from '@/shared/utils/crypto';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';

export interface GeroStore {
  wallets: any;
  network: any;
  config: any;
}

export const geroStore: GeroStore =  Vue.observable<GeroStore>({
  wallets: {},
  network: networks[0],
  config: {
    welcomeDone: true
  },
});

const STORE_NAME = 'geroStore';
const context = getContextType();

// Initialize messaging based on context
// IMPORTANT: Only browser context subscribes to background updates
// Background context directly updates local store via broadcastFromBackground()
if (context === 'browser') {
  debugLog(`🔌 Initializing gero store messaging in browser context`);
  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<GeroStore>) => {
    debugLog('📥 Received gero store update:', updates);

    // Apply updates to the observable state
    Object.keys(updates).forEach(key => {
      if (key in geroStore) {
        (geroStore as any)[key] = updates[key as keyof GeroStore];
      }
    });
  });

  // Initial hydration from chrome.storage (fallback for initial state)
  chrome.storage.local.get(STORE_NAME, (result) => {
    if (result[STORE_NAME]) {
      Object.assign(geroStore, result[STORE_NAME]);
      debugLog('💾 Hydrated gero store from storage');
    }
  });
}

/**
 * Broadcast updates from background context
 */
function broadcastFromBackground(updates: Partial<GeroStore>) {
  if (context === 'background') {
    // Serialize data for broadcasting
    const serializedUpdates = JSON.parse(JSON.stringify(updates, (key, value) => {
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
    }));

    // Broadcast to all connected browser contexts
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, serializedUpdates);

    // Also persist to storage as fallback
    chrome.storage.local.get(STORE_NAME, (result) => {
      const current = result[STORE_NAME] || {
        wallets: {},
        network: networks[0],
        config: {
          welcomeDone: true
        }
      };
      chrome.storage.local.set({
        [STORE_NAME]: { ...current, ...serializedUpdates }
      });
    });
  }
}

export default {
  setWallets(wallets: any) {
    geroStore.wallets = wallets;
    broadcastFromBackground({ wallets });
  },
  setConfig(config: any) {
    geroStore.config = config;
    broadcastFromBackground({ config });
  },
  setNetwork(network: any) {
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
  async createNewWallet(name: string, icon: string, theme: string, mnemonic: string, password: string, chain: string, network: string) {
    const walletId = await createNewWallet(name, icon, theme, mnemonic, password, chain, network);
    // Update the wallets field with the latest wallets from the database
    const updatedWallets = await getAllWallets();
    geroStore.wallets = updatedWallets;
    broadcastFromBackground({ wallets: updatedWallets });
    return geroStore.wallets[walletId];
  },
  async createNewGoogleWallet(name: string, icon: string, theme: string, password: string, chain: string, network: string, jwt: string) {
    const walletId = await createNewGoogleWallet(name, icon, theme, password, chain, network, jwt);
    // Update the wallets field with the latest wallets from the database
    const updatedWallets = await getAllWallets();
    geroStore.wallets = updatedWallets;
    broadcastFromBackground({ wallets: updatedWallets });
    return geroStore.wallets[walletId];
  },
  async createNewHardwareWallet(wallet: any) {
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
   * @param _lockType - Lock type (unused parameter for compatibility)
   */
  async updateSpendingPassword(walletId: number, currentPassword: string, newPassword: string, _lockType: string) {
    const wallet = geroStore.wallets[walletId];
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    if (wallet.type === WalletType.Normal) {
      try {
        // Decrypt current private key
        const decrypted = decrypt(wallet.encryptedPrivateKey, currentPassword);
        const buffer: Buffer = Buffer.from(JSON.parse(decrypted));
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
        welcomeDone: true
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
  getCurrentNetwork(): any {
    return geroStore.network;
  },

  // Utility method to get all wallets
  getAllWallets(): any {
    return geroStore.wallets;
  },

  // Utility method to get wallet by ID
  getWallet(walletId: number): any {
    return geroStore.wallets?.[walletId];
  },

  // Utility method to check if wallet exists
  hasWallet(walletId: number): boolean {
    return geroStore.wallets && walletId in geroStore.wallets;
  }
}
