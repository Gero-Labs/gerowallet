/**
 * Storage Sync Utilities
 *
 * Helper functions to integrate stores with the centralized storage observer
 */

import storageObserver from '@/services/storageObserver.service';

interface StoreSyncOptions {
  storeName: string;
  syncKeys?: string[]; // Specific keys to sync, or all if not provided
  onSync?: (newValue: any, key: string) => void;
  debugPrefix?: string;
}

/**
 * Create a storage sync handler for a store
 */
export function createStorageSync<T extends Record<string, any>>(
  store: T,
  options: StoreSyncOptions
) {
  const { storeName, syncKeys, onSync, debugPrefix = '🔄' } = options;

  // Subscribe to the main store key
  const unsubscribeMain = storageObserver.subscribe(storeName, (change, key) => {
    const newValue = change.newValue;
    if (!newValue) return;

    // Only log if there are actual sync conflicts or errors

    // If specific sync keys are defined, only sync those
    if (syncKeys) {
      let hasChanges = false;
      for (const syncKey of syncKeys) {
        if (newValue[syncKey] !== undefined && store[syncKey] !== newValue[syncKey]) {
          (store as any)[syncKey] = newValue[syncKey];
          hasChanges = true;
        }
      }
      if (hasChanges && onSync) {
        onSync(newValue, key);
      }
    } else {
      // Sync all properties
      let hasChanges = false;
      for (const [prop, value] of Object.entries(newValue)) {
        if (store[prop] !== value) {
          (store as any)[prop] = value;
          hasChanges = true;
        }
      }
      if (hasChanges && onSync) {
        onSync(newValue, key);
      }
    }
  });

  // Subscribe to individual sync keys if specified
  const unsubscribeKeys: (() => void)[] = [];
  if (syncKeys) {
    for (const syncKey of syncKeys) {
      const unsub = storageObserver.subscribe(syncKey, (change, key) => {
        const newValue = change.newValue;
        if (newValue !== undefined && store[syncKey] !== newValue) {
          (store as any)[syncKey] = newValue;
          if (onSync) {
            onSync({ [syncKey]: newValue }, key);
          }
        }
      });
      unsubscribeKeys.push(unsub);
    }
  }

  // Return cleanup function
  return () => {
    unsubscribeMain();
    unsubscribeKeys.forEach(unsub => unsub());
  };
}

/**
 * Debounced storage writer to prevent excessive writes
 */
class DebouncedStorageWriter {
  private writeTimers = new Map<string, NodeJS.Timeout>();
  private pendingWrites = new Map<string, any>();
  private readonly DEBOUNCE_MS = 100;

  write(key: string, value: any): Promise<void> {
    return new Promise((resolve, reject) => {
      // Cancel existing timer for this key
      const existingTimer = this.writeTimers.get(key);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // Store the value to write
      this.pendingWrites.set(key, value);

      // Schedule the write
      const timer = setTimeout(async () => {
        try {
          const valueToWrite = this.pendingWrites.get(key);
          if (valueToWrite !== undefined) {
            await chrome.storage.local.set({ [key]: valueToWrite });
            resolve();
          }
        } catch (error) {
          console.error(`❌ DebouncedWriter: Failed to write ${key}:`, error);
          reject(error);
        } finally {
          this.writeTimers.delete(key);
          this.pendingWrites.delete(key);
        }
      }, this.DEBOUNCE_MS);

      this.writeTimers.set(key, timer);
    });
  }
}

export const debouncedWriter = new DebouncedStorageWriter();

/**
 * Smart storage persist function that uses debounced writing
 */
export async function smartPersist(key: string, value: any): Promise<void> {
  return debouncedWriter.write(key, value);
}

/**
 * Hydrate a store from storage with proper error handling
 */
export async function hydrateStore(storeName: string, store: Record<string, any>): Promise<void> {
  try {
    const result = await chrome.storage.local.get(storeName);
    const storedData = result[storeName];

    if (storedData) {
      for (const [key, value] of Object.entries(storedData)) {
        if (store[key] !== value) {
          store[key] = value;
        }
      }
    }
  } catch (error) {
    console.error(`❌ Failed to hydrate ${storeName}:`, error);
  }
}

/**
 * Context detection utility
 * Returns 'browser' for all extension UI contexts (options, popup, etc.)
 * Returns 'background' for service worker/background script
 * Returns 'content' for content scripts
 */
export function getContextType(): 'background' | 'browser' | 'content' {
  if (typeof window === 'undefined') return 'background';
  if (window.location.protocol === 'chrome-extension:') {
    // All extension UI pages (options, popup, etc.) are considered 'browser' context
    return 'browser';
  }
  return 'content';
}
