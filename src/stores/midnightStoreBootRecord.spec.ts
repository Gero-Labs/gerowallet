// The previous worker's record across service-worker restarts (issues 1471 and
// 1470), through the real store module and persister: what a restarted worker
// saves before sync delivers anything, what a chain reset then shows, and where
// pending sends end up.
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
import { keptRowsToCheck, notIncludedAfterReset } from '@/chains/midnight/midnightPendingSends';

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
    // The snapshot is what the wallet showed, with the send the reset keeps, once.
    expect(r2.midnightStore.refreshSnapshot?.transactions.map((t) => t.status)).toEqual(['pending', 'confirmed', 'confirmed', 'confirmed']);
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
    // The reset keeps the pending send; the user dismisses it during the rebuild's end.
    m.midnightActions.dismissPendingTx(P1, 'NIGHT');
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

  it('released, nothing stands in any more', async () => {
    await previousWorker();
    const r = await load();
    r.midnightActions.setActive(addresses(wallet));
    r.midnightActions.releaseBootRecord();
    await expect(r.midnightActions.persistedRefreshSnapshot()).resolves.toBeNull();
  });
});

// Issue 1470: pending sends across restarts, wallet switches and resets.
describe('pending sends and the previous worker\'s record', () => {
  let n = 0;
  let A = '';
  let B = '';
  let m: Loaded;
  const P2 = 'e2'.repeat(32);
  const row = (hash: string, extra: Partial<MidnightTransaction> = {}) => sent(hash, { ledgerHash: true, ...extra });

  beforeEach(async () => {
    await settle(); // the previous case's debounced writes land first
    env.data.clear();
    n += 1;
    A = `pa${n}`;
    B = `pb${n}`;
    m = await load();
  });

  async function previousWorker(body = A, pending: MidnightTransaction[] = [row(P1)]) {
    m.midnightActions.setActive(addresses(body));
    m.midnightActions.setTransactions(history(3));
    m.midnightActions.setUtxos(utxoSet(5));
    m.midnightActions.updateBalances({ nightUnshielded: 7_000_000n });
    pending.forEach((tx) => m.midnightActions.applyTransaction(tx));
    await settle();
  }

  /** A restarted worker as the sync service starts it: the refresh, then the sends; no frame arrives. */
  async function restart(body = A): Promise<Loaded> {
    const r = await load();
    r.midnightActions.setActive(addresses(body));
    await r.midnightActions.restoreRefreshAfterRestart();
    await r.midnightActions.restorePendingAfterRestart();
    return r;
  }

  it('a restored send keeps its reset mark, "not found" and ledger hash, so it is looked up or listed again', async () => {
    await previousWorker(A, [
      row(P1, { beforeReset: { at: 1, upgrade: true } }),
      row(P2, { beforeReset: { at: 1, upgrade: true, notFound: true } }),
    ]);
    const r = await load();
    r.midnightActions.setActive(addresses(A));
    await expect(r.midnightActions.restorePendingAfterRestart()).resolves.toBe(2);
    expect(keptRowsToCheck(r.midnightStore.transactions).map((t) => t.hash)).toEqual([P1]);
    expect(notIncludedAfterReset(r.midnightStore.transactions).map((t) => t.hash)).toEqual([P2]);
  });

  it('dismissed after the restore, with history back in memory: a reset brings it back nowhere', async () => {
    await previousWorker();
    const r = await restart();
    r.midnightActions.setTransactions([...history(3), ...r.midnightStore.transactions]); // the replay landed
    r.midnightActions.dismissPendingTx(P1, 'NIGHT');
    await resetLikeTheService(r);
    expect(r.midnightStore.transactions.map((t) => t.hash)).not.toContain(P1);
    expect(r.midnightStore.refreshSnapshot?.transactions.map((t) => t.hash)).not.toContain(P1);
  });

  it('dismissed after the restore, with a reset as the first frame: not kept, not in the snapshot', async () => {
    await previousWorker();
    const r = await restart();
    r.midnightActions.dismissPendingTx(P1, 'NIGHT');
    await resetLikeTheService(r);
    expect(r.midnightStore.transactions.map((t) => t.hash)).not.toContain(P1);
    expect(r.midnightStore.refreshSnapshot?.transactions.map((t) => t.hash)).not.toContain(P1);
    expect(r.midnightStore.refreshSnapshot?.transactions).toHaveLength(3);
  });

  it('a dismissed shielded send stays out of history when the refresh ends', async () => {
    await previousWorker(A, [row(P1, { isShielded: true })]);
    m.midnightActions.updateBalances({ nightShielded: 3n });
    await settle();
    const r = await restart();
    r.midnightActions.dismissPendingTx(P1, 'NIGHT');
    await resetLikeTheService(r);
    r.midnightActions.endRefresh();
    expect(r.midnightStore.transactions.map((t) => t.hash)).not.toContain(P1);
  });

  it('a reset before the restore keeps the send once, and the restore then adds nothing', async () => {
    await previousWorker();
    const r = await load();
    r.midnightActions.setActive(addresses(A));
    await resetLikeTheService(r);
    expect(r.midnightStore.transactions.filter((t) => t.hash === P1)).toHaveLength(1);
    await expect(r.midnightActions.restorePendingAfterRestart()).resolves.toBe(0);
    expect(r.midnightStore.transactions.filter((t) => t.hash === P1)).toHaveLength(1);
  });

  it('a restored send and a new one: a reset keeps each once, over the wallet\'s balance', async () => {
    await previousWorker();
    const r = await restart();
    r.midnightActions.applyTransaction(row(P2, { timestamp: 1_758_000_200_000 }));
    await resetLikeTheService(r);
    expect(r.midnightStore.transactions.map((t) => t.hash).sort()).toEqual([P1, P2].sort());
    expect(r.midnightStore.refreshSnapshot?.balances.nightUnshielded).toBe(7_000_000n);
  });

  it('another wallet never gets the record\'s sends or snapshot', async () => {
    await previousWorker(A);
    const r = await load();
    r.midnightActions.setActive(addresses(B));
    await expect(r.midnightActions.restorePendingAfterRestart()).resolves.toBe(0);
    await expect(r.midnightActions.persistedRefreshSnapshot()).resolves.toBeNull();
    await resetLikeTheService(r);
    expect(r.midnightStore.transactions).toEqual([]);
    expect(r.midnightStore.refreshSnapshot).toBeNull();
  });

  it('another wallet at the reset keeps its own send only', async () => {
    await previousWorker(A);
    const r = await load();
    r.midnightActions.setActive(addresses(B));
    r.midnightActions.applyTransaction(row(P2));
    await resetLikeTheService(r);
    expect(r.midnightStore.transactions.map((t) => t.hash)).toEqual([P2]);
  });

  it('a switch back to the record\'s wallet before any reset brings its sends back, for it only', async () => {
    await previousWorker(A);
    const r = await load();
    r.midnightActions.setActive(addresses(B));
    await r.midnightActions.restorePendingAfterRestart();
    r.midnightActions.setActive(addresses(A));
    await expect(r.midnightActions.restorePendingAfterRestart()).resolves.toBe(1);
    expect(r.midnightStore.transactions.map((t) => t.hash)).toEqual([P1]);
  });

  it('the record waits for a Midnight login while nothing else has started', async () => {
    await previousWorker(A);
    const r = await load();
    await settle();
    r.midnightActions.setActive(addresses(A));
    await expect(r.midnightActions.persistedRefreshSnapshot()).resolves.not.toBeNull();
  });

  it('a removed wallet\'s sends never reach a re-import of its seed', async () => {
    await previousWorker(A);
    const r = await load();
    r.midnightActions.setActive(addresses(A));
    r.midnightActions.forgetWallet(addresses(A).unshielded);
    r.midnightActions.setActive(addresses(A));
    await expect(r.midnightActions.restorePendingAfterRestart()).resolves.toBe(0);
  });

  it('two restarts with no sync frame between (offline), then a reset: the snapshot still shows the wallet and the send', async () => {
    await previousWorker();
    await restart();
    await settle();
    const r2 = await restart();
    await resetLikeTheService(r2);
    expect(r2.midnightStore.refreshSnapshot?.transactions).toHaveLength(4);
    expect(r2.midnightStore.refreshSnapshot?.balances.nightUnshielded).toBe(7_000_000n);
    expect(r2.midnightStore.transactions.map((t) => t.hash)).toEqual([P1]);
  });

  it('two restarts with no sync frame and no pending send, then a reset: the snapshot shows the wallet', async () => {
    await previousWorker(A, []);
    await restart();
    await settle();
    const r2 = await restart();
    await resetLikeTheService(r2);
    expect(r2.midnightStore.refreshSnapshot?.transactions).toHaveLength(3);
    expect(r2.midnightStore.refreshSnapshot?.balances.nightUnshielded).toBe(7_000_000n);
  });
});
