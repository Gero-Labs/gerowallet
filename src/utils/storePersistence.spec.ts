// The persistence split behind the browser-wide freeze fix.
//
// Every chrome.storage.local write that changes a value makes Chrome copy the old
// and new value into every storage.onChanged listener on its UI thread. Stores
// used to rewrite themselves whole on every change, so a one-flag update shipped
// tens of MB through that path. These cases pin the contract that replaced it:
// only touched fields are written, bulk fields never reach chrome.storage, and
// the state still survives restarts, upgrades, failed writes and session changes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StorePersister, type BulkStorage, type CompactStorage } from './storePersistence';
import type { StoreCacheEntry } from './storeCache';

class MemoryCompact implements CompactStorage {
  data = new Map<string, unknown>();
  sets: { key: string; value: unknown }[] = [];
  failNext = 0;
  async get(key: string) {
    return this.data.get(key);
  }
  async set(key: string, value: unknown) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('QUOTA_BYTES quota exceeded');
    }
    this.sets.push({ key, value });
    this.data.set(key, JSON.parse(JSON.stringify(value)));
  }
}

class MemoryBulk implements BulkStorage {
  data = new Map<string, StoreCacheEntry>();
  writes: StoreCacheEntry[][] = [];
  failNext = 0;
  async read(keys: string[]) {
    const found = new Map<string, StoreCacheEntry>();
    keys.forEach((key) => {
      const entry = this.data.get(key);
      if (entry) found.set(key, entry);
    });
    return found;
  }
  async write(entries: StoreCacheEntry[]) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('IndexedDB transaction aborted');
    }
    this.writes.push(entries);
    entries.forEach((entry) => this.data.set(entry.key, entry));
  }
}

type Store = {
  session: { id: number } | null;
  flag: boolean;
  label: string;
  items: { id: number; nested: { values: number[] } }[];
  index: Record<string, number>;
};

const fresh = (): Store => ({ session: null, flag: false, label: '', items: [], index: {} });

const bigItems = (n: number, seed = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: i + seed, nested: { values: Array.from({ length: 20 }, (_, k) => k * i) } }));

function persisterFor(state: Store, compact: MemoryCompact, bulk: MemoryBulk) {
  return new StorePersister(state as unknown as Record<string, unknown>, {
    storeName: 'testStore',
    bulkFields: ['items', 'index'],
    immediateFields: ['session'],
    scope: (s) => {
      const id = (s['session'] as Store['session'])?.id;
      return id == null ? null : String(id);
    },
    compact,
    bulk,
  });
}

