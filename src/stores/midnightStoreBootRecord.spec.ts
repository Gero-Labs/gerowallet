// The previous worker's record across service-worker restarts (issue 1471),
// through the real store module and persister: what a restarted worker saves
// before sync delivers anything, and what a chain reset then shows.
//
// Each case uses its own wallet and waits for the previous case's debounced
// writes to land: fake IndexedDB and leftover timers outlive a case.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MidnightAddresses, MidnightTransaction, MidnightUnshieldedUtxo } from '@/chains/midnight/midnightTypes';

const env = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const local = {
    get: (key: string | string[], cb?: (r: Record<string, unknown>) => void) => {
      const out: Record<string, unknown> = {};
      for (const k of typeof key === 'string' ? [key] : key) if (data.has(k)) out[k] = clone(data.get(k));
      if (cb) { setTimeout(() => cb(out), 0); return undefined; }
      return Promise.resolve(out);
    },
    set: (items: Record<string, unknown>, cb?: () => void) => {
      Object.entries(items).forEach(([k, v]) => data.set(k, clone(v)));
      if (cb) { cb(); return undefined; }
      return Promise.resolve();
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { local }, runtime: {} };
  return { data, context: 'background' as 'background' | 'browser', broadcasts: [] as Record<string, unknown>[] };
});

vi.mock('@/utils/storageSync', () => ({ getContextType: () => env.context }));
vi.mock('@/chrome/storeMessagingBg', () => ({
  default: { broadcastUpdate: (_store: string, updates: Record<string, unknown>) => env.broadcasts.push(updates) },
}));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: () => () => undefined } }));

import { hasDataToKeep } from '@/chains/midnight/midnightRefresh';

const hex = (n: number, seed: number) => Array.from({ length: n }, (_, i) => ((seed * 31 + i * 7) % 16).toString(16)).join('');
const addresses = (body: string): MidnightAddresses => ({
  dust: `mn_dust_preprod1${body}`, shielded: `mn_shield-addr_preprod1${body}`, unshielded: `mn_addr_preprod1${body}`,
});
function history(count: number): MidnightTransaction[] {
  return Array.from({ length: count }, (_, i) => ({
    hash: hex(64, i), type: 'receive', token: 'NIGHT', amount: BigInt(1_000_000 + i), counterparty: `mn_addr_preprod1${hex(40, i)}`,
    timestamp: 1_758_000_000_000 + i, status: 'confirmed', fee: BigInt(i), blockHeight: 100_000 + i, isShielded: false,
  }));
}
function utxoSet(count: number): MidnightUnshieldedUtxo[] {
  return Array.from({ length: count }, (_, i) => ({
    owner: 'mn_addr_preprod1abc', tokenType: hex(64, 0), value: BigInt(5_000_000 + i), intentHash: hex(64, i + 900),
    outputIndex: i % 4, initialNonce: hex(64, i + 1_900), registeredForDustGeneration: i % 2 === 0,
  }));
}
/** Past the persister's 300 ms debounce. */
const settle = () => new Promise((r) => setTimeout(r, 500));
/** A fresh module graph = a restarted worker over the same storage. */
async function load(context: 'background' | 'browser' = 'background') {
  env.context = context;
  vi.resetModules();
  return import('./midnightStore');
}
type Loaded = Awaited<ReturnType<typeof load>>;

const sent = (hash: string, extra: Partial<MidnightTransaction> = {}): MidnightTransaction => ({
  hash, type: 'send', token: 'NIGHT', amount: 9n, counterparty: 'mn_addr_preprod1to',
  timestamp: 1_758_000_100_000, status: 'pending', fee: 0n, isShielded: false, ...extra,
});
const P1 = 'e1'.repeat(32);

/** As the sync service's reset callback decides what to keep (midnight-sync.service.ts). */
async function resetLikeTheService(r: Loaded, generation = 7) {
  const inMemory = r.midnightStore.refreshSnapshot || hasDataToKeep(r.midnightStore.balances, r.midnightStore.transactions);
  const persisted = inMemory ? null : await r.midnightActions.persistedRefreshSnapshot();
  r.midnightActions.resetChainState({ network: 'midnight-preprod', generation, genesisHash: `0x${'ab'.repeat(32)}` }, { persisted, reason: 'upgrade' });
}

