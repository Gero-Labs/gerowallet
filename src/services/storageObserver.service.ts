/**
 * Centralized Chrome Storage Observer Service
 *
 * Provides a unified, debounced way to observe Chrome storage changes
 * across different contexts (background, frontend) while preventing
 * cascading update loops and redundant syncing.
 */
import { debugLog } from '@/utils/debug';

interface StorageChangeCallback {
  (changes: chrome.storage.StorageChange, key: string): void;
}

interface QueuedChange {
  key: string;
  change: chrome.storage.StorageChange;
  timestamp: number;
}

class StorageObserverService {
  private listeners = new Map<string, Set<StorageChangeCallback>>();
  private changeQueue = new Map<string, QueuedChange>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly DEBOUNCE_MS = 50; // Short debounce to batch rapid changes
  private readonly DUPLICATE_THRESHOLD_MS = 100; // Ignore duplicate changes within this window
  private lastProcessedValues = new Map<string, any>();
  private isProcessing = false;

  constructor() {
    this.setupStorageListener();
  }

  /**
   * Subscribe to changes for a specific storage key
   */
  subscribe(key: string, callback: StorageChangeCallback): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }

    this.listeners.get(key)!.add(callback);
    debugLog(`📝 StorageObserver: Subscribed to key '${key}', total listeners: ${this.listeners.get(key)!.size}`);

    // Return unsubscribe function
    return () => {
      const keyListeners = this.listeners.get(key);
      if (keyListeners) {
        keyListeners.delete(callback);
        if (keyListeners.size === 0) {
          this.listeners.delete(key);
          debugLog(`🗑️ StorageObserver: Removed all listeners for key '${key}'`);
        }
      }
    };
  }

  /**
   * Subscribe to multiple keys at once
   */
  subscribeMultiple(keys: string[], callback: StorageChangeCallback): () => void {
    const unsubscribeFunctions = keys.map(key => this.subscribe(key, callback));

    return () => {
      unsubscribeFunctions.forEach(unsub => unsub());
    };
  }

  private setupStorageListener(): void {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (this.isProcessing) {
        debugLog('⏸️ StorageObserver: Skipping changes while processing');
        return;
      }

      const relevantChanges = Object.entries(changes).filter(([key]) =>
        this.listeners.has(key)
      );

      if (relevantChanges.length === 0) return;

      debugLog('📨 StorageObserver: Received changes for keys:', relevantChanges.map(([key]) => key));

      // Queue changes with deduplication
      for (const [key, change] of relevantChanges) {
        if (this.isDuplicateChange(key, change)) {
          debugLog(`🔄 StorageObserver: Ignoring duplicate change for key '${key}'`);
          continue;
        }

        this.changeQueue.set(key, {
          key,
          change,
          timestamp: Date.now()
        });
      }

      this.scheduleProcessing();
    });
  }

  private isDuplicateChange(key: string, change: chrome.storage.StorageChange): boolean {
    const lastValue = this.lastProcessedValues.get(key);
    const newValue = change.newValue;

    // If we have a last processed value and it's the same as the new value, skip
    if (lastValue !== undefined && this.deepEqual(lastValue, newValue)) {
      return true;
    }

    // Check if we have a queued change for this key that's very recent
    const queuedChange = this.changeQueue.get(key);
    if (queuedChange &&
        Date.now() - queuedChange.timestamp < this.DUPLICATE_THRESHOLD_MS &&
        this.deepEqual(queuedChange.change.newValue, newValue)) {
      return true;
    }

    return false;
  }

  private scheduleProcessing(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.processQueuedChanges();
    }, this.DEBOUNCE_MS);
  }

  private async processQueuedChanges(): Promise<void> {
    if (this.changeQueue.size === 0) return;

    this.isProcessing = true;
    const changesToProcess = Array.from(this.changeQueue.values());
    this.changeQueue.clear();

    debugLog(`🚀 StorageObserver: Processing ${changesToProcess.length} queued changes`);

    try {
      for (const { key, change } of changesToProcess) {
        const keyListeners = this.listeners.get(key);
        if (!keyListeners || keyListeners.size === 0) continue;

        // Update last processed value
        this.lastProcessedValues.set(key, change.newValue);

        debugLog(`📤 StorageObserver: Notifying ${keyListeners.size} listeners for key '${key}'`);

        // Notify all listeners for this key
        for (const callback of keyListeners) {
          try {
            callback(change, key);
          } catch (error) {
            console.error(`❌ StorageObserver: Error in callback for key '${key}':`, error);
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return false;

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!keysB.includes(key)) return false;
      if (!this.deepEqual(a[key], b[key])) return false;
    }

    return true;
  }

  /**
   * Manually trigger a sync check for a specific key (useful for initial hydration)
   */
  async triggerSync(key: string): Promise<void> {
    try {
      const result = await chrome.storage.local.get(key);
      const value = result[key];

      if (value !== undefined) {
        const change: chrome.storage.StorageChange = {
          newValue: value,
          oldValue: this.lastProcessedValues.get(key)
        };

        const keyListeners = this.listeners.get(key);
        if (keyListeners && keyListeners.size > 0) {
          debugLog(`🔄 StorageObserver: Manual sync triggered for key '${key}'`);
          this.lastProcessedValues.set(key, value);

          for (const callback of keyListeners) {
            try {
              callback(change, key);
            } catch (error) {
              console.error(`❌ StorageObserver: Error in manual sync callback for key '${key}':`, error);
            }
          }
        }
      }
    } catch (error) {
      console.error(`❌ StorageObserver: Failed to trigger manual sync for key '${key}':`, error);
    }
  }

  /**
   * Clear all listeners and cleanup
   */
  destroy(): void {
    this.listeners.clear();
    this.changeQueue.clear();
    this.lastProcessedValues.clear();

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Get current stats for debugging
   */
  getStats(): {
    totalListeners: number;
    keysWithListeners: string[];
    queuedChanges: number;
  } {
    const totalListeners = Array.from(this.listeners.values())
      .reduce((sum, set) => sum + set.size, 0);

    return {
      totalListeners,
      keysWithListeners: Array.from(this.listeners.keys()),
      queuedChanges: this.changeQueue.size
    };
  }
}

// Export singleton instance
export const storageObserver = new StorageObserverService();
export default storageObserver;
