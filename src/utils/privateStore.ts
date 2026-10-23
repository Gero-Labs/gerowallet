/**
 * Durable key-value storage for data only the extension itself may read.
 *
 * `chrome.storage.local` is shared with every content script, and Gero's runs on
 * every frame of every tab, together with the third-party Bring SDK. Anything kept
 * there can be read, and rewritten, by code running in a web page's renderer. This
 * IndexedDB database belongs to the extension origin: the worker and the extension
 * pages can open it, content scripts cannot.
 *
 * Use it for keys, tokens and anything the background relies on for a security
 * decision. Unlike storeCache.ts it is not a disposable cache: never clear it to
 * recover from a bad state.
 */
import Dexie, { type Table } from 'dexie';

interface PrivateItem {
  key: string;
  value: unknown;
}

class PrivateStoreDb extends Dexie {
  items!: Table<PrivateItem, string>;

  constructor() {
    super('gero-private-store');
    this.version(1).stores({ items: 'key' });
  }
}

let db: PrivateStoreDb | null = null;

function privateDb(): PrivateStoreDb {
  if (!db) db = new PrivateStoreDb();
  return db;
}

export async function getPrivate<T = unknown>(key: string): Promise<T | undefined> {
  const row = await privateDb().items.get(key);
  return row?.value as T | undefined;
}

export async function setPrivate(key: string, value: unknown): Promise<void> {
  await privateDb().items.put({ key, value });
}

export async function removePrivate(key: string): Promise<void> {
  await privateDb().items.delete(key);
}

/** The values stored under `keys`; a key with no value is absent from the map. */
export async function getPrivateMany(keys: string[]): Promise<Map<string, unknown>> {
  const rows = await privateDb().items.bulkGet(keys);
  const found = new Map<string, unknown>();
  rows.forEach((row) => {
    if (row) found.set(row.key, row.value);
  });
  return found;
}

/** Write several values in one transaction. */
export async function setPrivateMany(entries: Array<{ key: string; value: unknown }>): Promise<void> {
  await privateDb().items.bulkPut(entries.map(({ key, value }) => ({ key, value })));
}

/** Every stored entry whose key starts with `prefix`. */
export async function getPrivateEntries(prefix: string): Promise<[string, unknown][]> {
  const rows = await privateDb().items.where('key').startsWith(prefix).toArray();
  return rows.map((row) => [row.key, row.value]);
}

function chromeLocal(): chrome.storage.LocalStorageArea | null {
  return typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Marks a key whose chrome.storage.local copy was already dealt with. */
export const MOVED_MARKER_PREFIX = '__movedFromChromeLocal:';

/**
 * Whether the one-time move of `key` out of chrome.storage.local already ran.
 * After it has, nothing found there is ever adopted again: content scripts can
 * write chrome.storage.local, so a later value there may have been planted.
 */
export async function wasMovedFromChromeLocal(key: string): Promise<boolean> {
  return (await getPrivate(MOVED_MARKER_PREFIX + key)) === true;
}

export async function markMovedFromChromeLocal(key: string): Promise<void> {
  await setPrivate(MOVED_MARKER_PREFIX + key, true);
}

/**
 * Move one value an older release kept in `chrome.storage.local` into this store,
 * and return the value this store now holds (undefined when neither had one).
 *
 * The move runs once per key: the first call adopts the old copy if this store
 * has none, deletes it once this store reads back equal, and records that the key
 * was handled. Every later call ignores chrome.storage.local (only deleting what
 * it finds there), so a value written there afterwards, by a content script for
 * instance, is never adopted. When this store already has a value, it wins.
 */
export async function moveFromChromeLocal<T = unknown>(key: string): Promise<T | undefined> {
  const current = await getPrivate<T>(key);
  const local = chromeLocal();
  if (!local) return current;
  const alreadyMoved = await wasMovedFromChromeLocal(key);
  let legacy: unknown;
  try {
    legacy = (await local.get(key))?.[key];
  } catch {
    return current;
  }
  if (legacy === undefined) {
    if (!alreadyMoved) await markMovedFromChromeLocal(key);
    return current;
  }
  if (alreadyMoved || current !== undefined) {
    await local.remove(key);
    if (!alreadyMoved) await markMovedFromChromeLocal(key);
    return current;
  }
  await setPrivate(key, legacy);
  if (!sameJson(await getPrivate(key), legacy)) throw new Error(`Could not move ${key} out of chrome.storage`);
  await markMovedFromChromeLocal(key);
  await local.remove(key);
  return legacy as T;
}

/** Test seam: drop the cached connection so a fresh fake IndexedDB can be installed. */
export function resetPrivateStoreForTest(): void {
  db?.close();
  db = null;
}
