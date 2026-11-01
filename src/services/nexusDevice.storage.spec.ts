import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrivate, resetPrivateStoreForTest } from '@/utils/privateStore';

const post = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({ default: { create: () => ({ post }) } }));

import { getNexusAccessToken } from './nexusDevice.service';

const local = new Map<string, unknown>();

beforeEach(async () => {
  local.clear();
  post.mockReset();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: 'ext-id' },
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

describe('Nexus device credentials', () => {
  it('keeps the device id and bearer tokens out of chrome.storage.local', async () => {
    post.mockResolvedValueOnce({ data: { accessToken: 'acc-1', refreshToken: 'ref-1', tokenType: 'Bearer', expiresIn: 3_600_000, deviceId: 'x' } });

    expect(await getNexusAccessToken()).toBe('acc-1');

    expect(local.size).toBe(0);
    expect(typeof await getPrivate('geroNexusDeviceId')).toBe('string');
    expect(await getPrivate('geroNexusTokens')).toMatchObject({ accessToken: 'acc-1', refreshToken: 'ref-1' });
  });

  it('moves credentials an older release left in chrome.storage.local', async () => {
    local.set('geroNexusDeviceId', 'device-from-old-release');
    local.set('geroNexusTokens', { accessToken: 'old-acc', refreshToken: 'old-ref', expiresAt: Date.now() + 3_600_000 });

    expect(await getNexusAccessToken()).toBe('old-acc');

    expect(post).not.toHaveBeenCalled();
    expect(local.has('geroNexusTokens')).toBe(false);
    expect(await getPrivate('geroNexusTokens')).toMatchObject({ accessToken: 'old-acc' });
  });
});
