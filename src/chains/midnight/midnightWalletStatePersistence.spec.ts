import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllWalletState,
  clearWalletState,
  loadWalletState,
  midnightWalletStatesForTest,
  purgeLegacyChromeWalletState,
  resetMidnightWalletStateDbForTest,
  saveWalletState,
} from './midnightWalletStatePersistence';

vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));

const seed = new Uint8Array(32).fill(7);
const otherSeed = new Uint8Array(32).fill(9);
let local: Map<string, unknown>;

beforeEach(async () => {
  local = new Map();
  vi.stubGlobal('chrome', {
    runtime: { id: 'ext-id' },
    storage: { local: {
      get: async (key: string | null) => (key === null ? Object.fromEntries(local) : local.has(key) ? { [key]: local.get(key) } : {}),
      set: async (items: Record<string, unknown>) => { for (const [k, v] of Object.entries(items)) local.set(k, v); },
      remove: async (keys: string | string[]) => { for (const k of Array.isArray(keys) ? keys : [keys]) local.delete(k); },
    } },
  });
  resetMidnightWalletStateDbForTest();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('gero-midnight-wallet-state');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

describe('Midnight wallet state storage', () => {
  it('keeps state in its own IndexedDB, never in chrome.storage.local', async () => {
    await saveWalletState('preprod', 'shielded', seed, 'zswap-state');
    expect(await loadWalletState('preprod', 'shielded', seed)).toBe('zswap-state');
    expect([...local.keys()].filter((k) => k.startsWith('midnight_wallet_state'))).toEqual([]);
  });

  it('keeps wallets, kinds and networks apart', async () => {
    await saveWalletState('preprod', 'shielded', seed, 'a');
    expect(await loadWalletState('preprod', 'shielded', otherSeed)).toBeNull();
    expect(await loadWalletState('preprod', 'dust', seed)).toBeNull();
    expect(await loadWalletState('mainnet', 'shielded', seed)).toBeNull();
  });

  it('never restores a blob from chrome.storage.local, and deletes the legacy copies on upgrade', async () => {
    // The key a wallet's state lives under, then a profile that only has old-release copies.
    await saveWalletState('preprod', 'shielded', seed, 'probe');
    const [row] = await midnightWalletStatesForTest().toArray();
    resetMidnightWalletStateDbForTest();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('gero-midnight-wallet-state');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
    const legacy = { schemaVersion: row.schemaVersion, network: row.network, kind: row.kind, serializedState: 'planted', savedAt: 1 };
    local.set(row.key, legacy);
    local.set('midnight_wallet_state_mainnet_dust_abc', legacy);
    local.set('geroStore', { untouched: true });

    expect(await loadWalletState('preprod', 'shielded', seed)).toBeNull();
    await purgeLegacyChromeWalletState();
    expect([...local.keys()]).toEqual(['geroStore']);
  });

  it('purges only once per profile', async () => {
    await purgeLegacyChromeWalletState();
    local.set('midnight_wallet_state_preprod_dust_x', { serializedState: 'later' });
    resetMidnightWalletStateDbForTest();
    await purgeLegacyChromeWalletState();
    expect(local.has('midnight_wallet_state_preprod_dust_x')).toBe(true); // ignored, not re-scanned
    expect(await loadWalletState('preprod', 'dust', seed)).toBeNull();
  });

  it('clears one wallet, one network, or everything', async () => {
    await saveWalletState('preprod', 'shielded', seed, 'p1');
    await saveWalletState('preprod', 'dust', seed, 'p2');
    await saveWalletState('mainnet', 'shielded', seed, 'm1');

    await clearWalletState('preprod', 'dust', seed);
    expect(await loadWalletState('preprod', 'dust', seed)).toBeNull();
    expect(await loadWalletState('preprod', 'shielded', seed)).toBe('p1');

    await clearAllWalletState('preprod');
    expect(await loadWalletState('preprod', 'shielded', seed)).toBeNull();
    expect(await loadWalletState('mainnet', 'shielded', seed)).toBe('m1');

    await clearAllWalletState();
    expect(await loadWalletState('mainnet', 'shielded', seed)).toBeNull();
  });
});

describe('Midnight provider checkpoint migration', () => {
  const setStoredSchema = async (version: number) => {
    const table = midnightWalletStatesForTest();
    const [row] = await table.toArray();
    await table.put({ ...row, schemaVersion: version });
    return row.key;
  };

  it.each(['mainnet', 'preprod'] as const)('discards old-provider %s checkpoints and restores new ones', async (network) => {
    for (const kind of ['dust', 'shielded', 'unshielded'] as const) {
      await midnightWalletStatesForTest().clear();
      await saveWalletState(network, kind, seed, 'old-provider-state');
      const key = await setStoredSchema(1);
      expect(await loadWalletState(network, kind, seed)).toBeNull();
      expect((await midnightWalletStatesForTest().get(key))?.serializedState).toBe('old-provider-state');
      await saveWalletState(network, kind, seed, 'new-provider-state');
      expect((await midnightWalletStatesForTest().get(key))?.schemaVersion).toBe(2);
      expect(await loadWalletState(network, kind, seed)).toBe('new-provider-state');
    }
  });

  it('retains mainnet checkpoints made against the current provider', async () => {
    await saveWalletState('mainnet', 'dust', seed, 'mainnet-state');
    const [row] = await midnightWalletStatesForTest().toArray();
    expect(row.schemaVersion).toBe(2);
    expect(await loadWalletState('mainnet', 'dust', seed)).toBe('mainnet-state');
  });

  it('retains stagenet checkpoints', async () => {
    await saveWalletState('stagenet', 'dust', seed, 'stagenet-state');
    const [row] = await midnightWalletStatesForTest().toArray();
    expect(row.schemaVersion).toBe(1);
    expect(await loadWalletState('stagenet', 'dust', seed)).toBe('stagenet-state');
  });
});
