/**
 * Delegation Store
 *
 * Manages DUST fee delegation requests for Midnight blockchain.
 * Handles both incoming requests (received from other wallets) and outgoing requests (sent to other wallets).
 */

import Vue from 'vue';
import {
  DelegationRequest,
  DelegationRequestStatus,
  DelegationRequestType,
  DelegationRequestMessage,
} from '@/models/delegation-types';
import {
  addDelegationRequest,
  updateDelegationRequest,
  getDelegationRequest,
  getAllDelegationRequests,
  getActiveDelegationRequests,
  deleteDelegationRequest,
  expireOldDelegationRequests,
} from '@/db/wallet-db';
import { getContextType } from '@/utils/storageSync';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';
import storeMessaging from '@/services/storeMessaging.service';

const STORE_NAME = 'delegationStore';
const context = getContextType();

interface DelegationStore {
  // In-memory cache of active requests
  incomingRequests: DelegationRequest[];
  outgoingRequests: DelegationRequest[];

  // Notification count
  unreadCount: number;

  // Current wallet ID
  walletId: number | null;
}

// Create observable store
const delegationStore: DelegationStore = Vue.observable({
  incomingRequests: [],
  outgoingRequests: [],
  unreadCount: 0,
  walletId: null,
});

// Debounced storage write
let storageWriteTimeout: NodeJS.Timeout | null = null;

/**
 * Broadcast updates to all connected contexts
 */
function broadcastFromBackground(updates: Partial<DelegationStore>) {
  if (context === 'background') {
    Object.assign(delegationStore, updates);
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, updates);

    // Debounced storage write
    if (storageWriteTimeout) clearTimeout(storageWriteTimeout);
    storageWriteTimeout = setTimeout(() => {
      chrome.storage.local.set({ [STORE_NAME]: delegationStore });
    }, 300);
  }
}

/**
 * Initialize delegation store for a specific wallet
 */
async function initializeDelegationStore(walletId: number): Promise<void> {
  try {
    console.log(`📋 Initializing delegation store for wallet ${walletId}`);

    // Clear previous state
    delegationStore.walletId = walletId;
    delegationStore.incomingRequests = [];
    delegationStore.outgoingRequests = [];
    delegationStore.unreadCount = 0;

    // Expire old requests
    await expireOldDelegationRequests(walletId);

    // Load active requests from database
    const incoming = await getActiveDelegationRequests(walletId, DelegationRequestType.INCOMING);
    const outgoing = await getActiveDelegationRequests(walletId, DelegationRequestType.OUTGOING);

    // Count unread (pending incoming) requests
    const unreadCount = incoming.filter(
      req => req.status === DelegationRequestStatus.PENDING
    ).length;

    broadcastFromBackground({
      walletId,
      incomingRequests: incoming,
      outgoingRequests: outgoing,
      unreadCount,
    });

    console.log(
      `✅ Delegation store initialized: ${incoming.length} incoming, ${outgoing.length} outgoing, ${unreadCount} unread`
    );
  } catch (error) {
    console.error('❌ Failed to initialize delegation store:', error);
  }
}

/**
 * Add or update a delegation request
 */
async function addOrUpdateDelegationRequest(request: DelegationRequest): Promise<void> {
  try {
    if (!delegationStore.walletId) {
      console.warn('⚠️ Cannot add delegation request: wallet not initialized');
      return;
    }

    console.log(`📝 Adding/updating delegation request:`, request);

    // Save to database
    await addDelegationRequest(delegationStore.walletId, request);

    // Update in-memory cache
    const list =
      request.type === DelegationRequestType.INCOMING
        ? 'incomingRequests'
        : 'outgoingRequests';

    const existingIndex = delegationStore[list].findIndex(r => r.id === request.id);

    if (existingIndex >= 0) {
      // Update existing
      const updatedList = [...delegationStore[list]];
      updatedList[existingIndex] = request;
      broadcastFromBackground({ [list]: updatedList });
    } else {
      // Add new
      const updatedList = [...delegationStore[list], request];
      broadcastFromBackground({ [list]: updatedList });
    }

    // Update unread count (only for pending incoming requests)
    if (request.type === DelegationRequestType.INCOMING) {
      const unreadCount = delegationStore.incomingRequests.filter(
        req => req.status === DelegationRequestStatus.PENDING
      ).length;
      broadcastFromBackground({ unreadCount });
    }

    console.log(`✅ Delegation request ${request.id} added/updated successfully`);
  } catch (error) {
    console.error('❌ Failed to add/update delegation request:', error);
    throw error;
  }
}

