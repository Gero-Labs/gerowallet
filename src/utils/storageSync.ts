/**
 * Storage Sync Utilities
 *
 * Helper functions for context detection and storage operations.
 * Store syncing is now handled by the messaging system (storeMessaging.service.ts and storeMessagingBg.ts).
 */

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
