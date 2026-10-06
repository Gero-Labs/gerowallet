import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWalletState, saveWalletState } from './midnightWalletStatePersistence';

vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));

describe('Midnight provider checkpoint migration', () => {
  const seed = new Uint8Array(32).fill(7);
  type StoredState = { schemaVersion: number; serializedState: string };
  let storage: Record<string, StoredState>;

  beforeEach(() => {
    storage = {};
    vi.stubGlobal('chrome', {
      runtime: {},
      storage: { local: {
        get: (key: string, callback: (value: unknown) => void) => callback({ [key]: storage[key] }),
        set: (value: Record<string, StoredState>, callback: () => void) => { Object.assign(storage, value); callback(); },
      } },
    });
  });

  it.each(['mainnet', 'preprod'] as const)('discards old-provider %s checkpoints and restores new ones', async (network) => {
    for (const kind of ['dust', 'shielded', 'unshielded'] as const) {
      storage = {};
      await saveWalletState(network, kind, seed, 'old-provider-state');
      const key = Object.keys(storage)[0];
      storage[key].schemaVersion = 1;
      expect(await loadWalletState(network, kind, seed)).toBeNull();
      expect(storage[key].serializedState).toBe('old-provider-state');
      await saveWalletState(network, kind, seed, 'new-provider-state');
      expect(storage[key].schemaVersion).toBe(2);
      expect(await loadWalletState(network, kind, seed)).toBe('new-provider-state');
    }
  });

  it('retains mainnet checkpoints made against the current provider', async () => {
    await saveWalletState('mainnet', 'dust', seed, 'mainnet-state');
    const key = Object.keys(storage)[0];
    expect(storage[key].schemaVersion).toBe(2);
    expect(await loadWalletState('mainnet', 'dust', seed)).toBe('mainnet-state');
  });

  it('retains stagenet checkpoints', async () => {
    await saveWalletState('stagenet', 'dust', seed, 'stagenet-state');
    const key = Object.keys(storage)[0];
    expect(storage[key].schemaVersion).toBe(1);
    expect(await loadWalletState('stagenet', 'dust', seed)).toBe('stagenet-state');
  });
});
