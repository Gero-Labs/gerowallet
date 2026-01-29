/**
 * Background Script Store Messaging Handler
 *
 * Manages store synchronization from the background script side
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

class BackgroundStoreMessaging {
  private connectedPorts = new Set<chrome.runtime.Port>();
  private storeSubscriptions = new Map<string, Set<chrome.runtime.Port>>();

  constructor() {
    this.initialize();
  }

  /**
   * Initialize the background messaging handler
   */
  private initialize() {
    const context = getContextType();

    // Only run in background context
    if (context !== 'background') {
      // This is expected when stores import this module - it safely no-ops in browser context
      debugLog('ℹ️ BackgroundStoreMessaging skipping init in', context, 'context (expected)');
      return;
    }

    // Listen for incoming connections
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name === 'store-sync') {
        this.handleNewConnection(port);
      }
    });

    debugLog('🎯 Background store messaging initialized in', context, 'context');
  }

  /**
   * Handle a new port connection
   */
  private handleNewConnection(port: chrome.runtime.Port) {
    // Add to connected ports
    this.connectedPorts.add(port);

    // Handle messages from this port
    port.onMessage.addListener((message: Message) => {
      this.handleMessage(message, port);
    });

    // Handle disconnection
    port.onDisconnect.addListener(() => {
      this.connectedPorts.delete(port);

      // Remove from all subscriptions
      this.storeSubscriptions.forEach((ports) => {
        ports.delete(port);
      });
    });
  }

  /**
   * Handle incoming messages from connected ports
   */
  private handleMessage(message: Message, port: chrome.runtime.Port) {
    switch (message.type) {
      case 'STORE_SUBSCRIBE':
        this.handleSubscription(message.storeName, port);
        break;
    }
  }

  /**
   * Handle store subscription request
   */
  private handleSubscription(storeName: string, port: chrome.runtime.Port) {
    if (!this.storeSubscriptions.has(storeName)) {
      this.storeSubscriptions.set(storeName, new Set());
    }
    this.storeSubscriptions.get(storeName)!.add(port);
  }

  /**
   * Broadcast store update to all subscribed ports
   */
  public broadcastUpdate(storeName: string, updates: Record<string, any>) {
    const message: StoreUpdateMessage = {
      type: 'STORE_UPDATE',
      storeName,
      updates,
      timestamp: Date.now()
    };

    // Send to all ports subscribed to this store
    const subscribedPorts = this.storeSubscriptions.get(storeName);
    if (subscribedPorts) {
      subscribedPorts.forEach(port => {
        try {
          port.postMessage(message);
        } catch (error) {
          console.error(`Failed to send update to port:`, error);
          // Remove disconnected port
          subscribedPorts.delete(port);
          this.connectedPorts.delete(port);
        }
      });
    }

    // Also send to all connected ports (for stores that don't require explicit subscription)
    this.connectedPorts.forEach(port => {
      try {
        port.postMessage(message);
      } catch (error) {
        console.error(`Failed to send update to port:`, error);
        // Remove disconnected port
        this.connectedPorts.delete(port);
      }
    });
  }

  /**
   * Get number of connected ports
   */
  public getConnectionCount(): number {
    return this.connectedPorts.size;
  }

  /**
   * Check if any ports are connected
   */
  public hasConnections(): boolean {
    return this.connectedPorts.size > 0;
  }
}

// Export singleton instance
export const backgroundStoreMessaging = new BackgroundStoreMessaging();
export default backgroundStoreMessaging;
