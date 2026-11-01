// The relay identity lives in the extension's private IndexedDB: content scripts
// can read and write chrome.storage.local, where older releases kept it.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { loadOrCreateDeviceIdentity } from './deviceIdentityStore';
import { deviceIdFromPubKey, generateDeviceKeypair } from './deviceIdentity';
import { getPrivate, resetPrivateStoreForTest } from '@/utils/privateStore';

const local = new Map<string, unknown>();

beforeEach(async () => {
  local.clear();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => (local.has(key) ? { [key]: local.get(key) } : {}),
        set: async (items: Record<string, unknown>) => Object.entries(items).forEach(([k, v]) => local.set(k, v)),
        remove: async (key: string | string[]) => (Array.isArray(key) ? key : [key]).forEach((k) => local.delete(k)),
      },
    },
  };
  resetPrivateStoreForTest();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('gero-private-store');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

describe('device identity storage', () => {
  it('keeps a new identity out of chrome.storage.local', async () => {
    const id = await loadOrCreateDeviceIdentity();
    expect(local.size).toBe(0);
    expect(await getPrivate('crossDeviceIdentity')).toEqual(id);
    expect(await loadOrCreateDeviceIdentity()).toEqual(id);
  });

  it('moves an older release\'s identity across, keeping the device id the phone pinned', async () => {
    const kp = generateDeviceKeypair();
    const legacy = { deviceId: deviceIdFromPubKey(kp.pubKeyHex), ...kp };
    local.set('crossDeviceIdentity', legacy);

    expect(await loadOrCreateDeviceIdentity()).toEqual(legacy);
    expect(local.has('crossDeviceIdentity')).toBe(false);
    expect(await getPrivate('crossDeviceIdentity')).toEqual(legacy);
  });

  it('ignores an identity planted in chrome.storage.local once it has its own', async () => {
    const mine = await loadOrCreateDeviceIdentity();
    const kp = generateDeviceKeypair();
    local.set('crossDeviceIdentity', { deviceId: deviceIdFromPubKey(kp.pubKeyHex), ...kp });

    expect(await loadOrCreateDeviceIdentity()).toEqual(mine);
    expect(local.has('crossDeviceIdentity')).toBe(false);
  });
});
