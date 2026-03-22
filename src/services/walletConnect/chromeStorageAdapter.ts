import { IKeyValueStorage } from '@walletconnect/keyvaluestorage';

const PREFIX = 'wc@2:';

function storageGet(keys: string | string[] | null): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result || {}));
  });
}

/**
 * Custom KeyValueStorage adapter for Chrome Extension Manifest V3.
 * Service workers don't have access to localStorage or IndexedDB reliably,
 * so we use chrome.storage.local which is always available.
 */
export class ChromeStorageAdapter implements IKeyValueStorage {

  async getKeys(): Promise<string[]> {
    const all = await storageGet(null);
    return Object.keys(all)
      .filter(k => k.startsWith(PREFIX))
      .map(k => k.slice(PREFIX.length));
  }

  async getEntries<T = any>(): Promise<[string, T][]> {
    const all = await storageGet(null);
    return Object.entries(all)
      .filter(([k]) => k.startsWith(PREFIX))
      .map(([k, v]) => [k.slice(PREFIX.length), v as T]);
  }

  async getItem<T = any>(key: string): Promise<T | undefined> {
    const result = await storageGet(PREFIX + key);
    return result[PREFIX + key] as T | undefined;
  }

  async setItem<T = any>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [PREFIX + key]: value });
  }

  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(PREFIX + key);
  }
}
