// midnightStore persistence, driven through the real store module.
//
// Every changed chrome.storage.local value is copied (old and new) on Chrome's
// browser UI thread into every storage.onChanged listener, including the Bring
// SDK in every frame of every tab. midnightStore used to rewrite its whole
// snapshot there on each update, and a Midnight tip arrives every few seconds,
// so the transaction history (each row carrying its proof-laden tx hex) went
// through that path over and over. The first case is that regression; the rest
// hold what the split must keep: BigInt revival, the viewing-key scrub, the
// per-wallet scope, and the background's durable-preference boot guard.
//
// Waits are real timers, so the same file also exercises the pre-split code,
// where the first case fails.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MidnightAddresses, MidnightTransaction, MidnightUnshieldedUtxo } from '@/chains/midnight/midnightTypes';

const env = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  const sets: Record<string, unknown>[] = [];
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  // Both call forms: the persister uses promises, other callers a callback.
  const local = {
    get: (key: string | string[], cb?: (r: Record<string, unknown>) => void) => {
      const out: Record<string, unknown> = {};
      for (const k of typeof key === 'string' ? [key] : key) if (data.has(k)) out[k] = clone(data.get(k));
      if (cb) { setTimeout(() => cb(out), 0); return undefined; }
      return Promise.resolve(out);
    },
    set: (items: Record<string, unknown>, cb?: () => void) => {
      sets.push(clone(items));
      Object.entries(items).forEach(([k, v]) => data.set(k, clone(v)));
      if (cb) { cb(); return undefined; }
      return Promise.resolve();
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { local }, runtime: {} };
  return {
    data,
    sets,
    context: 'background' as 'background' | 'browser',
    broadcasts: [] as Record<string, unknown>[],
    subscribers: new Map<string, (u: Record<string, unknown>) => void>(),
  };
});

vi.mock('@/utils/storageSync', () => ({ getContextType: () => env.context }));
vi.mock('@/chrome/storeMessagingBg', () => ({
  default: { broadcastUpdate: (_store: string, updates: Record<string, unknown>) => env.broadcasts.push(updates) },
}));
vi.mock('@/services/storeMessaging.service', () => ({
  default: {
    subscribe: (store: string, cb: (u: Record<string, unknown>) => void) => {
      env.subscribers.set(store, cb);
      return () => env.subscribers.delete(store);
    },
  },
}));
vi.mock('@/utils/storeCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/storeCache')>();
  return { ...actual, writeStoreCache: vi.fn(actual.writeStoreCache) };
});

const hex = (n: number, seed: number) => Array.from({ length: n }, (_, i) => ((seed * 31 + i * 7) % 16).toString(16)).join('');
const addresses = (body: string): MidnightAddresses => ({ dust: `mn_dust_preprod1${body}`, shielded: `mn_shield-addr_preprod1${body}`, unshielded: `mn_addr_preprod1${body}` });

function history(count: number): MidnightTransaction[] {
  return Array.from({ length: count }, (_, i) => ({
    hash: hex(64, i), type: 'receive', token: 'NIGHT', amount: BigInt(1_000_000 + i), counterparty: `mn_addr_preprod1${hex(40, i)}`,
    timestamp: 1_758_000_000_000 + i, status: 'confirmed', fee: BigInt(i), blockHeight: 100_000 + i, isShielded: false,
    raw: hex(2_000, i), // serialized tx; real ones carry ZK proofs and are larger
  }));
}

function utxoSet(count: number): MidnightUnshieldedUtxo[] {
  return Array.from({ length: count }, (_, i) => ({
    owner: 'mn_addr_preprod1abc', tokenType: hex(64, 0), value: BigInt(5_000_000 + i), intentHash: hex(64, i + 900),
    outputIndex: i % 4, initialNonce: hex(64, i + 1_900), registeredForDustGeneration: i % 2 === 0,
  }));
}

const settle = () => new Promise((r) => setTimeout(r, 500));

