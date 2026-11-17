import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPrivateSyncCheckpoint,
  loadPrivateSyncCheckpoint,
  loadWalletState,
  midnightWalletStatesForTest,
  resetMidnightWalletStateDbForTest,
  savePrivateHistoryCheckpoint,
  saveWalletState,
} from './midnightWalletStatePersistence';

vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));

// The ledger 9 private sync resumes from a shielded state plus the history saved
// with it. A state without its own history would resume past transactions the
// history never recorded, so only a matching pair restores.
const ns = 'midnight-mainnet-ledger9-sdk2-0xab-3';
const seed = new Uint8Array(32).fill(5);
const otherSeed = new Uint8Array(32).fill(6);

beforeEach(async () => {
  vi.stubGlobal('chrome', {
    runtime: { id: 'ext-id' },
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
  });
  resetMidnightWalletStateDbForTest();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('gero-midnight-wallet-state');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

describe('private sync checkpoint pairing', () => {
  it('restores a state together with the history saved beside it', async () => {
    await savePrivateHistoryCheckpoint(ns, seed, 'state-1', 'history-1');
    await saveWalletState(ns, 'shielded', seed, 'state-1');
    expect(await loadPrivateSyncCheckpoint(ns, seed)).toEqual({ state: 'state-1', history: 'history-1' });
  });

  it('refuses a state newer than its history (written by the send path, or a lost history write)', async () => {
    await savePrivateHistoryCheckpoint(ns, seed, 'state-1', 'history-1');
    await saveWalletState(ns, 'shielded', seed, 'state-2');
    expect(await loadPrivateSyncCheckpoint(ns, seed)).toBeNull();
  });

  it('refuses either half alone', async () => {
    await saveWalletState(ns, 'shielded', seed, 'state-1');
    expect(await loadPrivateSyncCheckpoint(ns, seed)).toBeNull();
    await clearPrivateSyncCheckpoint(ns, seed);
    await savePrivateHistoryCheckpoint(ns, seed, 'state-1', 'history-1');
    expect(await loadPrivateSyncCheckpoint(ns, seed)).toBeNull();
  });

  it('refuses another wallet\'s pair and a damaged history row', async () => {
    await savePrivateHistoryCheckpoint(ns, seed, 'state-1', 'history-1');
    await saveWalletState(ns, 'shielded', seed, 'state-1');
    expect(await loadPrivateSyncCheckpoint(ns, otherSeed)).toBeNull();
    const row = (await midnightWalletStatesForTest().toArray()).find(r => r.kind === 'shielded-history9')!;
    await midnightWalletStatesForTest().put({ ...row, serializedState: '{not json' });
    expect(await loadPrivateSyncCheckpoint(ns, seed)).toBeNull();
    await midnightWalletStatesForTest().put({ ...row, serializedState: JSON.stringify({ v: 2, state: 'x', history: 'h' }) });
    expect(await loadPrivateSyncCheckpoint(ns, seed)).toBeNull();
  });

  it('stores a fingerprint of the state, never the state itself, in the history row', async () => {
    await savePrivateHistoryCheckpoint(ns, seed, 'secret-shielded-state', 'history-1');
    const row = (await midnightWalletStatesForTest().toArray()).find(r => r.kind === 'shielded-history9')!;
    expect(row.serializedState).not.toContain('secret-shielded-state');
    expect(JSON.parse(row.serializedState).state).toMatch(/^[0-9a-f]{64}$/);
  });

  it('clearing drops both halves and leaves other wallets alone', async () => {
    for (const s of [seed, otherSeed]) {
      await savePrivateHistoryCheckpoint(ns, s, 'state-1', 'history-1');
      await saveWalletState(ns, 'shielded', s, 'state-1');
    }
    await clearPrivateSyncCheckpoint(ns, seed);
    expect(await loadWalletState(ns, 'shielded', seed)).toBeNull();
    expect(await loadWalletState(ns, 'shielded-history9', seed)).toBeNull();
    expect(await loadPrivateSyncCheckpoint(ns, otherSeed)).toEqual({ state: 'state-1', history: 'history-1' });
  });
});