/**
 * Update delegation request status
 */
async function updateDelegationRequestStatus(
  requestId: string,
  status: DelegationRequestStatus,
  additionalData?: Partial<DelegationRequest>
): Promise<void> {
  try {
    if (!delegationStore.walletId) {
      console.warn('⚠️ Cannot update delegation request: wallet not initialized');
      return;
    }

    console.log(`📝 Updating delegation request ${requestId} to status: ${status}`);

    const updates: Partial<DelegationRequest> = {
      status,
      respondedAt: Date.now(),
      ...additionalData,
    };

    // Update in database
    await updateDelegationRequest(delegationStore.walletId, requestId, updates);

    // Find and update in-memory cache
    const lists: ('incomingRequests' | 'outgoingRequests')[] = [
      'incomingRequests',
      'outgoingRequests',
    ];

    for (const list of lists) {
      const index = delegationStore[list].findIndex(r => r.id === requestId);
      if (index >= 0) {
        const updatedList = [...delegationStore[list]];
        updatedList[index] = { ...updatedList[index], ...updates };
        broadcastFromBackground({ [list]: updatedList });

        // Update unread count if incoming
        if (list === 'incomingRequests') {
          const unreadCount = updatedList.filter(
            req => req.status === DelegationRequestStatus.PENDING
          ).length;
          broadcastFromBackground({ unreadCount });
        }
        break;
      }
    }

    console.log(`✅ Delegation request ${requestId} updated to ${status}`);
  } catch (error) {
    console.error('❌ Failed to update delegation request status:', error);
    throw error;
  }
}

/**
 * Remove a delegation request
 */
async function removeDelegationRequest(requestId: string): Promise<void> {
  try {
    if (!delegationStore.walletId) {
      console.warn('⚠️ Cannot remove delegation request: wallet not initialized');
      return;
    }

    console.log(`🗑️ Removing delegation request: ${requestId}`);

    // Remove from database
    await deleteDelegationRequest(delegationStore.walletId, requestId);

    // Remove from in-memory cache
    const lists: ('incomingRequests' | 'outgoingRequests')[] = [
      'incomingRequests',
      'outgoingRequests',
    ];

    for (const list of lists) {
      const index = delegationStore[list].findIndex(r => r.id === requestId);
      if (index >= 0) {
        const updatedList = delegationStore[list].filter(r => r.id !== requestId);
        broadcastFromBackground({ [list]: updatedList });

        // Update unread count if incoming
        if (list === 'incomingRequests') {
          const unreadCount = updatedList.filter(
            req => req.status === DelegationRequestStatus.PENDING
          ).length;
          broadcastFromBackground({ unreadCount });
        }
        break;
      }
    }

    console.log(`✅ Delegation request ${requestId} removed successfully`);
  } catch (error) {
    console.error('❌ Failed to remove delegation request:', error);
    throw error;
  }
}

/**
 * Clear all delegation requests
 */
function clearDelegationStore(): void {
  console.log('🧹 Clearing delegation store');
  broadcastFromBackground({
    walletId: null,
    incomingRequests: [],
    outgoingRequests: [],
    unreadCount: 0,
  });
}

// Subscribe to store updates from background (browser context only)
if (context === 'browser') {
  // Initialize from chrome storage
  chrome.storage.local.get(STORE_NAME, result => {
    if (result[STORE_NAME]) {
      Object.assign(delegationStore, result[STORE_NAME]);
      console.log('📋 Delegation store hydrated from storage:', delegationStore);
    }
  });

  // Subscribe to background updates
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<DelegationStore>) => {
    console.log('📡 Delegation store update received:', updates);
    Object.assign(delegationStore, updates);
  });
}

export default delegationStore;

export {
  initializeDelegationStore,
  addOrUpdateDelegationRequest,
  updateDelegationRequestStatus,
  removeDelegationRequest,
  clearDelegationStore,
};