describe('StorePersister', () => {
  let compact: MemoryCompact;
  let bulk: MemoryBulk;
  let state: Store;
  let persister: StorePersister;

  beforeEach(() => {
    compact = new MemoryCompact();
    bulk = new MemoryBulk();
    state = fresh();
    persister = persisterFor(state, compact, bulk);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps bulk fields out of chrome.storage entirely', async () => {
    state.session = { id: 1 };
    state.items = bigItems(500);
    persister.markDirty(['session', 'items']);
    await persister.flush();

    const record = compact.data.get('testStore') as Record<string, unknown>;
    expect(record).toEqual({ session: { id: 1 }, flag: false, label: '' });
    expect(bulk.data.get('testStore.items')?.scope).toBe('1');
    expect(JSON.parse(bulk.data.get('testStore.items')!.json)).toHaveLength(500);
  });

  // The regression the freeze came from: a tiny recurring update beside large data.
  it('a tiny recurring update writes only the small record and never re-serializes bulk data', async () => {
    state.session = { id: 1 };
    state.items = bigItems(2000);
    persister.markDirty(['session', 'items']);
    await persister.flush();
    compact.sets = [];
    bulk.writes = [];
    const stringify = vi.spyOn(JSON, 'stringify');

    for (let i = 0; i < 10; i++) {
      state.flag = !state.flag;
      persister.markDirty(['flag']);
      await persister.flush();
    }

    expect(bulk.writes).toHaveLength(0);
    expect(compact.sets).toHaveLength(10);
    for (const { value } of compact.sets) {
      expect(JSON.stringify(value).length).toBeLessThan(200);
      expect(value).not.toHaveProperty('items');
    }
    // Nothing serialized the 2000-item array while only the flag changed.
    const serializedItems = stringify.mock.calls.filter(([arg]) => arg === state.items);
    expect(serializedItems).toHaveLength(0);
  });

  it('skips a bulk field whose content has not changed', async () => {
    state.items = bigItems(50);
    persister.markDirty(['items']);
    await persister.flush();
    bulk.writes = [];

    state.items = bigItems(50); // new array, same content (what applyUtxos produces)
    persister.markDirty(['items']);
    await persister.flush();
    expect(bulk.writes).toHaveLength(0);

    state.items = bigItems(50, 1);
    persister.markDirty(['items']);
    await persister.flush();
    expect(bulk.writes).toHaveLength(1);
  });

  it('coalesces rapid updates into one write per field carrying the final values', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 25; i++) {
      state.label = `label-${i}`;
      state.items = bigItems(3, i);
      persister.markDirty(['label', 'items']);
    }
    await vi.advanceTimersByTimeAsync(300);

    expect(compact.sets).toHaveLength(1);
    expect((compact.sets[0].value as Store).label).toBe('label-24');
    expect(bulk.writes).toHaveLength(1);
    expect(JSON.parse(bulk.writes[0][0].json)[0].id).toBe(24);
  });

  it('writes a session change at once instead of waiting for the debounce', async () => {
    vi.useFakeTimers();
    state.session = { id: 7 };
    persister.markDirty(['session']);
    await vi.advanceTimersByTimeAsync(0);
    expect((compact.data.get('testStore') as Store).session).toEqual({ id: 7 });
  });

  it('retries a failed chrome.storage write with the latest state', async () => {
    vi.useFakeTimers();
    compact.failNext = 1;
    state.label = 'first';
    persister.markDirty(['label']);
    await persister.flush();
    expect(compact.data.has('testStore')).toBe(false);

    state.label = 'second';
    await vi.advanceTimersByTimeAsync(1000);
    expect((compact.data.get('testStore') as Store).label).toBe('second');
  });

  it('retries a failed IndexedDB write instead of recording it as written', async () => {
    vi.useFakeTimers();
    bulk.failNext = 1;
    state.items = bigItems(5);
    persister.markDirty(['items']);
    await persister.flush();
    expect(bulk.data.has('testStore.items')).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    expect(JSON.parse(bulk.data.get('testStore.items')!.json)).toHaveLength(5);
  });

  it('restores everything after a restart (a fresh persister over the same storage)', async () => {
    state.session = { id: 3 };
    state.label = 'kept';
    state.items = bigItems(40);
    state.index = { a: 1 };
    persister.markDirty(['session', 'label', 'items', 'index']);
    await persister.flush();

    const restarted = fresh();
    await persisterFor(restarted, compact, bulk).hydrate();
    expect(restarted).toEqual(JSON.parse(JSON.stringify(state)));
  });

  it('does not rewrite hydrated bulk data that has not changed since', async () => {
    state.session = { id: 3 };
    state.items = bigItems(40);
    persister.markDirty(['session', 'items']);
    await persister.flush();
    bulk.writes = [];

    const restarted = fresh();
    const next = persisterFor(restarted, compact, bulk);
    await next.hydrate();
    restarted.items = bigItems(40);
    next.markDirty(['items']);
    await next.flush();
    expect(bulk.writes).toHaveLength(0);
  });

  it('never hydrates bulk data into a different session', async () => {
    state.session = { id: 1 };
    state.items = bigItems(10);
    persister.markDirty(['session', 'items']);
    await persister.flush();

    // Switch to wallet 2; the worker dies before wallet 2's data is written.
    state.session = { id: 2 };
    persister.markDirty(['session']);
    await persister.flush();

    const restarted = fresh();
    await persisterFor(restarted, compact, bulk).hydrate();
    expect(restarted.session).toEqual({ id: 2 });
    expect(restarted.items).toEqual([]);
  });

  it('after logout nothing from the previous session hydrates', async () => {
    state.session = { id: 1 };
    state.items = bigItems(10);
    persister.markDirty(['session', 'items']);
    await persister.flush();

    Object.assign(state, fresh());
    persister.markDirty(['session', 'flag', 'label', 'items', 'index']);
    await persister.flush();

    const restarted = fresh();
    await persisterFor(restarted, compact, bulk).hydrate();
    expect(restarted).toEqual(fresh());
  });

  it('reads the old single-value format and moves its bulk fields out of chrome.storage', async () => {
    const legacy = { session: { id: 5 }, flag: true, label: 'old', items: bigItems(30), index: { z: 26 } };
    compact.data.set('testStore', JSON.parse(JSON.stringify(legacy)));

    await persister.hydrate({ migrate: true });
    expect(state).toEqual(JSON.parse(JSON.stringify(legacy)));
    await persister.flush();

    expect(compact.data.get('testStore')).toEqual({ session: { id: 5 }, flag: true, label: 'old' });
    expect(JSON.parse(bulk.data.get('testStore.items')!.json)).toHaveLength(30);
    expect(bulk.data.get('testStore.index')!.scope).toBe('5');
  });

  it('keeps the old record intact until its bulk fields are safely in IndexedDB', async () => {
    const legacy = { session: { id: 5 }, flag: false, label: 'old', items: bigItems(30), index: {} };
    compact.data.set('testStore', JSON.parse(JSON.stringify(legacy)));
    bulk.failNext = 2; // the move started by hydrate() and the retry below both fail

    await persister.hydrate({ migrate: true });
    await persister.flush();
    // The move failed, so the old record (the only persisted copy) must still be whole.
    expect((compact.data.get('testStore') as Store).items).toHaveLength(30);

    // A worker restart at this point still finds all the data.
    const restarted = fresh();
    await persisterFor(restarted, compact, bulk).hydrate();
    expect(restarted.items).toHaveLength(30);

    // The next attempt completes the move.
    await persister.flush();
    expect(compact.data.get('testStore')).not.toHaveProperty('items');
    expect(JSON.parse(bulk.data.get('testStore.items')!.json)).toHaveLength(30);
  });

  it('prefers IndexedDB over the old record once the move has half-completed', async () => {
    // Bulk written, then the worker died before the compact rewrite.
    const legacy = { session: { id: 5 }, flag: false, label: 'old', items: bigItems(30), index: {} };
    compact.data.set('testStore', JSON.parse(JSON.stringify(legacy)));
    await bulk.write([{ key: 'testStore.items', scope: '5', json: JSON.stringify(bigItems(31)), savedAt: 0 }]);

    await persister.hydrate({ migrate: true });
    expect(state.items).toHaveLength(31);
  });

  it('does not overwrite fields the port delivered while hydration was reading', async () => {
    compact.data.set('testStore', { session: { id: 1 }, flag: false, label: 'stale' });
    await bulk.write([{ key: 'testStore.items', scope: '1', json: JSON.stringify(bigItems(3)), savedAt: 0 }]);
    const delivered = new Set(['label', 'items']);
    state.label = 'fresh';
    state.items = bigItems(1, 99);

    await persister.hydrate({ skip: delivered });
    expect(state.session).toEqual({ id: 1 });
    expect(state.label).toBe('fresh');
    expect(state.items[0].id).toBe(99);
  });

  it('does not overwrite a field a setter changed while hydration was reading', async () => {
    compact.data.set('testStore', { session: { id: 1 }, flag: false, label: 'stale' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const read = bulk.read.bind(bulk);
    bulk.read = async (keys) => { await gate; return read(keys); };

    const hydrating = persister.hydrate();
    await Promise.resolve();
    state.flag = true;
    persister.markDirty(['flag']);
    release();
    await hydrating;
    expect(state.flag).toBe(true);
  });

  it('treats an unreadable storage as empty rather than failing', async () => {
    compact.get = async () => { throw new Error('storage unavailable'); };
    bulk.read = async () => { throw new Error('IndexedDB unavailable'); };
    await expect(persister.hydrate()).resolves.toBeNull();
    expect(state).toEqual(fresh());
  });
});

