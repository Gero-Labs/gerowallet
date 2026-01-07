import Vue from 'vue';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';
import { debugLog } from '@/utils/debug';

export interface ZkFoldWalletData {
  email: string;
  userId: string;
  proofId?: string;
  isActivated: boolean;
  walletId?: number;
  activatedAt?: Date;
  createdAt: Date;
}

export interface ZkFoldStore {
  // Map of email to wallet data (for quick lookup)
  wallets: Record<string, ZkFoldWalletData>;
}

// Create observable state
export const zkFoldStore = Vue.observable<ZkFoldStore>({
  wallets: {}
});

const STORE_NAME = 'zkFoldStore';
const context = getContextType();

// Initialize messaging based on context
if (context === 'browser') {

  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<ZkFoldStore>) => {
    Object.assign(zkFoldStore, updates);
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
      Object.assign(zkFoldStore, stored);
      debugLog('💾 Hydrated zkFold store from storage');
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
function broadcastFromBackground(updates: Partial<ZkFoldStore>, immediate = false) {
  if (context === 'background') {
    // Apply updates to local store
    Object.assign(zkFoldStore, updates);

    // Broadcast to all connected browser contexts (immediate)
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, updates);

    // For critical state changes (activation, clear), write immediately to storage
    // so browser context gets correct state on hydration
    if (immediate) {
      if (storageWriteTimeout) {
        clearTimeout(storageWriteTimeout);
        storageWriteTimeout = null;
      }
      chrome.storage.local.set({ [STORE_NAME]: zkFoldStore });
      debugLog('💾 zkFold store persisted immediately');
    } else {
      // Debounced storage write for other updates to reduce I/O
      if (storageWriteTimeout) {
        clearTimeout(storageWriteTimeout);
      }

      storageWriteTimeout = setTimeout(() => {
        chrome.storage.local.set({ [STORE_NAME]: zkFoldStore });
        debugLog('💾 zkFold store persisted (debounced)');
      }, 300); // 300ms debounce
    }
  }
}

const ZkFoldStoreModule = {
  /**
   * Get wallet data by email
   */
  getWalletByEmail(email: string): ZkFoldWalletData | undefined {
    return zkFoldStore.wallets[email];
  },

  /**
   * Get wallet data by userId
   */
  getWalletByUserId(userId: string): ZkFoldWalletData | undefined {
    return Object.values(zkFoldStore.wallets).find(w => w.userId === userId);
  },

  /**
   * Store or update wallet data
   */
  setWalletData(data: ZkFoldWalletData) {
    const key = data.email;
    zkFoldStore.wallets[key] = {
      ...zkFoldStore.wallets[key],
      ...data
    };

    broadcastFromBackground({ wallets: zkFoldStore.wallets });
    debugLog('✅ Stored zkFold wallet data for:', key);
  },

  /**
   * Update proofId for a wallet
   */
  setProofId(email: string, proofId: string) {
    if (!zkFoldStore.wallets[email]) {
      console.warn('Cannot set proofId: wallet not found in store for email:', email);
      return;
    }

    zkFoldStore.wallets[email].proofId = proofId;
    broadcastFromBackground({ wallets: zkFoldStore.wallets });
    debugLog('✅ Updated proofId in store for:', email);
  },

  /**
   * Mark wallet as activated
   */
  markAsActivated(email: string, walletId?: number) {
    if (!zkFoldStore.wallets[email]) {
      console.warn('Cannot mark as activated: wallet not found in store for email:', email);
      return;
    }

    zkFoldStore.wallets[email].isActivated = true;
    zkFoldStore.wallets[email].activatedAt = new Date();
    if (walletId !== undefined) {
      zkFoldStore.wallets[email].walletId = walletId;
    }

    broadcastFromBackground({ wallets: zkFoldStore.wallets }, true); // Critical: activation state
    debugLog('✅ Marked wallet as activated in store:', email);
  },

  /**
   * Check if wallet is activated
   */
  isWalletActivated(email: string): boolean {
    return zkFoldStore.wallets[email]?.isActivated || false;
  },

  /**
   * Remove wallet data
   */
  removeWallet(email: string) {
    delete zkFoldStore.wallets[email];
    broadcastFromBackground({ wallets: zkFoldStore.wallets });
    debugLog('✅ Removed zkFold wallet data from store for:', email);
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
      const { getAllZkFoldWallets } = await import('@/db/zkfold-db');
      const wallets = await getAllZkFoldWallets();

      // Convert array to map
      const walletsMap: Record<string, ZkFoldWalletData> = {};
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

      zkFoldStore.wallets = walletsMap;
      broadcastFromBackground({ wallets: walletsMap });
      debugLog('✅ Loaded zkFold wallets from database:', Object.keys(walletsMap).length);
    } catch (error) {
      console.error('Failed to load zkFold wallets from database:', error);
    }
  },

  /**
   * Clear all wallet data
   */
  async clear() {
    zkFoldStore.wallets = {};
    broadcastFromBackground({ wallets: {} }, true); // Critical: clear operation

    if (chrome?.storage?.local) {
      try {
        await chrome.storage.local.remove(STORE_NAME);
        debugLog('✅ Cleared zkFold store from Chrome storage');
      } catch (error) {
        console.error('Failed to clear zkFold store from Chrome storage:', error);
      }
    }
  },

  // Expose the observable state
  state: zkFoldStore,

  /**
   * Get all wallet data
   */
  getAllWallets(): ZkFoldWalletData[] {
    return Object.values(zkFoldStore.wallets);
  },

  /**
   * Check if wallet exists by email
   */
  hasWallet(email: string): boolean {
    return !!zkFoldStore.wallets[email];
  }
};

export default ZkFoldStoreModule;
