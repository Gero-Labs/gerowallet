/**
 * IndexedDB home for the bulk fields of the background-owned stores
 * (transactions, UTxOs, tokens, NFT collections, network assets, …).
 *
 * These used to live inside one `chrome.storage.local` value per store. Every
 * local-area write that changes a value makes Chrome build an old+new change
 * event on the browser UI thread and copy it into every context holding a
 * `storage.onChanged` listener. For Gero that is the worker, each dashboard and
 * side panel, and the Bring SDK in the content script of every frame of every
 * tab. With multi-MB values the copies stalled the browser UI thread for over a
 * second per write, which froze every Chrome window, other profiles included.
 * IndexedDB writes raise no such event and never reach those listeners.
 *
 * A separate database, not a table in GeroWalletDatabase: this is a disposable
 * cache of display state, and adding it there would mean a schema bump on the
 * database that holds the encrypted wallet records.
 */
import Dexie, { type Table } from 'dexie';

export interface StoreCacheEntry {
  /** `<storeName>.<field>` */
  key: string;
  /** Session the value belongs to (the wallet id for walletStore). Hydration ignores other scopes. */
  scope: string | null;
  /** The field serialized exactly as it is broadcast to the UI contexts. */
  json: string;
  savedAt: number;
}

class StoreCacheDb extends Dexie {
  entries!: Table<StoreCacheEntry, string>;

  constructor() {
    super('gero-store-cache');
    this.version(1).stores({ entries: 'key' });
  }
}

let db: StoreCacheDb | null = null;

function cacheDb(): StoreCacheDb {
  if (!db) db = new StoreCacheDb();
  return db;
}

export async function readStoreCache(keys: string[]): Promise<Map<string, StoreCacheEntry>> {
  const rows = await cacheDb().entries.bulkGet(keys);
  const found = new Map<string, StoreCacheEntry>();
  rows.forEach((row) => {
    if (row) found.set(row.key, row);
  });
  return found;
}

export async function writeStoreCache(entries: StoreCacheEntry[]): Promise<void> {
  await cacheDb().entries.bulkPut(entries);
}

/** Test seam: drop the cached connection so a fresh fake IndexedDB can be installed. */
export function resetStoreCacheForTest(): void {
  db?.close();
  db = null;
}