// Reproduced in review against the first version of this change: an upgrade whose
// IndexedDB writes fail must still persist a lock or logout, and a legacy record's
// bulk data must never land under a different wallet's session.
function walletFixture() {
  const records = new Map<string, unknown>();
  const rows = new Map<string, StoreCacheEntry>();
  const compact: CompactStorage = {
    async get(key) { return structuredClone(records.get(key)); },
    async set(key, value) { records.set(key, structuredClone(value)); },
  };
  const bulk: BulkStorage = {
    async read() { return new Map(rows); },
    async write(entries) { entries.forEach((entry) => rows.set(entry.key, entry)); },
  };
  const state = { loggedWallet: null as { id: number } | null, isLocked: false, transactions: [] as { tx_hash: string }[] };
  const create = (target = state) => new StorePersister(target, {
    storeName: 'walletStore',
    bulkFields: ['transactions'],
    immediateFields: ['loggedWallet', 'isLocked'],
    scope: (s) => String((s['loggedWallet'] as { id: number } | null)?.id ?? ''),
    compact,
    bulk,
  });
  return { records, rows, compact, bulk, state, create };
}

describe('StorePersister upgrade path', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(['lock', 'logout'] as const)('persists an explicit %s even when the initial legacy migration cannot write IndexedDB', async (action) => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = walletFixture();
    f.records.set('walletStore', { loggedWallet: { id: 1 }, isLocked: false, transactions: [{ tx_hash: 'wallet-A-tx' }] });
    f.bulk.write = async () => { throw new Error('IndexedDB unavailable'); };
    const p = f.create();
    await p.hydrate({ migrate: true });
    await p.flush();

    if (action === 'logout') {
      // WalletStore.logout broadcasts all cleared fields in one update.
      Object.assign(f.state, { loggedWallet: null, isLocked: false, transactions: [] });
      p.markDirty(['loggedWallet', 'isLocked', 'transactions']);
    } else {
      f.state.isLocked = true;
      p.markDirty(['isLocked']);
    }
    await p.flush();

    const restarted = { loggedWallet: null as { id: number } | null, isLocked: false, transactions: [] as { tx_hash: string }[] };
    await f.create(restarted).hydrate();
    if (action === 'logout') expect(restarted.loggedWallet).toBeNull();
    else expect(restarted.isLocked).toBe(true);
  });

  it('keeps the legacy history recoverable while IndexedDB keeps failing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = walletFixture();
    f.records.set('walletStore', { loggedWallet: { id: 1 }, isLocked: false, transactions: [{ tx_hash: 'wallet-A-tx' }] });
    f.bulk.write = async () => { throw new Error('IndexedDB unavailable'); };
    const p = f.create();
    await p.hydrate({ migrate: true });
    await p.flush();
    f.state.isLocked = true;
    p.markDirty(['isLocked']);
    await p.flush();

    const restarted = { loggedWallet: null as { id: number } | null, isLocked: false, transactions: [] as { tx_hash: string }[] };
    await f.create(restarted).hydrate();
    expect(restarted.transactions).toEqual([{ tx_hash: 'wallet-A-tx' }]);
  });

  it('does not apply legacy wallet A history after a port delivers wallet B during hydration', async () => {
    const f = walletFixture();
    f.records.set('walletStore', { loggedWallet: { id: 1 }, isLocked: false, transactions: [{ tx_hash: 'wallet-A-tx' }] });
    let finishRead!: (rows: Map<string, StoreCacheEntry>) => void;
    let readStarted!: () => void;
    const started = new Promise<void>((resolve) => { readStarted = resolve; });
    f.bulk.read = () => { readStarted(); return new Promise((resolve) => { finishRead = resolve; }); };
    const deliveredFields = new Set<string>();
    const hydration = f.create().hydrate({ skip: deliveredFields });
    await started;

    // Wallet switching broadcasts loggedWallet before the new data loaders finish.
    f.state.loggedWallet = { id: 2 };
    deliveredFields.add('loggedWallet');
    finishRead(new Map());
    await hydration;

    expect(f.state.loggedWallet).toEqual({ id: 2 });
    expect(f.state.transactions).toEqual([]);
  });

  // Runtime and auto-lock handlers are live while background startup awaits
  // hydrateWalletStore(), so writes can land in the middle of the upgrade.
  it('preserves the only legacy history copy if a lock is persisted while initial IndexedDB hydration is still pending', async () => {
    vi.useFakeTimers();
    const history = [{ tx_hash: 'legacy-bitcoin-history' }];
    const f = walletFixture();
    f.records.set('walletStore', { loggedWallet: { id: 1 }, isLocked: false, transactions: history });
    let finishRead!: (value: Map<string, StoreCacheEntry>) => void;
    let signalReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => { signalReadStarted = resolve; });
    f.bulk.read = () => { signalReadStarted(); return new Promise((resolve) => { finishRead = resolve; }); };
    const persister = f.create();
    const hydration = persister.hydrate({ migrate: true });
    await readStarted;
    expect(f.state.loggedWallet).toEqual({ id: 1 });

    f.state.isLocked = true;
    persister.markDirty(['isLocked']);
    await persister.flush();

    // Snapshot durable storage at a worker interruption before the read/migration finishes.
    const durableAtInterruption = structuredClone(f.records.get('walletStore'));
    const cachedAtInterruption = new Map(f.rows);
    finishRead(new Map());
    await hydration;
    await persister.flush();

    // Restart from exactly the interrupted state.
    f.records.set('walletStore', durableAtInterruption);
    const restarted = { loggedWallet: null as { id: number } | null, isLocked: false, transactions: [] as { tx_hash: string }[] };
    const fromInterruption = new StorePersister(restarted, {
      storeName: 'walletStore',
      bulkFields: ['transactions'],
      scope: (s) => String((s['loggedWallet'] as { id: number } | null)?.id ?? ''),
      compact: f.compact,
      bulk: { async read() { return cachedAtInterruption; }, async write() {} },
    });
    await fromInterruption.hydrate();
    expect(restarted.isLocked).toBe(true);
    expect(restarted.transactions).toEqual(history);
  });

  it('never replaces the old record before hydration has read it, and every state it passes through restores the session', async () => {
    const history = [{ tx_hash: 'legacy-bitcoin-history' }];
    const legacy = { loggedWallet: { id: 1 }, isLocked: false, transactions: history };
    const f = walletFixture();
    f.records.set('walletStore', structuredClone(legacy));
    // Every durable state the upgrade leaves behind, in order.
    const snapshots: { record: unknown; rows: Map<string, StoreCacheEntry> }[] = [];
    const set = f.compact.set.bind(f.compact);
    f.compact.set = async (key, value) => {
      await set(key, value);
      snapshots.push({ record: structuredClone(f.records.get(key)), rows: new Map(f.rows) });
    };
    let finishCompactRead!: () => void;
    const get = f.compact.get.bind(f.compact);
    const gate = new Promise<void>((resolve) => { finishCompactRead = resolve; });
    f.compact.get = async (key) => { const value = await get(key); await gate; return value; };

    const persister = f.create();
    const hydration = persister.hydrate({ migrate: true });
    // A lock lands before the stored record has even been read.
    f.state.isLocked = true;
    persister.markDirty(['isLocked']);
    const flushing = persister.flush();
    await Promise.resolve();
    expect(f.records.get('walletStore')).toEqual(legacy);

    finishCompactRead();
    await flushing;
    await hydration;
    await persister.flush();

    expect(snapshots.length).toBeGreaterThan(0);
    for (const { record, rows } of snapshots) {
      const restarted = { loggedWallet: null as { id: number } | null, isLocked: false, transactions: [] as { tx_hash: string }[] };
      await new StorePersister(restarted, {
        storeName: 'walletStore',
        bulkFields: ['transactions'],
        scope: (s) => String((s['loggedWallet'] as { id: number } | null)?.id ?? ''),
        compact: { async get() { return structuredClone(record); }, async set() {} },
        bulk: { async read() { return rows; }, async write() {} },
      }).hydrate();
      expect(restarted).toEqual({ loggedWallet: { id: 1 }, isLocked: true, transactions: history });
    }
  });
});

