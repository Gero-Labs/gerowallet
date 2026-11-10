// Issue 1471 across a worker restart, driven through the real store module and
// persister (the harness of midnightStorePersistence.spec.ts, in its own file so
// its IndexedDB starts clean). A chain reset is usually first seen by a worker
// that just restarted, whose memory holds nothing.
//
// (Harness notes from midnightStorePersistence.spec.ts follow.)
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

describe('Refreshing across a worker restart', () => {
  let m: Loaded | undefined;

  beforeEach(async () => {
    env.data.clear();
    env.sets.length = 0;
    env.broadcasts.length = 0;
    m = await load('background');
  });

  // Issue 1471: a chain reset is usually first seen by a worker that just
  // restarted, whose memory holds nothing. "Refreshing" must still show what
  // the wallet last showed, from the persisted record.
  it('a reset right after a worker restart refreshes over the persisted balances, history and UTxOs', async () => {
    await seed(m!, 'abc', 20);
    m!.midnightActions.updateBalances({ nightUnshielded: 7_000_000n, dust: 3n });
    await settle();

    const restarted = await load('background');
    restarted.midnightActions.setActive(addresses('abc'));
    await settle();
    expect(restarted.midnightStore.transactions).toHaveLength(0);

    const persisted = await restarted.midnightActions.persistedRefreshSnapshot();
    expect(persisted?.balances.nightUnshielded).toBe(7_000_000n);
    expect(persisted?.transactions).toHaveLength(20);
    expect(persisted?.utxos).toHaveLength(200);

    const identity = { network: 'midnight-preprod', generation: 5, genesisHash: `0x${'ab'.repeat(32)}` };
    restarted.midnightActions.resetChainState(identity, { persisted });
    expect(restarted.midnightStore.refreshSnapshot?.balances.nightUnshielded).toBe(7_000_000n);
    expect(restarted.midnightStore.refreshSnapshot?.transactions).toHaveLength(20);
    expect(restarted.midnightStore.refreshing).not.toBeNull();
    expect(restarted.midnightStore.balances.nightUnshielded).toBe(0n);

    // Another wallet's record is never taken.
    const other = await load('background');
    other.midnightActions.setActive(addresses('zzz'));
    await settle();
    await expect(other.midnightActions.persistedRefreshSnapshot()).resolves.toBeNull();
  });

  it('a refresh running when the worker stopped comes back after the restart, so it can end', async () => {
    await seed(m!, 'abc', 5);
    m!.midnightActions.updateBalances({ nightUnshielded: 2_000_000n });
    m!.midnightActions.resetChainState({ network: 'midnight-preprod', generation: 6, genesisHash: `0x${'ab'.repeat(32)}` });
    expect(m!.midnightStore.refreshing).not.toBeNull();
    await settle();

    const restarted = await load('background');
    await waitFor(() => restarted.midnightStore.chainIdentity !== null);
    restarted.midnightActions.setActive(addresses('abc'));
    await settle();
    await expect(restarted.midnightActions.restoreRefreshAfterRestart()).resolves.toBe(true);
    expect(restarted.midnightStore.refreshSnapshot?.balances.nightUnshielded).toBe(2_000_000n);
    expect(restarted.midnightStore.refreshing?.stalled).toBe(false);
  });

});
