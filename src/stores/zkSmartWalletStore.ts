import Vue from 'vue';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';
import { debugLog } from '@/utils/debug';

export interface ZkSmartWalletWalletData {
  email: string;
  userId: string;
  proofId?: string;
  isActivated: boolean;
  walletId?: number;
  activatedAt?: Date;
  createdAt: Date;
}

export interface ZkSmartWalletStore {
  // Map of email to wallet data (for quick lookup)
  wallets: Record<string, ZkSmartWalletWalletData>;
}

// Create observable state
export const zkSmartWalletStore = Vue.observable<ZkSmartWalletStore>({
  wallets: {}
});

const STORE_NAME = 'zkSmartWalletStore';
const context = getContextType();

// Initialize messaging based on context
if (context === 'browser') {

  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<ZkSmartWalletStore>) => {
    Object.assign(zkSmartWalletStore, updates);
  });

  // Initial hydration from chrome.storage
  chrome.storage.local.get(STORE_NAME, (result) => {
    if (result[STORE_NAME]) {
      // Reconstruct Date objects
      const stored = result[STORE_NAME];
      if (stored.wallets) {
        Object.keys(stored.wallets).forEach(key => {
          if (stored.wallets[key].createdAt) {
            stored.wallets[key].createdAt = new Date(stored.wallets[key].createdAt);
          }
          if (stored.wallets[key].activatedAt) {
            stored.wallets[key].activatedAt = new Date(stored.wallets[key].activatedAt);
          }
        });
      }
      Object.assign(zkSmartWalletStore, stored);
      debugLog('💾 Hydrated zkSmartWallet store from storage');
    }
  });
}

// Debounced storage write to reduce I/O operations
let storageWriteTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Broadcast updates from background context
 * Per CLAUDE.md: Use debounced writes for non-critical updates (300ms delay),
 * immediate writes only for critical state changes (activation, clear)
 */
function broadcastFromBackground(updates: Partial<ZkSmartWalletStore>, immediate = false) {
  if (context === 'background') {
    // Apply updates to local store
    Object.assign(zkSmartWalletStore, updates);

    // Broadcast to all connected browser contexts (immediate)
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, updates);

    // For critical state changes (activation, clear), write immediately to storage
    // so browser context gets correct state on hydration
    if (immediate) {
      if (storageWriteTimeout) {
        clearTimeout(storageWriteTimeout);
        storageWriteTimeout = null;
      }
      chrome.storage.local.set({ [STORE_NAME]: zkSmartWalletStore });
      debugLog('💾 zkSmartWallet store persisted immediately');
    } else {
      // Debounced storage write for other updates to reduce I/O
      if (storageWriteTimeout) {
        clearTimeout(storageWriteTimeout);
      }

      storageWriteTimeout = setTimeout(() => {
        chrome.storage.local.set({ [STORE_NAME]: zkSmartWalletStore });
        debugLog('💾 zkSmartWallet store persisted (debounced)');
      }, 300); // 300ms debounce
    }
  }
}

const ZkSmartWalletStoreModule = {
  /**
   * Get wallet data by email
   */
  getWalletByEmail(email: string): ZkSmartWalletWalletData | undefined {
    return zkSmartWalletStore.wallets[email];
  },

  /**
   * Get wallet data by userId
   */
  getWalletByUserId(userId: string): ZkSmartWalletWalletData | undefined {
    return Object.values(zkSmartWalletStore.wallets).find(w => w.userId === userId);
  },

  /**
   * Store or update wallet data
   */
  setWalletData(data: ZkSmartWalletWalletData) {
    const key = data.email;
    zkSmartWalletStore.wallets[key] = {
      ...zkSmartWalletStore.wallets[key],
      ...data
    };

    broadcastFromBackground({ wallets: zkSmartWalletStore.wallets });
    debugLog('✅ Stored zkSmartWallet wallet data for:', key);
  },

  /**
   * Update proofId for a wallet
   */
  setProofId(email: string, proofId: string) {
    if (!zkSmartWalletStore.wallets[email]) {
      console.warn('Cannot set proofId: wallet not found in store for email:', email);
      return;
    }

    zkSmartWalletStore.wallets[email].proofId = proofId;
    broadcastFromBackground({ wallets: zkSmartWalletStore.wallets });
    debugLog('✅ Updated proofId in store for:', email);
  },

  /**
   * Mark wallet as activated
   */
  markAsActivated(email: string, walletId?: number) {
    if (!zkSmartWalletStore.wallets[email]) {
      console.warn('Cannot mark as activated: wallet not found in store for email:', email);
      return;
    }

    zkSmartWalletStore.wallets[email].isActivated = true;
    zkSmartWalletStore.wallets[email].activatedAt = new Date();
    if (walletId !== undefined) {
      zkSmartWalletStore.wallets[email].walletId = walletId;
    }

    broadcastFromBackground({ wallets: zkSmartWalletStore.wallets }, true); // Critical: activation state
    debugLog('✅ Marked wallet as activated in store:', email);
  },

  /**
   * Check if wallet is activated
   */
  isWalletActivated(email: string): boolean {
    return zkSmartWalletStore.wallets[email]?.isActivated || false;
  },

  /**
   * Remove wallet data
   */
  removeWallet(email: string) {
    delete zkSmartWalletStore.wallets[email];
    broadcastFromBackground({ wallets: zkSmartWalletStore.wallets });
    debugLog('✅ Removed zkSmartWallet wallet data from store for:', email);
  },

  /**
   * Load wallet data from database into store
   */
  async loadFromDatabase() {
    if (context !== 'background') {
      console.warn('loadFromDatabase should only be called from background context');
      return;
    }

    try {
      const { getAllZkSmartWalletWallets } = await import('@/db/zk-smart-wallet-db');
      const wallets = await getAllZkSmartWalletWallets();

      // Convert array to map
      const walletsMap: Record<string, ZkSmartWalletWalletData> = {};
      wallets.forEach(wallet => {
        walletsMap[wallet.email] = {
          email: wallet.email,
          userId: wallet.userId,
          proofId: wallet.proofId,
          isActivated: wallet.isActivated,
          walletId: wallet.walletId,
          activatedAt: wallet.activatedAt,
          createdAt: wallet.createdAt
        };
      });

      zkSmartWalletStore.wallets = walletsMap;
      broadcastFromBackground({ wallets: walletsMap });
      debugLog('✅ Loaded zkSmartWallet wallets from database:', Object.keys(walletsMap).length);
    } catch (error) {
      console.error('Failed to load zkSmartWallet wallets from database:', error);
    }
  },

  /**
   * Clear all wallet data
   */
  async clear() {
    zkSmartWalletStore.wallets = {};
    broadcastFromBackground({ wallets: {} }, true); // Critical: clear operation

    if (chrome?.storage?.local) {
      try {
        await chrome.storage.local.remove(STORE_NAME);
        debugLog('✅ Cleared zkSmartWallet store from Chrome storage');
      } catch (error) {
        console.error('Failed to clear zkSmartWallet store from Chrome storage:', error);
      }
    }
  },

  // Expose the observable state
  state: zkSmartWalletStore,

  /**
   * Get all wallet data
   */
  getAllWallets(): ZkSmartWalletWalletData[] {
    return Object.values(zkSmartWalletStore.wallets);
  },

  /**
   * Check if wallet exists by email
   */
  hasWallet(email: string): boolean {
    return !!zkSmartWalletStore.wallets[email];
  }
};

export default ZkSmartWalletStoreModule;
