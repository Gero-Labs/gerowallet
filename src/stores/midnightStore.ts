/**
 * Midnight Wallet Store
 *
 * State management for Midnight blockchain wallets.
 * Follows the same Vue Observable pattern as walletStore.ts
 *
 * Based on Midnight_Implementation_Guide.html Phase 3: State Management
 */

import Vue from 'vue';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';
import { debugLog } from '@/utils/debug';
import type {
  MidnightBalances,
  MidnightAddresses,
  MidnightTransaction,
  MidnightUTXO,
} from '@/utils/midnight-mock-data';

/**
 * Midnight wallet state interface
 */
export interface MidnightStore {
  // Wallet metadata
  isActive: boolean;
  lastSync: number | null;
  blockHeight: number;
  networkStatus: 'disconnected' | 'connecting' | 'connected' | 'error';

  // Five-balance system (Phase 3 specification)
  balances: MidnightBalances;

  // Three-address system
  addresses: MidnightAddresses;

  // Transaction history
  transactions: MidnightTransaction[];

  // UTXOs for DUST registration UI
  utxos: MidnightUTXO[];

  // DUST generation metadata
  dustGenerationRate: number; // Rate per day (e.g., 0.004 = 0.4% per day)

  // ZK proof progress tracking (Phase 7)
  provingOperations: Map<string, {
    operationId: string;
    stage: 'preparing' | 'proving' | 'finalizing';
    progress: number; // 0-100
    startTime: number;
  }>;
}

// Create observable state
export const midnightStore = Vue.observable<MidnightStore>({
  isActive: false,
  lastSync: null,
  blockHeight: 0,
  networkStatus: 'disconnected',

  balances: {
    nightShielded: BigInt(0),
    nightUnshielded: BigInt(0),
    nightRegistered: BigInt(0),
    dust: BigInt(0),
    dustGenerating: BigInt(0),
  },

  addresses: {
    dust: '',
    shielded: '',
    unshielded: '',
  },

  transactions: [],
  utxos: [],
  dustGenerationRate: 0.004, // 0.4% per day default

  provingOperations: new Map(),
});

const STORE_NAME = 'midnightStore';
const context = getContextType();

// Initialize messaging based on context
if (context === 'browser') {
  debugLog(`🔌 Initializing Midnight store messaging in browser context`);
  console.log('🔌 [MidnightStore Browser] Subscribing to store updates');

  // Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<MidnightStore>) => {
    console.log('📥 [MidnightStore Browser] Received update from background:', {
      hasBalances: !!updates.balances,
      hasTransactions: !!updates.transactions,
      transactionCount: updates.transactions?.length,
      isActive: updates.isActive,
    });

    // Apply updates to the observable state
    Object.keys(updates).forEach(key => {
      if (key in midnightStore) {
        // Handle special serialization for BigInt values
        if (key === 'balances' && updates.balances) {
          midnightStore.balances = {
            nightShielded: BigInt(updates.balances.nightShielded as any),
            nightUnshielded: BigInt(updates.balances.nightUnshielded as any),
            nightRegistered: BigInt(updates.balances.nightRegistered as any),
            dust: BigInt(updates.balances.dust as any),
            dustGenerating: BigInt(updates.balances.dustGenerating as any),
          };
          console.log('💰 [MidnightStore Browser] Balances updated:', {
            nightShielded: midnightStore.balances.nightShielded.toString(),
            nightUnshielded: midnightStore.balances.nightUnshielded.toString(),
          });
        } else if (key === 'utxos' && updates.utxos) {
          // Convert UTXO BigInt values
          midnightStore.utxos = updates.utxos.map((utxo: any) => ({
            ...utxo,
            value: BigInt(utxo.value),
            dustGenerated: BigInt(utxo.dustGenerated),
          }));
          console.log('📦 [MidnightStore Browser] UTXOs updated:', midnightStore.utxos.length);
        } else if (key === 'transactions' && updates.transactions) {
          // Convert transaction BigInt values
          midnightStore.transactions = updates.transactions.map((tx: any) => ({
            ...tx,
            amount: BigInt(tx.amount),
            fee: BigInt(tx.fee),
          }));
          console.log('📜 [MidnightStore Browser] Transactions updated:', midnightStore.transactions.length);
        } else {
          (midnightStore as any)[key] = updates[key as keyof MidnightStore];
        }
      }
    });

    console.log('✅ [MidnightStore Browser] Store state after update:', {
      isActive: midnightStore.isActive,
      transactionCount: midnightStore.transactions.length,
      balancesZero: midnightStore.balances.nightShielded === BigInt(0),
    });
  });

  // Initial hydration from chrome.storage
  chrome.storage.local.get(STORE_NAME, (result) => {
    console.log('💾 [MidnightStore Browser] Hydrating from storage, data exists:', !!result[STORE_NAME]);
    if (result[STORE_NAME]) {
      const stored = result[STORE_NAME];
      console.log('💾 [MidnightStore Browser] Storage data:', {
        isActive: stored.isActive,
        hasBalances: !!stored.balances,
        hasTransactions: !!stored.transactions,
        transactionCount: stored.transactions?.length,
      });

      // Handle BigInt deserialization
      if (stored.balances) {
        midnightStore.balances = {
          nightShielded: BigInt(stored.balances.nightShielded),
          nightUnshielded: BigInt(stored.balances.nightUnshielded),
          nightRegistered: BigInt(stored.balances.nightRegistered),
          dust: BigInt(stored.balances.dust),
          dustGenerating: BigInt(stored.balances.dustGenerating),
        };
        console.log('💰 [MidnightStore Browser] Hydrated balances:', {
          nightShielded: midnightStore.balances.nightShielded.toString(),
          nightUnshielded: midnightStore.balances.nightUnshielded.toString(),
        });
      }

      if (stored.utxos) {
        midnightStore.utxos = stored.utxos.map((utxo: any) => ({
          ...utxo,
          value: BigInt(utxo.value),
          dustGenerated: BigInt(utxo.dustGenerated),
        }));
        console.log('📦 [MidnightStore Browser] Hydrated UTXOs:', midnightStore.utxos.length);
      }

      if (stored.transactions) {
        midnightStore.transactions = stored.transactions.map((tx: any) => ({
          ...tx,
          amount: BigInt(tx.amount),
          fee: BigInt(tx.fee),
        }));
        console.log('📜 [MidnightStore Browser] Hydrated transactions:', midnightStore.transactions.length);
      }

      // Copy other properties
      midnightStore.isActive = stored.isActive ?? false;
      midnightStore.lastSync = stored.lastSync ?? null;
      midnightStore.blockHeight = stored.blockHeight ?? 0;
      midnightStore.networkStatus = stored.networkStatus ?? 'disconnected';
      midnightStore.addresses = stored.addresses ?? { dust: '', shielded: '', unshielded: '' };
      midnightStore.dustGenerationRate = stored.dustGenerationRate ?? 0.004;

      console.log('✅ [MidnightStore Browser] Hydration complete, store state:', {
        isActive: midnightStore.isActive,
        transactionCount: midnightStore.transactions.length,
        balancesZero: midnightStore.balances.nightShielded === BigInt(0),
      });
      debugLog('💾 Hydrated Midnight store from storage');
    } else {
      console.log('⚠️ [MidnightStore Browser] No stored data found');
    }
  });
}

