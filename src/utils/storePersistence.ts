/**
 * Persistence for the background-owned stores (walletStore, networkStore, midnightStore).
 *
 * Each store is persisted in two parts:
 *  - a compact record under `chrome.storage.local[storeName]`: the small fields a
 *    freshly opened context needs before its first paint (logged wallet, lock
 *    state, account, config, tip, …);
 *  - its bulk fields in IndexedDB (storeCache.ts), one entry per field.
 *
 * Only the fields a setter touched are serialized, and a value identical to the
 * last one written is skipped, so a one-flag update costs one small write rather
 * than re-serializing and rewriting the whole store. storeCache.ts explains why
 * the bulk fields must stay out of chrome.storage.
 */
import { readStoreCache, writeStoreCache, type StoreCacheEntry } from '@/utils/storeCache';

type Replacer = (key: string, value: unknown) => unknown;
type State = Record<string, unknown>;

export interface CompactStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface BulkStorage {
  read(keys: string[]): Promise<Map<string, StoreCacheEntry>>;
  write(entries: StoreCacheEntry[]): Promise<void>;
}

export interface StorePersisterOptions {
  storeName: string;
  /** Fields persisted to IndexedDB instead of chrome.storage. */
  bulkFields: readonly string[];
  /** JSON replacer. Must match what the store broadcasts (BigInt, Map, Set, …). */
  replacer?: Replacer;
  /** A change to one of these is written at once instead of after the debounce. */
  immediateFields?: readonly string[];
  /** Session the bulk fields belong to. Hydration drops bulk entries from any other session. */
  scope?: (state: State) => string | null;
  debounceMs?: number;
  compact?: CompactStorage;
  bulk?: BulkStorage;
}

export interface HydrateOptions {
  /** Fields not to overwrite, typically ones the port has already delivered fresher. */
  skip?: ReadonlySet<string>;
  /** Rewrite a record in the old single-value format (bulk fields inline) into the split layout. */
  migrate?: boolean;
}

