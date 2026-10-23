// WalletConnect's keychain (session keys, the client's identity key) lives in the
// extension's private IndexedDB, not in chrome.storage.local, which every content
// script can read.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { ChromeStorageAdapter, resetWalletConnectStorageMigrationForTest } from './chromeStorageAdapter';
import { getPrivate, resetPrivateStoreForTest, setPrivate } from '@/utils/privateStore';

const local = new Map<string, unknown>();

beforeEach(async () => {
  local.clear();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string | null) => (key === null ? Object.fromEntries(local) : local.has(key) ? { [key]: local.get(key) } : {}),
        set: async (items: Record<string, unknown>) => Object.entries(items).forEach(([k, v]) => local.set(k, v)),
        remove: async (key: string | string[]) => (Array.isArray(key) ? key : [key]).forEach((k) => local.delete(k)),
      },
    },
  };
  resetWalletConnectStorageMigrationForTest();
  resetPrivateStoreForTest();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('gero-private-store');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

describe('WalletConnect storage', () => {
  it('writes and reads in the private store, never in chrome.storage.local', async () => {
    const storage = new ChromeStorageAdapter();
    await storage.setItem('wc@2:core:0.3//keychain', { sym: 'secret' });
    expect(local.size).toBe(0);
    expect(await storage.getItem('wc@2:core:0.3//keychain')).toEqual({ sym: 'secret' });
    expect(await storage.getKeys()).toEqual(['wc@2:core:0.3//keychain']);
    expect(await storage.getEntries()).toEqual([['wc@2:core:0.3//keychain', { sym: 'secret' }]]);
    await storage.removeItem('wc@2:core:0.3//keychain');
    expect(await storage.getKeys()).toEqual([]);
  });

  it('moves an older release\'s entries out of chrome.storage.local, keeping its sessions', async () => {
    local.set('wc@2:wc@2:core:0.3//keychain', { sym: 'old' });
    local.set('wc@2:wc@2:client:0.3//session', [{ topic: 't' }]);
    local.set('geroStore', { untouched: true });

    const storage = new ChromeStorageAdapter();
    expect(await storage.getItem('wc@2:client:0.3//session')).toEqual([{ topic: 't' }]);
    expect([...local.keys()]).toEqual(['geroStore']);
    expect(await getPrivate('wc@2:wc@2:core:0.3//keychain')).toEqual({ sym: 'old' });
  });

  it('keeps the private copy over a stale or planted chrome.storage entry', async () => {
    await setPrivate('wc@2:wc@2:core:0.3//keychain', { sym: 'mine' });
    local.set('wc@2:wc@2:core:0.3//keychain', { sym: 'planted' });

    expect(await new ChromeStorageAdapter().getItem('wc@2:core:0.3//keychain')).toEqual({ sym: 'mine' });
    expect(local.size).toBe(0);
  });
});