// Debounced storage write
let storageWriteTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Serializer for BigInt and complex types
 */
function serializeValue(key: string, value: any): any {
  if (typeof value === 'bigint') {
    return value.toString();
  } else if (value instanceof Map) {
    return Array.from(value.entries());
  } else if (value instanceof Set) {
    return Array.from(value);
  }
  return value;
}

/**
 * Broadcast updates from background context
 */
function broadcastFromBackground(updates: Partial<MidnightStore>, immediate = false) {
  if (context === 'background') {
    // Serialize data for broadcasting (handle BigInt)
    const serializedUpdates = JSON.parse(JSON.stringify(updates, serializeValue));

    // Broadcast to all connected browser contexts
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, serializedUpdates);

    // For critical state changes (like initial mock data load), write immediately
    if (immediate || 'isActive' in updates) {
      if (storageWriteTimeout) {
        clearTimeout(storageWriteTimeout);
        storageWriteTimeout = null;
      }

      // Use current in-memory state as base (prevents race conditions)
      const currentState = midnightStore;
      const serializedState = JSON.parse(JSON.stringify(currentState, serializeValue));

      chrome.storage.local.set({
        [STORE_NAME]: serializedState
      });
      console.log('💾 [MidnightStore] Persisted immediately to storage');
      debugLog('💾 Midnight store persisted to storage (immediate)');
    } else {
      // Debounced storage write for non-critical updates
      if (storageWriteTimeout) {
        clearTimeout(storageWriteTimeout);
      }

      storageWriteTimeout = setTimeout(() => {
        // Use current in-memory state as base (prevents race conditions)
        const currentState = midnightStore;
        const serializedState = JSON.parse(JSON.stringify(currentState, serializeValue));

        chrome.storage.local.set({
          [STORE_NAME]: serializedState
        });

        debugLog('💾 Midnight store persisted to storage (debounced)');
      }, 300); // 300ms debounce
    }
  }
}

/**
 * Midnight Store Actions (called from background context)
 */