async function waitFor(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** A fresh module graph = a restarted worker (or a newly opened page) over the same storage. */
async function load(context: 'background' | 'browser') {
  env.context = context;
  vi.resetModules();
  const store = await import('./midnightStore');
  const cache = await import('@/utils/storeCache');
  return { ...store, cache };
}

type Loaded = Awaited<ReturnType<typeof load>>;

async function seed(m: Loaded, body = 'abc', txCount = 1_500) {
  m.midnightActions.setActive(addresses(body));
  m.midnightActions.setTransactions(history(txCount));
  m.midnightActions.setUtxos(utxoSet(200));
  await settle();
}

describe('midnightStore persistence', () => {
  let m: Loaded | undefined;

  beforeEach(async () => {
    m?.cache.resetStoreCacheForTest?.();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('gero-store-cache');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
    env.data.clear();
    env.sets.length = 0;
    env.broadcasts.length = 0;
    m = await load('background');
  });

  it('a tip update beside a large transaction history writes only a small chrome.storage record', async () => {
    await seed(m!);
    const writeStoreCache = m!.cache.writeStoreCache as unknown as ReturnType<typeof vi.fn>;
    writeStoreCache.mockClear();
    env.sets.length = 0;
    env.broadcasts.length = 0;

    for (let i = 0; i < 5; i++) {
      m!.midnightActions.applyTipUpdate({ hash: hex(64, 7_000 + i), height: 200_000 + i, timestamp: 1_758_000_100_000 + i });
      m!.midnightActions.markSynced();
      await settle();
    }

    expect(env.broadcasts.every((u) => Object.keys(u).every((k) => k === 'tip' || k === 'lastSync'))).toBe(true);
    expect(env.sets.length).toBeGreaterThan(0);
    for (const items of env.sets) {
      const record = items['midnightStore'] as Record<string, unknown>;
      expect(JSON.stringify(items).length).toBeLessThan(8_192);
      expect(record).not.toHaveProperty('transactions');
      expect(record).not.toHaveProperty('utxos');
    }
    expect(writeStoreCache).not.toHaveBeenCalled();
  });

  it('a UI context revives the IndexedDB history with its BigInts', async () => {
    await seed(m!, 'abc', 300);
    const ui = await load('browser');
    await waitFor(() => ui.midnightStore.transactions.length === 300);

    expect(ui.midnightStore.activeWalletKey).toBe('mn_addr_preprod1abc');
    expect(typeof ui.midnightStore.transactions[0].amount).toBe('bigint');
    expect(typeof ui.midnightStore.transactions[0].fee).toBe('bigint');
    expect(ui.midnightStore.transactions[0].raw).toBe(hex(2_000, 0));
    expect(ui.midnightStore.utxos).toHaveLength(200);
    expect(typeof ui.midnightStore.utxos[0].value).toBe('bigint');
  });

  it('still reads a record in the old single-value format, with the viewing key scrubbed', async () => {
    const legacy = JSON.parse(JSON.stringify({
      isActive: true, activeWalletKey: 'mn_addr_preprod1old', networkStatus: 'connected',
      addresses: { ...addresses('old'), zswapViewingKey: 'mn_shield-esk_preprod1secret' },
      transactions: history(20), utxos: utxoSet(5), balances: { nightUnshielded: '42' },
    }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
    env.data.set('midnightStore', legacy);

    const ui = await load('browser');
    await waitFor(() => ui.midnightStore.transactions.length === 20);
    expect(ui.midnightStore.addresses).not.toHaveProperty('zswapViewingKey');
    expect(ui.midnightStore.shieldedSyncAvailable).toBe(true);
    expect(ui.midnightStore.balances.nightUnshielded).toBe(42n);
    expect(typeof ui.midnightStore.utxos[0].value).toBe('bigint');
  });

  it('never shows the previous wallet history, even when its IndexedDB rewrite failed', async () => {
    await seed(m!, 'aaa', 50);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // The switch's own history write fails, leaving wallet A's rows in IndexedDB.
    (m!.cache.writeStoreCache as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.reject(new Error('IndexedDB unavailable')));
    m!.midnightActions.setActive(addresses('bbb'));
    await settle();

    const ui = await load('browser');
    await waitFor(() => ui.midnightStore.activeWalletKey === 'mn_addr_preprod1bbb');
    await settle();
    expect(ui.midnightStore.transactions).toEqual([]);
    expect(ui.midnightStore.utxos).toEqual([]);
    vi.restoreAllMocks();
  });

  it('keeps durable preferences across a worker restart', async () => {
    m!.midnightActions.setProofServer({
      mode: 'local', localUrl: 'http://localhost:6399', localUrlLedger9: 'http://localhost:6300',
      zkpaasUrl: '', zkpaasApiKey: '', zkpaasApiSecret: '',
    });
    await settle();

    const restarted = await load('background');
    await waitFor(() => restarted.midnightStore.proofServer.mode === 'local');
    restarted.midnightActions.applyTipUpdate({ hash: 'h', height: 1, timestamp: 1 });
    await settle();
    const record = env.data.get('midnightStore') as { proofServer: { mode: string; localUrl: string } };
    expect(record.proofServer).toMatchObject({ mode: 'local', localUrl: 'http://localhost:6399' });
  });

  it('an immediate write before the restarted worker has read its record keeps the durable preferences', async () => {
    const chainIdentity = { network: 'midnight-preprod', generation: 2, genesisHash: `0x${'ab'.repeat(32)}` };
    m!.midnightActions.setProofServer({
      mode: 'local', localUrl: 'http://localhost:6399', localUrlLedger9: 'http://localhost:6300',
      zkpaasUrl: '', zkpaasApiKey: '', zkpaasApiSecret: '',
    });
    m!.midnightActions.resetChainState(chainIdentity);
    await settle();

    // walletManager.initializeWallet can activate Midnight on the worker's first tick,
    // before the boot read of the stored record has landed.
    const restarted = await load('background');
    restarted.midnightActions.setActive(addresses('abc'));
    await settle();

    const record = env.data.get('midnightStore') as { proofServer: { mode: string }; chainIdentity: unknown; isActive: boolean };
    expect(record.isActive).toBe(true);
    expect(record.proofServer).toMatchObject({ mode: 'local', localUrl: 'http://localhost:6399' });
    expect(record.chainIdentity).toEqual(chainIdentity);
    expect(restarted.midnightStore.chainIdentity).toEqual(chainIdentity);
  });
});