// Review of 328f28dc: held legacy values must follow their session. Every change,
// landing before the compact read completes or during the bulk read, with cache
// writes succeeding or failing, must leave a durable state that restores exactly
// what the store held at that moment.
type MatrixState = { loggedWallet: { id: number } | null; isLocked: boolean; transactions: { tx_hash: string }[] };
const freshMatrix = (): MatrixState => ({ loggedWallet: null, isLocked: false, transactions: [] });
const matrixScope = (s: Record<string, unknown>) => {
  const id = (s['loggedWallet'] as { id: number } | null)?.id;
  return id == null ? null : String(id);
};

describe('durable state during pending legacy hydration', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  for (const phase of ['compact-read', 'bulk-read'] as const) {
    for (const failWrite of [false, true]) {
      it.each(['lock', 'switch', 'logout', 'history-update'] as const)(`${phase}, cache writes ${failWrite ? 'fail' : 'succeed'}, %s`, async (action) => {
        vi.useFakeTimers();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const legacy: MatrixState = { loggedWallet: { id: 1 }, isLocked: false, transactions: [{ tx_hash: 'wallet-A-old' }] };
        let record: unknown = structuredClone(legacy);
        const rows = new Map<string, StoreCacheEntry>();
        let releaseCompact!: () => void;
        const compactGate = new Promise<void>((resolve) => { releaseCompact = resolve; });
        let releaseBulk!: (value: Map<string, StoreCacheEntry>) => void;
        let signalBulk!: () => void;
        const bulkStarted = new Promise<void>((resolve) => { signalBulk = resolve; });
        const compact: CompactStorage = {
          async get() { const snapshot = structuredClone(record); if (phase === 'compact-read') await compactGate; return snapshot; },
          async set(_key, value) { record = structuredClone(value); },
        };
        const bulk: BulkStorage = {
          read() { signalBulk(); return new Promise((resolve) => { releaseBulk = resolve; }); },
          async write(entries) {
            if (failWrite) throw new Error('IndexedDB unavailable');
            entries.forEach((entry) => rows.set(entry.key, structuredClone(entry)));
          },
        };
        const state = freshMatrix();
        const p = new StorePersister(state, { storeName: 'walletStore', bulkFields: ['transactions'], immediateFields: ['loggedWallet', 'isLocked'], scope: matrixScope, compact, bulk });
        const hydrating = p.hydrate({ migrate: true });
        if (phase === 'bulk-read') await bulkStarted;

        const expected = structuredClone(legacy);
        if (action === 'lock') {
          state.isLocked = true;
          expected.isLocked = true;
          p.markDirty(['isLocked']);
        } else if (action === 'switch') {
          // clearForWalletSwitch() clears bulk fields without broadcasting/marking them.
          state.transactions = [];
          state.loggedWallet = { id: 2 };
          expected.loggedWallet = { id: 2 };
          expected.transactions = [];
          p.markDirty(['loggedWallet']);
        } else if (action === 'logout') {
          Object.assign(state, freshMatrix());
          Object.assign(expected, freshMatrix());
          p.markDirty(['loggedWallet', 'isLocked', 'transactions']);
        } else {
          state.transactions = [{ tx_hash: 'wallet-A-new' }];
          expected.transactions = structuredClone(state.transactions);
          p.markDirty(['transactions']);
        }
        const flushing = p.flush();
        releaseCompact();
        await bulkStarted;
        await flushing;

        // Simulate interruption now, before the initial bulk read returns.
        const durable = structuredClone(record);
        const durableRows = new Map(rows);
        releaseBulk(new Map());
        await hydrating;
        await p.flush();

        const restarted = freshMatrix();
        await new StorePersister(restarted, {
          storeName: 'walletStore', bulkFields: ['transactions'], scope: matrixScope,
          compact: { async get() { return durable; }, async set() {} },
          bulk: { async read() { return durableRows; }, async write() {} },
        }).hydrate();
        expect(restarted).toEqual(expected);
      });
    }
  }
});
