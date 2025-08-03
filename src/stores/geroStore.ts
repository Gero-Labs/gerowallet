import Vue from 'vue';
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
import { encryptPrivateKey } from '@/chrome/serialization';
import { createStorageSync, smartPersist, hydrateStore } from '@/utils/storageSync';

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

// Initialize store with centralized storage sync
const SYNC_KEYS = ['wallets', 'network', 'config'];

// Hydrate from storage on initialization
hydrateStore('geroStore', geroStore);

// Set up centralized storage sync
const unsubscribe = createStorageSync(geroStore, {
  storeName: 'geroStore',
  syncKeys: SYNC_KEYS,
  debugPrefix: '🔄 GeroStore'
});

// Clean up on unload (for contexts that support it)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', unsubscribe);
}

async function persist(patch: Partial<GeroStore>): Promise<void> {
  const next = { ...geroStore, ...patch };
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
  await smartPersist('geroStore', JSON.parse(nextString));
}

export default {
  setWallets(wallets: any) {
    geroStore.wallets = wallets;
    persist({ wallets: wallets });
  },
  setConfig(config: any) {
    geroStore.config = config;
    persist({ config: config });
  },
  setNetwork(network: any) {
    geroStore.network = network;
    persist({ network: network });
  },
  removeWallet(walletId: number) {
    if (geroStore.wallets && geroStore.wallets[walletId]) {
      delete geroStore.wallets[walletId];
      persist({ wallets: geroStore.wallets });
      deleteWallet(walletId);
    }
  },
  async createNewWallet(name: string, icon: string, theme: string, mnemonic: string, password: string, chain: string, network: string) {
    const walletId = await createNewWallet(name, icon, theme, mnemonic, password, chain, network);
    // Update the wallets field with the latest wallets from the database
    const updatedWallets = await getAllWallets();
    geroStore.wallets = updatedWallets;
    persist({ wallets: updatedWallets });
    return geroStore.wallets[walletId];
  },
  async createNewGoogleWallet(name: string, icon: string, theme: string, password: string, chain: string, network: string, jwt: string) {
    const walletId = await createNewGoogleWallet(name, icon, theme, password, chain, network, jwt);
    // Update the wallets field with the latest wallets from the database
    const updatedWallets = await getAllWallets();
    geroStore.wallets = updatedWallets;
    persist({ wallets: updatedWallets });
    return geroStore.wallets[walletId];
  },
  async createNewHardwareWallet(wallet: any) {
    const walletId = await createNewHardwareWallet(wallet);
    // Update the wallets field with the latest wallets from the database
    const updatedWallets = await getAllWallets();
    geroStore.wallets = updatedWallets;
    persist({ wallets: updatedWallets });
    return geroStore.wallets[walletId];
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
    persist({ wallets: updatedWallets });
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
    persist({ wallets: updatedWallets });
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
        persist({ wallets: updatedWallets });

      } catch (e) {
        throw ERROR.wrongPassword;
      }
    }
  },

  state: geroStore
}