describe('the previous worker\'s record across restarts', () => {
  let n = 0;
  let wallet = '';
  let m: Loaded;

  beforeEach(async () => {
    await settle(); // the previous case's debounced writes land first
    env.data.clear();
    env.broadcasts.length = 0;
    n += 1;
    wallet = `boot${n}`;
    m = await load();
  });

  /** The worker before the restart: a wallet with history, UTxOs, NIGHT and DUST state. */
  async function previousWorker(pending: MidnightTransaction[] = []) {
    m.midnightActions.setActive(addresses(wallet));
    m.midnightActions.setTransactions(history(3));
    m.midnightActions.setUtxos(utxoSet(5));
    m.midnightActions.updateBalances({ nightUnshielded: 7_000_000n });
    m.midnightActions.applyTipUpdate({ hash: 'cd'.repeat(32), height: 4_242, timestamp: 1_758_000_200_000 });
    pending.forEach((tx) => m.midnightActions.applyTransaction(tx));
    await settle();
  }

  /** A restarted worker logs the wallet in; no sync frame arrives (offline, or the sync server is down). */
  async function restartOffline(): Promise<Loaded> {
    const r = await load();
    r.midnightActions.setActive(addresses(wallet));
    await r.midnightActions.restoreRefreshAfterRestart();
    await settle();
    return r;
  }

  it('the first write after a restart saves the previous balances, tip and history, not empty defaults', async () => {
    await previousWorker();
    await restartOffline();
    const saved = env.data.get('midnightStore') as { balances: { nightUnshielded: string }; tip: { height: number } };
    expect(saved.balances.nightUnshielded).toBe('7000000');
    expect(saved.tip.height).toBe(4_242);
  });

  it('two restarts with no sync in between, then a reset as the first frame: "Refreshing" shows the wallet', async () => {
    await previousWorker();
    await restartOffline();
    const r2 = await restartOffline();
    await resetLikeTheService(r2);
    expect(r2.midnightStore.refreshSnapshot?.transactions).toHaveLength(3);
    expect(r2.midnightStore.refreshSnapshot?.balances.nightUnshielded).toBe(7_000_000n);
    expect(r2.midnightStore.refreshSnapshot?.utxos).toHaveLength(5);
  });

  it('a send recorded after a restart is saved with the history, not over it', async () => {
    await previousWorker();
    const r1 = await restartOffline();
    r1.midnightActions.applyTransaction(sent(P1));
    await settle();
    // The views get the history too, not the one row.
    const last = env.broadcasts.filter((u) => 'transactions' in u).at(-1) as { transactions: unknown[] };
    expect(last.transactions).toHaveLength(4);
    const r2 = await restartOffline();
    await resetLikeTheService(r2);
    // The snapshot is what the wallet showed; the pending send is the reset's to keep or drop.
    expect(r2.midnightStore.refreshSnapshot?.transactions.map((t) => t.status)).toEqual(['confirmed', 'confirmed', 'confirmed']);
    expect(r2.midnightStore.refreshSnapshot?.balances.nightUnshielded).toBe(7_000_000n);
  });

  it('once this worker holds its own data, it is saved as it is', async () => {
    await previousWorker();
    const r = await restartOffline();
    r.midnightActions.setTransactions(history(1));
    r.midnightActions.updateBalances({ nightUnshielded: 1n });
    await settle();
    const saved = env.data.get('midnightStore') as { balances: { nightUnshielded: string } };
    expect(saved.balances.nightUnshielded).toBe('1');
    const restarted = await load();
    restarted.midnightActions.setActive(addresses(wallet));
    expect((await restarted.midnightActions.persistedRefreshSnapshot())?.transactions).toHaveLength(1);
  });

  it('a reset saves its own emptied state: the record has served', async () => {
    await previousWorker();
    const r = await restartOffline();
    await resetLikeTheService(r);
    await settle();
    const saved = env.data.get('midnightStore') as { balances: { nightUnshielded: string } };
    expect(saved.balances.nightUnshielded).toBe('0');
    await expect(r.midnightActions.persistedRefreshSnapshot()).resolves.toBeNull();
  });

  it('the snapshot built from the record leaves pending rows out', async () => {
    await previousWorker([sent(P1)]);
    const r = await load();
    r.midnightActions.setActive(addresses(wallet));
    const snapshot = await r.midnightActions.persistedRefreshSnapshot();
    expect(snapshot?.transactions.map((t) => t.hash)).not.toContain(P1);
    expect(snapshot?.transactions).toHaveLength(3);
  });

  it('the end of a refresh carries the snapshot\'s shielded rows, never a pending one', async () => {
    m.midnightActions.setActive(addresses(wallet));
    m.midnightActions.setTransactions([...history(2), { ...history(3)[2], isShielded: true }, sent(P1, { isShielded: true })]);
    m.midnightActions.updateBalances({ nightShielded: 3n });
    m.midnightActions.resetChainState({ network: 'midnight-preprod', generation: 8, genesisHash: `0x${'ab'.repeat(32)}` });
    m.midnightActions.endRefresh();
    const hashes = m.midnightStore.transactions.map((t) => t.hash);
    expect(hashes).toContain(history(3)[2].hash);
    expect(hashes).not.toContain(P1);
  });

  it('a removed wallet\'s record never reaches a re-import of its seed', async () => {
    await previousWorker([sent(P1)]);
    const r = await load();
    r.midnightActions.setActive(addresses(wallet));
    r.midnightActions.forgetWallet(addresses(wallet).unshielded);
    r.midnightActions.setActive(addresses(wallet));
    await expect(r.midnightActions.persistedRefreshSnapshot()).resolves.toBeNull();
  });

  it('another wallet never gets the record', async () => {
    await previousWorker();
    const r = await load();
    r.midnightActions.setActive(addresses(`${wallet}other`));
    await expect(r.midnightActions.persistedRefreshSnapshot()).resolves.toBeNull();
    await resetLikeTheService(r);
    expect(r.midnightStore.refreshSnapshot).toBeNull();
  });

  it('a wallet of another chain lets the record go when it starts', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const manager = readFileSync(join(__dirname, '../services/walletManager.service.ts'), 'utf8');
    expect(manager).toMatch(/if \(walletBg\.chain !== Blockchain\.MIDNIGHT\) \{\n\s+void import\('@\/stores\/midnightStore'\)\.then\(\(\{ midnightActions \}\) => midnightActions\.releaseBootRecord\(\)\)/);
  });

  /**
   * The first replay frame after a restart, for a wallet emptied from another
   * device while the worker was down (no DUST registration, so every balance is
   * zero): its settled history, no UTxOs, zero balances. `balancesFirst` sends
   * the UTxO set and balances before the history rows land, the other order
   * after. Then the release, as the sync service does after each frame.
   */
  function emptiedElsewhereFrame(r: Loaded, balancesFirst: boolean) {
    const rows = [...history(3), { ...sent('f0'.repeat(32)), status: 'confirmed' as const, blockHeight: 100_010 }];
    const zero = () => { r.midnightActions.setUtxos([]); r.midnightActions.updateBalances({ nightUnshielded: 0n }); };
    if (balancesFirst) zero();
    rows.forEach((tx) => r.midnightActions.applyTransaction(tx));
    if (!balancesFirst) zero();
    if (hasDataToKeep(r.midnightStore.balances, r.midnightStore.transactions)) r.midnightActions.releaseBootRecord();
  }
  const lastSent = <T,>(field: string) => (env.broadcasts.filter((u) => field in u).at(-1) as Record<string, T>)[field];

  for (const balancesFirst of [true, false]) {
    it(`emptied from another device while down: the views and the saved record end at zero (${balancesFirst ? 'balances' : 'history'} first)`, async () => {
      await previousWorker();
      const r = await restartOffline();
      // Before any frame the views were shown the previous worker's figures.
      expect(lastSent<{ nightUnshielded: string }>('balances').nightUnshielded).toBe('7000000');
      expect(lastSent<unknown[]>('utxos')).toHaveLength(5);
      emptiedElsewhereFrame(r, balancesFirst);
      expect(lastSent<{ nightUnshielded: string }>('balances').nightUnshielded).toBe('0');
      expect(lastSent<unknown[]>('utxos')).toEqual([]);
      await settle();
      const saved = env.data.get('midnightStore') as { balances: { nightUnshielded: string } };
      expect(saved.balances.nightUnshielded).toBe('0');
      // A later restart finds the emptied wallet, not the old figures.
      const restarted = await load();
      restarted.midnightActions.setActive(addresses(wallet));
      const snapshot = await restarted.midnightActions.persistedRefreshSnapshot();
      expect(snapshot?.balances.nightUnshielded).toBe(0n);
      expect(snapshot?.utxos).toEqual([]);
    });
  }

  it('released with nothing stood in, nothing is sent again', async () => {
    m.midnightActions.setActive(addresses(wallet));
    m.midnightActions.setTransactions(history(1));
    const before = env.broadcasts.length;
    m.midnightActions.releaseBootRecord();
    expect(env.broadcasts).toHaveLength(before);
  });

  it('released, nothing stands in any more', async () => {
    await previousWorker();
    const r = await load();
    r.midnightActions.setActive(addresses(wallet));
    r.midnightActions.releaseBootRecord();
    await expect(r.midnightActions.persistedRefreshSnapshot()).resolves.toBeNull();
  });
});
