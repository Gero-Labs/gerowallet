// walletStore / networkStore persistence, driven through the real store modules
// in the worker context (the only context that writes).
//
// Chrome copies the old and new value of every changed chrome.storage.local key
// into every storage.onChanged listener, on its browser UI thread. Rewriting the
// whole store on each update pushed tens of MB through that path per write and
// froze every Chrome window. The first case is that regression; the rest hold
// the restart, upgrade and session-change behaviour the split must keep.
//
// Waits are real timers (settle), so the same file also exercises the pre-split
// code, where the first case fails.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const env = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  const sets: Record<string, unknown>[] = [];
  const local = {
    get: async (key: string | string[]) => {
      const out: Record<string, unknown> = {};
      for (const k of typeof key === 'string' ? [key] : key) {
        if (data.has(k)) out[k] = JSON.parse(JSON.stringify(data.get(k)));
      }
      return out;
    },
    set: async (items: Record<string, unknown>) => {
      sets.push(JSON.parse(JSON.stringify(items)));
      Object.entries(items).forEach(([k, v]) => data.set(k, JSON.parse(JSON.stringify(v))));
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local },
    alarms: { getAll: (cb: (a: unknown[]) => void) => cb([]), clear: () => {} },
    runtime: {},
  };
  return {
    data,
    sets,
    context: 'background' as 'background' | 'browser',
    broadcasts: [] as { store: string; updates: Record<string, unknown> }[],
    subscribers: new Map<string, (u: Record<string, unknown>) => void>(),
  };
});

vi.mock('@/utils/storageSync', () => ({ getContextType: () => env.context }));
vi.mock('@/chrome/storeMessagingBg', () => ({
  default: { broadcastUpdate: (store: string, updates: Record<string, unknown>) => env.broadcasts.push({ store, updates }) },
}));
vi.mock('@/services/storeMessaging.service', () => ({
  default: {
    subscribe: (store: string, cb: (u: Record<string, unknown>) => void) => {
      env.subscribers.set(store, cb);
      return () => env.subscribers.delete(store);
    },
  },
}));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: () => Promise.resolve(), disconnect: () => {} } }));
vi.mock('@/utils/storeCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/storeCache')>();
  return { ...actual, writeStoreCache: vi.fn(actual.writeStoreCache) };
});

const BULK = ['transactions', 'utxos', 'tokens', 'collections', 'programmableTokens', 'rewards', 'keys'];
const hex = (n: number, seed: number) => Array.from({ length: n }, (_, i) => ((seed * 31 + i * 7) % 16).toString(16)).join('');

/** Nested shapes like the real ones: deserialized tx bodies, witness maps, UTxO asset Maps. */
function bigWallet(txCount: number, seed = 1) {
  const transactions = Array.from({ length: txCount }, (_, i) => ({
    tx_hash: hex(64, i + seed), block_height: 10_000_000 + i, cbor: hex(1200, i),
    utxo: {
      inputs: [{ address: `addr_test1${hex(50, i)}`, amount: [{ unit: 'lovelace', quantity: String(i * 1000) }], tx_hash: hex(64, i), output_index: 0 }],
      outputs: [{ address: `addr_test1${hex(50, i + 1)}`, amount: [{ unit: 'lovelace', quantity: String(i * 900) }], output_index: 0 }],
    },
    body: { inputs: [{ txId: hex(64, i), index: 0 }], outputs: [{ address: `addr_test1${hex(50, i)}`, value: { coins: String(i), assets: { [hex(56, i)]: '1' } } }], fee: '170000' },
    witness: { signatures: { [hex(64, i)]: hex(128, i) } },
    assets: [{ unit: 'lovelace', quantity: i, metadata: { decimals: 6, ticker: 'ADA' } }],
  }));
  const utxos = Array.from({ length: 40 }, (_, i) => [
    { txId: hex(64, i + 500), index: i % 3, address: 'addr_test1q' },
    { address: 'addr_test1q', value: { coins: BigInt(2_000_000 + i), assets: new Map([[hex(56, i) + '01', BigInt(i + 1)]]) } },
  ]);
  const tokens = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [hex(60, i), { quantity: String(i), metadata: { name: `T${i}`, logo: hex(400, i) } }]));
  const collections = { [hex(56, 9)]: { name: 'NFTs', items: Array.from({ length: 30 }, (_, i) => ({ unit: hex(60, i), onchain_metadata: { name: `#${i}`, image: `ipfs://${hex(46, i)}` } })) } };
  const rewards = Array.from({ length: 50 }, (_, i) => ({ epoch: 300 + i, amount: String(i * 10) }));
  const keys = { payment: [{ address: 'addr_test1q', path: "m/1852'/1815'/0'/0/0" }], stake: [], change: [] };
  return { transactions, utxos, tokens, collections, rewards, keys };
}

