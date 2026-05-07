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
  updates: Record<string, unknown>;
  timestamp: number;
};

type StoreUpdateChunkMessage = {
  type: 'STORE_UPDATE_CHUNK';
  storeName: string;
  updateId: string;
  chunkIndex: number;
  totalChunks: number;
  data: string;
  timestamp: number;
};

type StoreSubscribeMessage = {
  type: 'STORE_SUBSCRIBE';
  storeName: string;
};

type Message = StoreUpdateMessage | StoreUpdateChunkMessage | StoreSubscribeMessage;

// Chrome runtime port has a 64 MiB per-message *byte* cap. We size against
// `string.length` (UTF-16 code units), so chunks may expand up to ~3 bytes per
// code unit when serialized to UTF-8 (CJK / non-ASCII metadata). Chunk at
// 8 MiB code units (≤ 24 MiB bytes worst case) and split anything above
// 16 MiB code units (≤ 48 MiB bytes worst case) — both safely under 64 MiB.
const CHUNK_SIZE_CODE_UNITS = 8 * 1024 * 1024;
const SIZE_THRESHOLD_CODE_UNITS = 16 * 1024 * 1024;

class BackgroundStoreMessaging {
  private connectedPorts = new Set<chrome.runtime.Port>();
  private storeSubscriptions = new Map<string, Set<chrome.runtime.Port>>();
  private updateSeq = 0;

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
  public broadcastUpdate(storeName: string, updates: Record<string, unknown>) {
    const timestamp = Date.now();
    const messages = this.buildMessages(storeName, updates, timestamp);

    const subscribedPorts = this.storeSubscriptions.get(storeName);
    const targets = new Set<chrome.runtime.Port>();
    if (subscribedPorts) subscribedPorts.forEach(p => targets.add(p));
    this.connectedPorts.forEach(p => targets.add(p));

    targets.forEach(port => {
      for (const msg of messages) {
        try {
          port.postMessage(msg);
        } catch (error) {
          console.error('Failed to send update to port:', error);
          subscribedPorts?.delete(port);
          this.connectedPorts.delete(port);
          break;
        }
      }
    });
  }

  /**
   * Build either a single STORE_UPDATE or a sequence of STORE_UPDATE_CHUNK
   * messages depending on serialized size.
   */
  private buildMessages(
    storeName: string,
    updates: Record<string, unknown>,
    timestamp: number,
  ): Message[] {
    let serialized: string;
    try {
      serialized = JSON.stringify(updates);
    } catch (error) {
      console.error('Failed to serialize store update:', error);
      return [];
    }

    if (serialized.length <= SIZE_THRESHOLD_CODE_UNITS) {
      return [{ type: 'STORE_UPDATE', storeName, updates, timestamp }];
    }

    const updateId = `${timestamp}-${++this.updateSeq}`;
    const totalChunks = Math.ceil(serialized.length / CHUNK_SIZE_CODE_UNITS);
    const chunks: StoreUpdateChunkMessage[] = [];
    for (let i = 0; i < totalChunks; i++) {
      chunks.push({
        type: 'STORE_UPDATE_CHUNK',
        storeName,
        updateId,
        chunkIndex: i,
        totalChunks,
        data: serialized.slice(i * CHUNK_SIZE_CODE_UNITS, (i + 1) * CHUNK_SIZE_CODE_UNITS),
        timestamp,
      });
    }
    debugLog(`📦 Chunking store update ${storeName} (${serialized.length} code units → ${totalChunks} chunks)`);
    return chunks;
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