export const midnightActions = {
  /**
   * Initialize Midnight store with mock data
   */
  initializeMockData(mockData: {
    balances: MidnightBalances;
    addresses: MidnightAddresses;
    transactions: MidnightTransaction[];
    utxos: MidnightUTXO[];
    metadata: {
      lastSync: number;
      blockHeight: number;
      networkStatus: 'connected' | 'disconnected';
      dustGenerationRate: number;
    };
  }) {
    console.log('🌙 [MidnightStore] Initializing mock data in context:', context);
    console.log('🌙 [MidnightStore] Mock data summary:', {
      balances: {
        nightShielded: mockData.balances.nightShielded.toString(),
        nightUnshielded: mockData.balances.nightUnshielded.toString(),
        nightRegistered: mockData.balances.nightRegistered.toString(),
        dust: mockData.balances.dust.toString(),
        dustGenerating: mockData.balances.dustGenerating.toString(),
      },
      transactions: mockData.transactions.length,
      utxos: mockData.utxos.length,
    });

    Object.assign(midnightStore, {
      isActive: true,
      balances: mockData.balances,
      addresses: mockData.addresses,
      transactions: mockData.transactions,
      utxos: mockData.utxos,
      lastSync: mockData.metadata.lastSync,
      blockHeight: mockData.metadata.blockHeight,
      networkStatus: mockData.metadata.networkStatus,
      dustGenerationRate: mockData.metadata.dustGenerationRate,
    });

    console.log('🌙 [MidnightStore] In-memory store updated, balances:', {
      nightShielded: midnightStore.balances.nightShielded.toString(),
      nightUnshielded: midnightStore.balances.nightUnshielded.toString(),
    });

    // Use immediate=true to write to storage immediately (prevents race condition)
    broadcastFromBackground({
      isActive: true,
      balances: mockData.balances,
      addresses: mockData.addresses,
      transactions: mockData.transactions,
      utxos: mockData.utxos,
      lastSync: mockData.metadata.lastSync,
      blockHeight: mockData.metadata.blockHeight,
      networkStatus: mockData.metadata.networkStatus,
      dustGenerationRate: mockData.metadata.dustGenerationRate,
    }, true); // immediate=true

    console.log('✅ [MidnightStore] Mock data broadcast to browser contexts');
    debugLog('✅ Midnight store initialized with mock data');
  },

  /**
   * Clear Midnight store (on logout)
   */
  clear() {
    Object.assign(midnightStore, {
      isActive: false,
      lastSync: null,
      blockHeight: 0,
      networkStatus: 'disconnected',
      balances: {
        nightShielded: BigInt(0),
        nightUnshielded: BigInt(0),
        nightRegistered: BigInt(0),
        dust: BigInt(0),
        dustGenerating: BigInt(0),
      },
      addresses: {
        dust: '',
        shielded: '',
        unshielded: '',
      },
      transactions: [],
      utxos: [],
      dustGenerationRate: 0.004,
      provingOperations: new Map(),
    });

    broadcastFromBackground({
      isActive: false,
      lastSync: null,
      blockHeight: 0,
      networkStatus: 'disconnected',
    });

    debugLog('🧹 Midnight store cleared');
  },

  /**
   * Update balances
   */
  updateBalances(balances: Partial<MidnightBalances>) {
    Object.assign(midnightStore.balances, balances);
    broadcastFromBackground({ balances: midnightStore.balances });
  },

  /**
   * Add transaction
   */
  addTransaction(transaction: MidnightTransaction) {
    midnightStore.transactions.unshift(transaction);
    broadcastFromBackground({ transactions: midnightStore.transactions });
  },

  /**
   * Update UTXO registration status
   */
  updateUTXO(txHash: string, outputIndex: number, updates: Partial<MidnightUTXO>) {
    const utxo = midnightStore.utxos.find(
      u => u.txHash === txHash && u.outputIndex === outputIndex
    );

    if (utxo) {
      Object.assign(utxo, updates);
      broadcastFromBackground({ utxos: midnightStore.utxos });
    }
  },

  /**
   * Start proving operation tracking (Phase 7)
   */
  startProvingOperation(operationId: string) {
    midnightStore.provingOperations.set(operationId, {
      operationId,
      stage: 'preparing',
      progress: 0,
      startTime: Date.now(),
    });
    broadcastFromBackground({ provingOperations: midnightStore.provingOperations });
  },

  /**
   * Update proving operation progress
   */
  updateProvingProgress(operationId: string, stage: 'preparing' | 'proving' | 'finalizing', progress: number) {
    const operation = midnightStore.provingOperations.get(operationId);
    if (operation) {
      operation.stage = stage;
      operation.progress = progress;
      broadcastFromBackground({ provingOperations: midnightStore.provingOperations });
    }
  },

  /**
   * Complete proving operation
   */
  completeProvingOperation(operationId: string) {
    midnightStore.provingOperations.delete(operationId);
    broadcastFromBackground({ provingOperations: midnightStore.provingOperations });
  },
};

export default midnightStore;
