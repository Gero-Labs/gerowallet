/**
 * Store Messaging Service
 * 
 * Handles real-time store synchronization between background and browser contexts
 * using Chrome runtime port connections instead of chrome.storage
 */

import { getContextType } from '@/utils/storageSync';

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
  private connectionPromise: Promise<void> | null = null;

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
    
    // Only browser contexts need to connect to background
    if (context === 'browser') {
      console.debug(`🔌 StoreMessaging service initializing in browser context`);
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
      console.debug('📡 Already connected, skipping connection');
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      try {
        console.debug('📡 Establishing store messaging connection from', getContextType(), 'context...');
        
        // Create port with a specific name for store updates
        this.port = chrome.runtime.connect({ name: 'store-sync' });
        console.debug('📡 Port created:', this.port);
        
        // Handle incoming messages
        this.port.onMessage.addListener((message: Message) => {
          this.handleMessage(message);
        });
        
        // Handle disconnection
        this.port.onDisconnect.addListener(() => {
          console.debug('📡 Store messaging disconnected');
          this.port = null;
          
          // Attempt to reconnect with exponential backoff
          this.scheduleReconnect();
        });

        // Reset reconnect attempts on successful connection
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        
        console.debug('✅ Store messaging connected');
        
        // Re-subscribe to stores after successful connection
        if (this.subscribedStores.size > 0) {
          // Re-subscribe in next tick to avoid blocking
          setTimeout(() => {
            this.subscribedStores.forEach(storeName => {
              this.sendMessage({
                type: 'STORE_SUBSCRIBE',
                storeName
              });
            });
            console.debug(`📡 Re-subscribed to ${this.subscribedStores.size} stores`);
          }, 100);
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
    
    console.debug(`📡 Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
    
    setTimeout(() => {
      this.connect().catch(error => {
        console.error('❌ Reconnection failed:', error);
      });
    }, delay);
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
    setTimeout(() => {
      this.sendMessage({
        type: 'STORE_SUBSCRIBE',
        storeName
      });
    }, 0);

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
   * Send store update (background context)
   * NOTE: This method is deprecated - use backgroundStoreMessaging directly from background context
   */
  public broadcastUpdate(storeName: string, updates: Record<string, any>) {
    // This should not be used - stores should import backgroundStoreMessaging directly
    console.warn('broadcastUpdate called on storeMessaging service - this is deprecated');
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
}

// Export singleton instance
export const storeMessaging = new StoreMessagingService();
export default storeMessaging;