const chromeCompactStorage: CompactStorage = {
  async get(key) {
    const result = await chrome.storage.local.get(key);
    return result?.[key];
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
};

const indexedDbBulkStorage: BulkStorage = { read: readStoreCache, write: writeStoreCache };

/** cyrb53, a fast 53-bit string hash. Used only to skip rewriting an unchanged field. */
function hash53(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function fingerprint(scope: string | null, json: string): string {
  return `${scope ?? ''}|${json.length}|${hash53(json)}`;
}

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30000;

export class StorePersister {
  private readonly bulkFields: ReadonlySet<string>;
  private readonly immediateFields: ReadonlySet<string>;
  private readonly bulkDirty = new Set<string>();
  private compactDirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private lastCompactJson: string | null = null;
  /** Fingerprint of each bulk field as last written (or hydrated) successfully. */
  private readonly lastBulk = new Map<string, string>();
  /** Fields set while a hydration is awaiting storage; it must not overwrite them. */
  private readonly hydrationWatchers = new Set<Set<string>>();
  /**
   * Bulk fields whose only persisted copy is still inline in an old-format
   * chrome.storage record. Every compact write keeps them inline until IndexedDB
   * confirms them, so the compact fields (lock state, logged wallet) stay durable
   * even while the move keeps failing.
   */
  private readonly legacyInline = new Set<string>();
  /**
   * The old record's own bulk values, held from the moment hydration reads it until
   * IndexedDB confirms them. Writes use a held value instead of the store's copy:
   * the store holds empty defaults while the IndexedDB read is pending, and can be
   * emptied without a setter afterwards. A setter that writes the field supersedes
   * its held value (see markDirty).
   */
  private readonly legacyHeld = new Map<string, unknown>();
  /**
   * Session the legacy data belongs to. Once the store's session differs (a wallet
   * switch or logout), the legacy data is another session's: it is neither held nor
   * kept inline any longer (see write).
   */
  private legacyScope: string | null = null;
  /** A hydration's chrome.storage read. No write may replace the record before it lands. */
  private compactRead: Promise<State | null> | null = null;
  private retryMs = 0;

  constructor(private readonly state: State, private readonly options: StorePersisterOptions) {
    this.bulkFields = new Set(options.bulkFields);
    this.immediateFields = new Set(options.immediateFields ?? []);
  }

  private get compact(): CompactStorage {
    return this.options.compact ?? chromeCompactStorage;
  }

  private get bulk(): BulkStorage {
    return this.options.bulk ?? indexedDbBulkStorage;
  }

  private scope(): string | null {
    return this.options.scope?.(this.state) ?? null;
  }

  private bulkKey(field: string): string {
    return `${this.options.storeName}.${field}`;
  }

  /** Record that `fields` changed. Persisted after the debounce, or at once for an immediate field. */
  markDirty(fields: readonly string[]): void {
    let immediate = false;
    for (const field of fields) {
      if (this.bulkFields.has(field)) {
        this.bulkDirty.add(field);
        // The store's value is newer than the old record's from here on.
        this.legacyHeld.delete(field);
      } else {
        this.compactDirty = true;
      }
      if (this.immediateFields.has(field)) immediate = true;
      this.hydrationWatchers.forEach((touched) => touched.add(field));
    }
    this.schedule(immediate ? 0 : this.options.debounceMs ?? 300);
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delayMs);
  }

  /** Write everything pending now. Never rejects: a failed write is retried with backoff. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Writing before a hydration has read the stored record would replace it with the
    // store's defaults: the session, and an old record's only copy of its bulk fields.
    if (this.compactRead) await this.compactRead;
    // One write at a time, so two flushes can never land the same key out of order.
    while (this.inFlight) await this.inFlight;
    if (!this.compactDirty && this.bulkDirty.size === 0) return;
    const bulkFields = [...this.bulkDirty];
    const compactDirty = this.compactDirty;
    this.bulkDirty.clear();
    this.compactDirty = false;
    this.inFlight = this.write(bulkFields, compactDirty).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async write(bulkFields: string[], compactDirty: boolean): Promise<void> {
    const { storeName, replacer } = this.options;
    let failedBulk: string[] = [];
    let compactFailed = false;
    let writeCompact = compactDirty;

    // After a wallet switch or logout the legacy data belongs to another session, so
    // it must not be written out under this one.
    if (this.legacyInline.size > 0 && this.scope() !== this.legacyScope) {
      this.legacyInline.clear();
      this.legacyHeld.clear();
    }

    // Bulk before compact, so the compact write in the same flush can drop an inline
    // legacy copy (see `legacyInline`) that has just reached IndexedDB.
    if (bulkFields.length > 0) {
      const scope = this.scope();
      const entries: StoreCacheEntry[] = [];
      const pending = new Map<string, string>();
      for (const field of bulkFields) {
        // A held legacy value is what the field still is on disk; the store's copy may
        // have been emptied without a setter (clearForWalletSwitch at login).
        const value = this.legacyHeld.has(field) ? this.legacyHeld.get(field) : this.state[field];
        let json: string;
        try {
          json = JSON.stringify(value ?? null, replacer);
        } catch (error) {
          console.error(`Failed to serialize ${storeName}.${field}:`, error);
          continue;
        }
        const fp = fingerprint(scope, json);
        if (this.lastBulk.get(field) === fp) {
          // Already in IndexedDB as-is, so an inline legacy copy is now redundant.
          this.legacyHeld.delete(field);
          if (this.legacyInline.delete(field)) writeCompact = true;
          continue;
        }
        entries.push({ key: this.bulkKey(field), scope, json, savedAt: Date.now() });
        pending.set(field, fp);
      }
      if (entries.length > 0) {
        try {
          await this.bulk.write(entries);
          pending.forEach((fp, field) => {
            this.lastBulk.set(field, fp);
            // IndexedDB now holds the field, so the old record's copy is no longer the only one.
            this.legacyHeld.delete(field);
            if (this.legacyInline.delete(field)) writeCompact = true;
          });
        } catch (error) {
          failedBulk = [...pending.keys()];
          // A field still carried inline takes its latest value there instead.
          if (failedBulk.some((field) => this.legacyInline.has(field))) writeCompact = true;
          console.error(`Failed to persist ${storeName} (${failedBulk.join(', ')}):`, error);
        }
      }
    }

    // Never held back by a failed bulk write: a lock or logout must persist regardless.
    if (writeCompact) {
      try {
        const json = JSON.stringify(this.compactView(), replacer);
        if (json !== this.lastCompactJson) {
          await this.compact.set(storeName, JSON.parse(json));
          this.lastCompactJson = json;
        }
      } catch (error) {
        compactFailed = true;
        console.error(`Failed to persist ${storeName}:`, error);
      }
    }

    if (failedBulk.length > 0 || compactFailed) {
      failedBulk.forEach((field) => this.bulkDirty.add(field));
      if (compactFailed) this.compactDirty = true;
      this.retryMs = Math.min(Math.max(this.retryMs * 2, RETRY_MIN_MS), RETRY_MAX_MS);
      this.schedule(this.retryMs);
    } else {
      this.retryMs = 0;
    }
  }

  private compactView(): State {
    const view: State = {};
    for (const key of Object.keys(this.state)) {
      if (!this.bulkFields.has(key)) view[key] = this.state[key];
      else if (this.legacyInline.has(key)) view[key] = this.legacyHeld.has(key) ? this.legacyHeld.get(key) : this.state[key];
    }
    return view;
  }

  /**
   * Load the persisted state into the store and return the stored compact record.
   *
   * A bulk entry is applied only when its scope matches the hydrated session, so a
   * wallet switch or logout the worker did not live to finish writing can never pair
   * one wallet's transactions with another wallet's session. A record in the old
   * format (bulk fields inline) is still read, and with `migrate` it is rewritten.
   */
  async hydrate({ skip, migrate = false }: HydrateOptions = {}): Promise<State | null> {
    const { storeName } = this.options;
    const touched = new Set<string>();
    this.hydrationWatchers.add(touched);
    const keep = (field: string) => !touched.has(field) && !skip?.has(field);
    try {
      // Set before the first await: a flush from here on waits for this read (see flush).
      const reading = this.readCompactRecord();
      this.compactRead = reading;
      let stored: State | null;
      try {
        stored = await reading;
      } finally {
        if (this.compactRead === reading) this.compactRead = null;
      }

      const legacy: State = {};
      if (stored) {
        for (const [field, value] of Object.entries(stored)) {
          if (this.bulkFields.has(field)) legacy[field] = value;
          else if (keep(field)) this.state[field] = value;
        }
      }
      const legacyFields = Object.keys(legacy);
      const storedScope = stored ? this.options.scope?.(stored) ?? null : null;
      if (migrate && legacyFields.length > 0 && storedScope === this.scope()) {
        // The old record holds the only persisted copy of these, and it is still this
        // session's. Keep them in every compact write while the IndexedDB read below is
        // pending: the old value itself, unless a setter already wrote a newer one.
        this.legacyScope = storedScope;
        for (const field of legacyFields) {
          this.legacyInline.add(field);
          if (!touched.has(field)) this.legacyHeld.set(field, legacy[field]);
        }
      }

      let entries = new Map<string, StoreCacheEntry>();
      try {
        entries = await this.bulk.read([...this.bulkFields].map((field) => this.bulkKey(field)));
      } catch (error) {
        console.error(`Failed to read cached ${storeName}:`, error);
      }

      const scope = this.scope();
      // An old-format record's bulk fields belong to the session that wrote it. Use them
      // only while that is still the current session: the port can deliver another
      // wallet's identity while the read above is in flight.
      const legacyUsable = stored !== null && storedScope === scope;
      const fromLegacy: string[] = [];
      for (const field of this.bulkFields) {
        const entry = entries.get(this.bulkKey(field));
        let value: unknown;
        if (legacyUsable && field in legacy) {
          // Only builds older than the split write bulk fields inline (this one does only
          // while IndexedDB keeps failing), so an inline copy is the later write and wins
          // over IndexedDB: a user who rolled back and upgraded again keeps the newer data.
          value = legacy[field];
          fromLegacy.push(field);
        } else if (entry && entry.scope === scope) {
          try {
            value = JSON.parse(entry.json);
            this.lastBulk.set(field, fingerprint(entry.scope, entry.json));
          } catch (error) {
            console.error(`Discarding unreadable cached ${storeName}.${field}:`, error);
          }
        }
        if (value !== undefined && keep(field)) this.state[field] = value;
      }

      // Move an old-format record's bulk fields into IndexedDB. Each stays held, and
      // inline in the chrome.storage record, until IndexedDB confirms it: the store's own
      // copy can be emptied without a setter before that write lands (clearForWalletSwitch
      // at login). A field belonging to another session no longer needs either.
      if (migrate && legacyFields.length > 0) {
        for (const field of legacyFields) {
          if (fromLegacy.includes(field)) {
            this.legacyInline.add(field);
            // A setter's newer value supersedes the old one (see markDirty).
            if (!touched.has(field)) this.legacyHeld.set(field, legacy[field]);
            this.bulkDirty.add(field);
          } else {
            this.legacyHeld.delete(field);
            this.legacyInline.delete(field);
          }
        }
        if (fromLegacy.length > 0) this.legacyScope = scope;
        this.compactDirty = true;
        void this.flush();
      }
      return stored;
    } finally {
      this.hydrationWatchers.delete(touched);
    }
  }

  /**
   * The persisted record, with its bulk fields merged back in, without applying it.
   * For a store whose fields need custom revival (BigInts, validation) before they
   * reach its state. A bulk entry is merged only when it belongs to the record's own
   * session. An inline copy in an old-format record wins over IndexedDB, as in
   * hydrate(): it is always the later write.
   */
  async read(): Promise<State | null> {
    const { storeName } = this.options;
    const stored = await this.readCompactRecord();
    if (!stored) return null;
    let entries = new Map<string, StoreCacheEntry>();
    try {
      entries = await this.bulk.read([...this.bulkFields].map((field) => this.bulkKey(field)));
    } catch (error) {
      console.error(`Failed to read cached ${storeName}:`, error);
    }
    const scope = this.options.scope?.(stored) ?? null;
    const record: State = { ...stored };
    for (const field of this.bulkFields) {
      const entry = entries.get(this.bulkKey(field));
      if (field in stored || !entry || entry.scope !== scope) continue;
      try {
        record[field] = JSON.parse(entry.json);
      } catch (error) {
        console.error(`Discarding unreadable cached ${storeName}.${field}:`, error);
      }
    }
    return record;
  }

  private async readCompactRecord(): Promise<State | null> {
    try {
      const value = await this.compact.get(this.options.storeName);
      return value && typeof value === 'object' ? (value as State) : null;
    } catch (error) {
      console.error(`Failed to read ${this.options.storeName}:`, error);
      return null;
    }
  }
}
