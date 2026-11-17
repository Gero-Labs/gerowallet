import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPrivateSyncCheckpoint,
  loadPrivateSyncCheckpoint,
  loadWalletState,
  midnightWalletStatesForTest,
  resetMidnightWalletStateDbForTest,
  savePrivateSyncCheckpoint,
  saveWalletState,
} from './midnightWalletStatePersistence';

vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));

// The ledger 9 private sync resumes from its own row: a shielded state and the
// history saved with it. It is not the `shielded` row, which the shielded send
// path also writes, with no history.
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

const privateRow = async () => (await midnightWalletStatesForTest().toArray()).find(r => r.kind === 'shielded-sync9')!;

describe('private sync checkpoint', () => {
  it('round-trips a state with the history saved with it', async () => {
    await savePrivateSyncCheckpoint(ns, seed, { state: 'state-1', history: 'history-1' });
    expect(await loadPrivateSyncCheckpoint(ns, seed)).toEqual({ state: 'state-1', history: 'history-1' });
  });

  it('never resumes from the send path\'s `shielded` row, which has no history', async () => {
    await saveWalletState(ns, 'shielded', seed, 'newer-state-from-a-send');
    expect(await loadPrivateSyncCheckpoint(ns, seed)).toBeNull();
    await savePrivateSyncCheckpoint(ns, seed, { state: 'state-1', history: 'history-1' });
    expect(await loadPrivateSyncCheckpoint(ns, seed)).toEqual({ state: 'state-1', history: 'history-1' });
  });

  it('refuses another wallet\'s row, a damaged row and another format', async () => {
    await savePrivateSyncCheckpoint(ns, seed, { state: 'state-1', history: 'history-1' });
    expect(await loadPrivateSyncCheckpoint(ns, otherSeed)).toBeNull();
    const row = await privateRow();
    for (const serializedState of ['{not json', JSON.stringify({ v: 2, state: 's', history: 'h' }),
      JSON.stringify({ v: 1, state: '', history: 'h' }), JSON.stringify({ v: 1, state: 's' })]) {
      await midnightWalletStatesForTest().put({ ...row, serializedState });
      expect(await loadPrivateSyncCheckpoint(ns, seed)).toBeNull();
    }
  });

  it('does not write an empty state', async () => {
    await savePrivateSyncCheckpoint(ns, seed, { state: '', history: 'history-1' });
    expect(await midnightWalletStatesForTest().count()).toBe(0);
  });

  it('clearing drops only this wallet\'s private sync row, never the send path\'s `shielded` row', async () => {
    for (const s of [seed, otherSeed]) await savePrivateSyncCheckpoint(ns, s, { state: 'state-1', history: 'history-1' });
    await saveWalletState(ns, 'shielded', seed, 'send-path-state');
    await clearPrivateSyncCheckpoint(ns, seed);
    expect(await loadPrivateSyncCheckpoint(ns, seed)).toBeNull();
    expect(await loadWalletState(ns, 'shielded', seed)).toBe('send-path-state');
    expect(await loadPrivateSyncCheckpoint(ns, otherSeed)).toEqual({ state: 'state-1', history: 'history-1' });
  });
});
