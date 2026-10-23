import { IKeyValueStorage } from '@walletconnect/keyvaluestorage';
import {
  getPrivate,
  getPrivateEntries,
  markMovedFromChromeLocal,
  removePrivate,
  setPrivate,
  wasMovedFromChromeLocal,
} from '@/utils/privateStore';

const PREFIX = 'wc@2:';

/**
 * WalletConnect's storage: its keychain (session symmetric keys, the client's
 * identity key), pairings, sessions and history. It lives in the extension's
 * private IndexedDB (privateStore.ts), which content scripts cannot open; Gero's
 * content script and the Bring SDK inside it can read all of chrome.storage.local.
 *
 * Older releases kept these entries in chrome.storage.local. The first access
 * after the upgrade moves them across: an entry the private store already holds
 * is newer, so only missing ones are copied, and the chrome.storage copies are
 * removed afterwards. That happens once, recorded in the private store: any
 * `wc@2:` entry that shows up in chrome.storage.local later was not written by
 * WalletConnect (a content script can write there) and is only deleted.
 */
async function moveLegacyEntries(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  const alreadyMoved = await wasMovedFromChromeLocal(PREFIX);
  const all = (await chrome.storage.local.get(null)) ?? {};
  const legacyKeys = Object.keys(all).filter((key) => key.startsWith(PREFIX));
  if (!alreadyMoved) {
    for (const key of legacyKeys) {
      if ((await getPrivate(key)) === undefined) await setPrivate(key, all[key]);
    }
    await markMovedFromChromeLocal(PREFIX);
  }
  if (legacyKeys.length > 0) await chrome.storage.local.remove(legacyKeys);
}

let migration: Promise<void> | null = null;

function migrated(): Promise<void> {
  if (!migration) {
    migration = moveLegacyEntries().catch((error) => {
      migration = null; // retried on the next access
      throw error;
    });
  }
  return migration;
}

/**
 * KeyValueStorage adapter for the MV3 worker. The name predates the move out of
 * chrome.storage.local and is kept for its importers.
 */
export class ChromeStorageAdapter implements IKeyValueStorage {

  async getKeys(): Promise<string[]> {
    await migrated();
    return (await getPrivateEntries(PREFIX)).map(([key]) => key.slice(PREFIX.length));
  }

  async getEntries<T = unknown>(): Promise<[string, T][]> {
    await migrated();
    return (await getPrivateEntries(PREFIX)).map(([key, value]) => [key.slice(PREFIX.length), value as T]);
  }

  async getItem<T = unknown>(key: string): Promise<T | undefined> {
    await migrated();
    return getPrivate<T>(PREFIX + key);
  }

  async setItem<T = unknown>(key: string, value: T): Promise<void> {
    await migrated();
    await setPrivate(PREFIX + key, value);
  }

  async removeItem(key: string): Promise<void> {
    await migrated();
    await removePrivate(PREFIX + key);
  }
}

/** Test seam: forget that the legacy entries were moved. */
export function resetWalletConnectStorageMigrationForTest(): void {
  migration = null;
}
