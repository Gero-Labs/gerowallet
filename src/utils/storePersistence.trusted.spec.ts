// Secrets out of chrome.storage.local, and no trust in what comes back from it.
//
// Every content script can read and rewrite chrome.storage.local: Gero's own, in
// every frame of every tab, and the third-party Bring SDK inside it. These cases pin
// the two StorePersister options built for that: `redact` keeps a value out of the
// compact record, and `trustedFields` makes the extension's private IndexedDB copy
// the one every context believes.
import { describe, it, expect, beforeEach } from 'vitest';
import { StorePersister, type BulkStorage, type CompactStorage, type TrustedStorage } from './storePersistence';
import type { StoreCacheEntry } from './storeCache';

class MemoryCompact implements CompactStorage {
  data = new Map<string, unknown>();
  async get(key: string) {
    return this.data.get(key);
  }
  async set(key: string, value: unknown) {
    this.data.set(key, JSON.parse(JSON.stringify(value)));
  }
}

class MemoryBulk implements BulkStorage {
  data = new Map<string, StoreCacheEntry>();
  async read(keys: string[]) {
    const found = new Map<string, StoreCacheEntry>();
    keys.forEach((key) => {
      const entry = this.data.get(key);
      if (entry) found.set(key, entry);
    });
    return found;
  }
  async write(entries: StoreCacheEntry[]) {
    entries.forEach((entry) => this.data.set(entry.key, entry));
  }
}

class MemoryTrusted implements TrustedStorage {
  data = new Map<string, string>();
  failReads = false;
  async read(keys: string[]) {
    if (this.failReads) throw new Error('IndexedDB unavailable');
    const found = new Map<string, string>();
    keys.forEach((key) => {
      const json = this.data.get(key);
      if (json !== undefined) found.set(key, json);
    });
    return found;
  }
  async write(entries: Array<{ key: string; json: string }>) {
    entries.forEach(({ key, json }) => this.data.set(key, json));
  }
}

type Wallet = { id: number; name: string; encryptedPrivateKey?: string };
type Store = { loggedWallet: Wallet | null; isLocked: boolean; theme: string; items: number[] };

const fresh = (): Store => ({ loggedWallet: null, isLocked: false, theme: 'dark', items: [] });

function persisterFor(state: Store, compact: MemoryCompact, bulk: MemoryBulk, trusted: MemoryTrusted) {
  return new StorePersister(state as unknown as Record<string, unknown>, {
    storeName: 'testStore',
    bulkFields: ['items'],
    immediateFields: ['loggedWallet', 'isLocked'],
    scope: (s) => {
      const id = (s['loggedWallet'] as Wallet | null)?.id;
      return id == null ? null : String(id);
    },
    redact: (field, value) => {
      if (field !== 'loggedWallet' || !value) return value;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- taken out, not used
      const { encryptedPrivateKey: _key, ...rest } = value as Wallet;
      return rest;
    },
    trustedFields: ['loggedWallet', 'isLocked'],
    compact,
    bulk,
    trusted,
  });
}

const WALLET: Wallet = { id: 1, name: 'Main', encryptedPrivateKey: 'cipher-1' };

