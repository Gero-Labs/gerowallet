/**
 * Store Messaging Service
 *
 * Handles real-time store synchronization between background and browser contexts
 * using Chrome runtime port connections instead of chrome.storage
 */

import { getContextType } from '@/utils/storageSync';
import { debugLog } from '@/utils/debug';

type StoreUpdateMessage = {
  type: 'STORE_UPDATE';
  storeName: string;
  updates: Record<string, any>;
  timestamp: number;
};

type StoreSubscribeMessage = {
  type: 'STORE_SUBSCRIBE';
  storeName: string;
};

type Message = StoreUpdateMessage | StoreSubscribeMessage;

type StoreSubscriber = (updates: Record<string, any>) => void;

class StoreMessagingService {
  private port: chrome.runtime.Port | null = null;
  private subscribers = new Map<string, Set<StoreSubscriber>>();
  private subscribedStores = new Set<string>(); // Track which stores we're subscribed to
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second
  private reconnectTimeouts = new Set<NodeJS.Timeout>(); // Track reconnect timeouts

  constructor() {
    // Auto-initialize on construction - don't await to avoid blocking
    this.initialize().catch(error => {
      console.error('Failed to initialize store messaging:', error);
    });
  }

  /**
   * Initialize the messaging connection
   */
  private async initialize() {
    const context = getContextType();

    // Skip initialization for PassKey authentication popup (minimal context)
    // PassKey popup doesn't need store sync - it just authenticates and closes
    if (typeof window !== 'undefined' && window.location.hash.includes('/passkey-auth')) {
      debugLog(`⏭️ Skipping StoreMessaging initialization for PassKey auth popup`);
      return;
    }

    // Only browser contexts need to connect to background
    if (context === 'browser') {
      // Don't block on connection - let it happen in background
      this.connect().catch(error => {
        console.error('Failed to connect store messaging:', error);
      });
    }
  }

  /**
   * Establish connection to background script
   */
  private async connect(): Promise<void> {
    // If already connected, return immediately
    if (this.port?.name) {
      debugLog('📡 Already connected, skipping connection');
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      try {

        // Create port with a specific name for store updates
        this.port = chrome.runtime.connect({ name: 'store-sync' });

        // Handle incoming messages
        this.port.onMessage.addListener((message: Message) => {
          this.handleMessage(message);
        });

        // Handle disconnection
        this.port.onDisconnect.addListener(() => {
          debugLog('📡 Store messaging disconnected');
          this.port = null;

          // Attempt to reconnect with exponential backoff
          this.scheduleReconnect();
        });

        // Reset reconnect attempts on successful connection
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;

        // Re-subscribe to stores after successful connection
        if (this.subscribedStores.size > 0) {
          // Re-subscribe in next tick to avoid blocking
          const resubscribeTimeoutId = setTimeout(() => {
            this.reconnectTimeouts.delete(resubscribeTimeoutId);
            this.subscribedStores.forEach(storeName => {
              this.sendMessage({
                type: 'STORE_SUBSCRIBE',
                storeName
              });
            });
            debugLog(`📡 Re-subscribed to ${this.subscribedStores.size} stores`);
          }, 100);
          this.reconnectTimeouts.add(resubscribeTimeoutId);
        }

        resolve();
      } catch (error) {
        console.error('❌ Failed to connect store messaging:', error);
        // Don't reject, just resolve to avoid blocking
        resolve();
      }
    });
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts reached for store messaging');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000); // Max 30 seconds

    debugLog(`📡 Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

    const timeoutId = setTimeout(() => {
      this.reconnectTimeouts.delete(timeoutId);
      this.connect().catch(error => {
        console.error('❌ Reconnection failed:', error);
      });
    }, delay);
    this.reconnectTimeouts.add(timeoutId);
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(message: Message) {
    switch (message.type) {
      case 'STORE_UPDATE':
        this.notifySubscribers(message.storeName, message.updates);
        break;
    }
  }


  /**
   * Notify all subscribers of a store update
   */
  private notifySubscribers(storeName: string, updates: Record<string, any>) {
    const storeSubscribers = this.subscribers.get(storeName);
    if (storeSubscribers) {
      storeSubscribers.forEach(callback => {
        try {
          callback(updates);
        } catch (error) {
          console.error(`Error in store subscriber for ${storeName}:`, error);
        }
      });
    }
  }

  /**
   * Subscribe to store updates (browser context)
   */
  public subscribe(storeName: string, callback: StoreSubscriber): () => void {
    // Add to local subscribers
    if (!this.subscribers.has(storeName)) {
      this.subscribers.set(storeName, new Set());
    }
    this.subscribers.get(storeName)!.add(callback);

    // Track subscribed stores for reconnection
    this.subscribedStores.add(storeName);

    // Notify background that we're interested in this store (non-blocking)
    const subscribeTimeoutId = setTimeout(() => {
      this.reconnectTimeouts.delete(subscribeTimeoutId);
      this.sendMessage({
        type: 'STORE_SUBSCRIBE',
        storeName
      });
    }, 0);
    this.reconnectTimeouts.add(subscribeTimeoutId);

    // Return unsubscribe function
    return () => {
      const storeSubscribers = this.subscribers.get(storeName);
      if (storeSubscribers) {
        storeSubscribers.delete(callback);
        if (storeSubscribers.size === 0) {
          this.subscribers.delete(storeName);
          this.subscribedStores.delete(storeName);
        }
      }
    };
  }

  /**
   * Send message through port
   */
  private sendMessage(message: Message) {
    if (this.port) {
      try {
        this.port.postMessage(message);
      } catch (error) {
        console.error('Failed to send message through port:', error);
        // Attempt to reconnect
        this.port = null;
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Manually trigger reconnection (useful for error recovery)
   */
  public reconnect() {
    this.port?.disconnect();
    this.port = null;
    this.reconnectAttempts = 0;
    return this.connect();
  }

  /**
   * Clean up all connections and timeouts to prevent memory leaks
   */
  public destroy(): void {
    debugLog('🧹 Destroying store messaging service');

    // Clear all reconnect timeouts
    this.reconnectTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
    this.reconnectTimeouts.clear();

    // Disconnect port if connected
    if (this.port) {
      try {
        this.port.disconnect();
      } catch (error) {
        console.warn('Error disconnecting port:', error);
      }
      this.port = null;
    }

    // Clear all subscribers
    this.subscribers.clear();
    this.subscribedStores.clear();

    // Reset connection state
    this.reconnectAttempts = 0;
  }
}

// Export singleton instance
export const storeMessaging = new StoreMessagingService();
export default storeMessaging;
