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

  it.each(['dust', 'shielded', 'unshielded'] as const)('discards old mainnet %s state and restores a new checkpoint', async (kind) => {
    await saveWalletState('mainnet', kind, seed, 'old-provider-state');
    const key = Object.keys(storage)[0];
    storage[key].schemaVersion = 1;
    expect(await loadWalletState('mainnet', kind, seed)).toBeNull();
    expect(storage[key].serializedState).toBe('old-provider-state');
    await saveWalletState('mainnet', kind, seed, 'blockfrost-state');
    expect(await loadWalletState('mainnet', kind, seed)).toBe('blockfrost-state');
  });

  it('retains preprod checkpoints', async () => {
    await saveWalletState('preprod', 'dust', seed, 'preprod-state');
    const key = Object.keys(storage)[0];
    expect(storage[key].schemaVersion).toBe(1);
    expect(await loadWalletState('preprod', 'dust', seed)).toBe('preprod-state');
  });
});