const settle = async (mod?: { flushWalletStorePersistence?: () => Promise<void> }) => {
  await new Promise((r) => setTimeout(r, 500));
  await mod?.flushWalletStorePersistence?.();
};

/** A fresh module graph = a restarted service worker over the same storage. */
async function startWorker() {
  vi.resetModules();
  const wallet = await import('./walletStore');
  const network = await import('./networkStore');
  const cache = await import('@/utils/storeCache');
  return { wallet, network, cache };
}

type Worker = Awaited<ReturnType<typeof startWorker>>;

async function seedWallet(w: Worker, id: number, txCount = 400) {
  const big = bigWallet(txCount, id);
  w.wallet.default.setLoggedWallet({ id, chain: 'Cardano', name: `W${id}` });
  w.wallet.default.setKeys(big.keys as never);
  w.wallet.default.setTransactions(big.transactions);
  await w.wallet.default.setUtxos(big.utxos as never);
  w.wallet.default.setTokens(big.tokens);
  w.wallet.default.setCollections(big.collections);
  w.wallet.default.setRewards(big.rewards);
  await settle(w.wallet);
  return big;
}

const lastRecord = (key: string) => env.data.get(key) as Record<string, unknown> | undefined;

async function wipeCache(w?: Worker) {
  w?.cache.resetStoreCacheForTest?.();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('gero-store-cache');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

describe('store persistence in the worker', () => {
  let w: Worker | undefined;

  beforeEach(async () => {
    await wipeCache(w);
    env.data.clear();
    env.sets.length = 0;
    env.broadcasts.length = 0;
    env.context = 'background';
    w = await startWorker();
  });

  it('a tiny recurring update beside large data writes and broadcasts only that flag', async () => {
    await seedWallet(w!, 1);
    const writeStoreCache = w!.cache.writeStoreCache as unknown as ReturnType<typeof vi.fn>;
    writeStoreCache.mockClear();
    env.sets.length = 0;
    env.broadcasts.length = 0;

    for (let i = 0; i < 5; i++) {
      w!.wallet.default.setSyncing(i % 2 === 0);
      await settle(w!.wallet);
    }

    expect(env.broadcasts).toEqual(
      [true, false, true, false, true].map((isSyncing) => ({ store: 'walletStore', updates: { isSyncing } })),
    );
    expect(env.sets.length).toBeGreaterThan(0);
    for (const items of env.sets) {
      const record = items['walletStore'] as Record<string, unknown>;
      expect(JSON.stringify(items).length).toBeLessThan(4096);
      BULK.forEach((field) => expect(record).not.toHaveProperty(field));
    }
    expect(writeStoreCache).not.toHaveBeenCalled();
  });

  it('a new block writes the tip without rewriting the asset map', async () => {
    const assets = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [hex(60, i), { asset: hex(60, i), onchain_metadata: { name: `#${i}`, attributes: { a: i } } }]));
    w!.network.default.setAssets(assets);
    w!.network.default.setTip({ blockNo: 1, slot: 10, hash: 'a', time: 1, epoch: 500, epoch_slot: 1 } as never);
    await settle();
    const writeStoreCache = w!.cache.writeStoreCache as unknown as ReturnType<typeof vi.fn>;
    writeStoreCache.mockClear();
    env.sets.length = 0;

    w!.network.default.setTip({ blockNo: 2, slot: 30, hash: 'b', time: 2, epoch: 500, epoch_slot: 21 } as never);
    await settle();

    expect(env.sets).toHaveLength(1);
    expect(env.sets[0]['networkStore']).not.toHaveProperty('assets');
    expect((env.sets[0]['networkStore'] as { tip: { blockNo: number } }).tip.blockNo).toBe(2);
    expect(writeStoreCache).not.toHaveBeenCalled();
  });

  it('a restarted worker hydrates the full store from the split layout', async () => {
    const big = await seedWallet(w!, 1);
    const serialized = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x instanceof Map ? Object.fromEntries(x) : x)));

    w = await startWorker();
    await w.wallet.hydrateWalletStore();
    const s = w.wallet.walletStore;
    expect(s.loggedWallet.id).toBe(1);
    expect(s.transactions).toEqual(serialized(big.transactions));
    expect(s.utxos).toEqual(serialized(big.utxos));
    expect(s.tokens).toEqual(serialized(big.tokens));
    expect(s.collections).toEqual(serialized(big.collections));
    expect(s.rewards).toEqual(serialized(big.rewards));
    expect(s.keys).toEqual(serialized(big.keys));
  });

  it('upgrades a record in the old single-value format without losing data', async () => {
    const big = bigWallet(200, 4);
    const legacy = JSON.parse(JSON.stringify({
      loggedWallet: { id: 4, chain: 'Bitcoin' }, isLocked: false, isSyncing: false, account: null,
      config: { currency: 'usd' }, contacts: {}, connectedDapps: [], ...big,
      utxos: [], programmableTokens: {}, programmableLockedLovelace: '0', collateral: null,
    }));
    env.data.set('walletStore', legacy);

    await w!.wallet.hydrateWalletStore();
    expect(w!.wallet.walletStore.transactions).toHaveLength(200);
    await settle(w!.wallet);

    const record = lastRecord('walletStore')!;
    BULK.forEach((field) => expect(record).not.toHaveProperty(field));
    expect(record['loggedWallet']).toEqual({ id: 4, chain: 'Bitcoin' });

    // Bitcoin history lives only here (no Dexie table), so it must come back after a restart.
    w = await startWorker();
    await w.wallet.hydrateWalletStore();
    expect(w.wallet.walletStore.transactions).toEqual(legacy.transactions);
  });

  it('after logout a restarted worker is logged out and holds no wallet data', async () => {
    await seedWallet(w!, 1);
    w!.wallet.default.logout();
    await settle(w!.wallet);

    w = await startWorker();
    await w.wallet.hydrateWalletStore();
    expect(w.wallet.walletStore.loggedWallet).toBeNull();
    expect(w.wallet.walletStore.transactions).toEqual([]);
    expect(w.wallet.walletStore.tokens).toEqual({});
  });

  it('a wallet switch cut short by a worker restart never shows the previous wallet data', async () => {
    await seedWallet(w!, 1);
    w!.wallet.default.clearForWalletSwitch();
    w!.wallet.default.setLoggedWallet({ id: 2, chain: 'Cardano', name: 'W2' });
    await settle(w!.wallet);

    w = await startWorker();
    await w.wallet.hydrateWalletStore();
    expect(w.wallet.walletStore.loggedWallet.id).toBe(2);
    expect(w.wallet.walletStore.transactions).toEqual([]);
  });

  it('a UI context keeps what the port delivered over what hydration reads back', async () => {
    await seedWallet(w!, 1, 50);
    env.context = 'browser';
    vi.resetModules();
    const hydrated = import('./walletStore');
    const ui = await hydrated;
    // The port can deliver before the IndexedDB read resolves.
    env.subscribers.get('walletStore')!({ transactions: [{ tx_hash: 'fresh' }] });
    await ui.hydrateWalletStore();

    expect(ui.walletStore.loggedWallet.id).toBe(1);
    expect(ui.walletStore.transactions).toEqual([{ tx_hash: 'fresh' }]);
    expect(ui.walletStore.tokens).not.toEqual({});
  });
});
