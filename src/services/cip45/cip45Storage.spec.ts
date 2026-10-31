import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getPrivate, resetPrivateStoreForTest } from '@/utils/privateStore';
import { cip45Storage } from './cip45Storage';

const local = new Map<string, unknown>();

beforeEach(async () => {
  local.clear();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => (local.has(key) ? { [key]: local.get(key) } : {}),
        set: async (items: Record<string, unknown>) => { for (const [k, v] of Object.entries(items)) local.set(k, v); },
        remove: async (key: string) => { local.delete(key); },
      },
    },
  };
  resetPrivateStoreForTest();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('gero-private-store');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
});

describe('CIP-45 storage', () => {
  it('writes pairings to the private store, never to chrome.storage.local', async () => {
    await cip45Storage.set({ cip45Pairings: [{ dappPeerId: 'p', walletId: 'w1' }], cip45PeerId: 'gero-1' });
    expect(local.size).toBe(0);
    expect(await cip45Storage.get(['cip45Pairings', 'cip45PeerId'])).toEqual({
      cip45Pairings: [{ dappPeerId: 'p', walletId: 'w1' }],
      cip45PeerId: 'gero-1',
    });
  });

  it('carries an older release\'s pairings over once', async () => {
    local.set('cip45Pairings', [{ dappPeerId: 'old', walletId: 'w1' }]);
    expect(await cip45Storage.get('cip45Pairings')).toEqual({ cip45Pairings: [{ dappPeerId: 'old', walletId: 'w1' }] });
    expect(local.has('cip45Pairings')).toBe(false);
    expect(await getPrivate('cip45Pairings')).toEqual([{ dappPeerId: 'old', walletId: 'w1' }]);
  });

  it('never resumes a pairing planted in chrome.storage.local after the move', async () => {
    expect(await cip45Storage.get('cip45Pairings')).toEqual({});
    local.set('cip45Pairings', [{ dappPeerId: 'attacker', walletId: 'w1' }]);
    expect(await cip45Storage.get('cip45Pairings')).toEqual({});
    expect(local.has('cip45Pairings')).toBe(false);
  });
});