describe('StorePersister redaction and trusted fields', () => {
  let compact: MemoryCompact;
  let bulk: MemoryBulk;
  let trusted: MemoryTrusted;

  beforeEach(() => {
    compact = new MemoryCompact();
    bulk = new MemoryBulk();
    trusted = new MemoryTrusted();
  });

  /** A worker of this release that has run once and logged WALLET in. */
  async function workerWithWallet(): Promise<void> {
    const state = fresh();
    const p = persisterFor(state, compact, bulk, trusted);
    await p.hydrate({ migrate: true });
    state.loggedWallet = { ...WALLET };
    p.markDirty(['loggedWallet']);
    await p.flush();
  }

  it('keeps a redacted value out of chrome.storage while the store and the private copy hold it', async () => {
    await workerWithWallet();

    const record = compact.data.get('testStore') as Store;
    expect(record.loggedWallet).toEqual({ id: 1, name: 'Main' });
    expect(JSON.stringify(record)).not.toContain('cipher-1');
    expect(JSON.parse(trusted.data.get('store:testStore.loggedWallet')!)).toEqual(WALLET);
  });

  it('a page reads the full trusted value from the private copy, not the redacted record', async () => {
    await workerWithWallet();

    const page = fresh();
    await persisterFor(page, compact, bulk, trusted).hydrate();
    expect(page.loggedWallet).toEqual(WALLET);
  });

  it('ignores a trusted field rewritten in chrome.storage after the worker took it over', async () => {
    await workerWithWallet();
    // A content script plants another wallet and clears the lock in the shared record.
    compact.data.set('testStore', { ...(compact.data.get('testStore') as Store), loggedWallet: { id: 9, name: 'Planted' }, isLocked: false });
    trusted.data.set('store:testStore.isLocked', 'true');

    const worker = fresh();
    await persisterFor(worker, compact, bulk, trusted).hydrate({ migrate: true });
    expect(worker.loggedWallet).toEqual(WALLET);
    expect(worker.isLocked).toBe(true);
  });

  it('never falls back to chrome.storage for a trusted field once the store was taken over', async () => {
    trusted.data.set('store:testStore@adopted', 'true');
    compact.data.set('testStore', { loggedWallet: { id: 9, name: 'Planted' }, isLocked: false, theme: 'light' });

    const worker = fresh();
    await persisterFor(worker, compact, bulk, trusted).hydrate({ migrate: true });
    expect(worker.loggedWallet).toBeNull();
    // Fields that are not trusted still come from the record.
    expect(worker.theme).toBe('light');
  });

  it('on the first start of this release takes the old record over and rewrites it without the secrets', async () => {
    compact.data.set('testStore', { loggedWallet: { ...WALLET }, isLocked: true, theme: 'light' });

    const worker = fresh();
    const p = persisterFor(worker, compact, bulk, trusted);
    await p.hydrate({ migrate: true });
    expect(worker.loggedWallet).toEqual(WALLET);
    await new Promise((r) => setTimeout(r, 10));
    await p.flush();

    expect(trusted.data.get('store:testStore@adopted')).toBe('true');
    expect(JSON.parse(trusted.data.get('store:testStore.loggedWallet')!)).toEqual(WALLET);
    expect(JSON.parse(trusted.data.get('store:testStore.isLocked')!)).toBe(true);
    const record = compact.data.get('testStore') as Store;
    expect(JSON.stringify(record)).not.toContain('cipher-1');
    expect(record.theme).toBe('light');
  });

  it('a fresh install takes over its defaults, so a later planted record is never believed', async () => {
    const first = fresh();
    const p = persisterFor(first, compact, bulk, trusted);
    await p.hydrate({ migrate: true });
    await new Promise((r) => setTimeout(r, 10));
    await p.flush();
    expect(trusted.data.get('store:testStore@adopted')).toBe('true');

    compact.data.set('testStore', { loggedWallet: { id: 9, name: 'Planted' }, isLocked: false, theme: 'dark' });
    const next = fresh();
    await persisterFor(next, compact, bulk, trusted).hydrate({ migrate: true });
    expect(next.loggedWallet).toBeNull();
  });

  it('does not take the store over from a private store it could not read', async () => {
    compact.data.set('testStore', { loggedWallet: { id: 1, name: 'Main' }, isLocked: false, theme: 'dark' });
    trusted.failReads = true;

    const worker = fresh();
    const p = persisterFor(worker, compact, bulk, trusted);
    await p.hydrate({ migrate: true });
    await new Promise((r) => setTimeout(r, 10));
    await p.flush();
    // Still usable from the record, but nothing was written over the private copy.
    expect(worker.loggedWallet).toEqual({ id: 1, name: 'Main' });
    expect(trusted.data.size).toBe(0);
  });

  it('a page never takes the store over', async () => {
    compact.data.set('testStore', { loggedWallet: { ...WALLET }, isLocked: false, theme: 'dark' });
    const page = fresh();
    const p = persisterFor(page, compact, bulk, trusted);
    await p.hydrate();
    await new Promise((r) => setTimeout(r, 10));
    await p.flush();
    expect(trusted.data.size).toBe(0);
    expect((compact.data.get('testStore') as Store).loggedWallet).toEqual(WALLET);
  });

  it('read() and hydrateWith() hand back the private copy as well', async () => {
    await workerWithWallet();
    compact.data.set('testStore', { ...(compact.data.get('testStore') as Store), loggedWallet: { id: 9, name: 'Planted' } });

    const record = await persisterFor(fresh(), compact, bulk, trusted).read();
    expect(record?.['loggedWallet']).toEqual(WALLET);

    let applied: Record<string, unknown> | null = null;
    await persisterFor(fresh(), compact, bulk, trusted).hydrateWith((stored) => { applied = stored; });
    expect(applied!['loggedWallet']).toEqual(WALLET);
  });

  it('pairs bulk data with the trusted session, not a planted one', async () => {
    const state = fresh();
    const p = persisterFor(state, compact, bulk, trusted);
    await p.hydrate({ migrate: true });
    state.loggedWallet = { ...WALLET };
    state.items = [1, 2, 3];
    p.markDirty(['loggedWallet', 'items']);
    await p.flush();

    // Point the shared record at wallet 9; wallet 1's data must still be wallet 1's.
    compact.data.set('testStore', { ...(compact.data.get('testStore') as Store), loggedWallet: { id: 9, name: 'Planted' } });
    const record = await persisterFor(fresh(), compact, bulk, trusted).read();
    expect(record?.['items']).toEqual([1, 2, 3]);
    expect((record?.['loggedWallet'] as Wallet).id).toBe(1);
  });

  it('refuses a field configured as both bulk and trusted', () => {
    expect(() => new StorePersister({}, { storeName: 'bad', bulkFields: ['x'], trustedFields: ['x'] })).toThrow(/both bulk and trusted/);
  });
});
