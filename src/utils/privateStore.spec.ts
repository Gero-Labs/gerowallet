import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPrivate,
  getPrivateEntries,
  getPrivateMany,
  moveFromChromeLocal,
  removePrivate,
  resetPrivateStoreForTest,
  setPrivate,
  setPrivateMany,
} from './privateStore';

const local = new Map<string, unknown>();

beforeEach(async () => {
  local.clear();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => (local.has(key) ? { [key]: JSON.parse(JSON.stringify(local.get(key))) } : {}),
        remove: async (key: string | string[]) => {
          (Array.isArray(key) ? key : [key]).forEach((k) => local.delete(k));
        },
      },
    },
  };
  resetPrivateStoreForTest();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('gero-private-store');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

describe('privateStore', () => {
  it('stores, lists and removes values', async () => {
    await setPrivate('wc@2:core', { a: 1 });
    await setPrivateMany([{ key: 'wc@2:keychain', value: 'k' }, { key: 'other', value: 2 }]);
    expect(await getPrivate('wc@2:core')).toEqual({ a: 1 });
    expect((await getPrivateEntries('wc@2:')).map(([k]) => k).sort()).toEqual(['wc@2:core', 'wc@2:keychain']);
    expect([...(await getPrivateMany(['other', 'missing'])).entries()]).toEqual([['other', 2]]);
    await removePrivate('other');
    expect(await getPrivate('other')).toBeUndefined();
  });

  it('moves an older release\'s chrome.storage copy across, then deletes it', async () => {
    local.set('crossDeviceIdentity', { deviceId: 'd' });
    expect(await moveFromChromeLocal('crossDeviceIdentity')).toEqual({ deviceId: 'd' });
    expect(await getPrivate('crossDeviceIdentity')).toEqual({ deviceId: 'd' });
    expect(local.has('crossDeviceIdentity')).toBe(false);
  });

  it('keeps its own value over a chrome.storage copy, which it deletes', async () => {
    await setPrivate('crossDeviceIdentity', { deviceId: 'mine' });
    local.set('crossDeviceIdentity', { deviceId: 'planted' });
    expect(await moveFromChromeLocal('crossDeviceIdentity')).toEqual({ deviceId: 'mine' });
    expect(local.has('crossDeviceIdentity')).toBe(false);
  });

  it('answers undefined when neither holds the key', async () => {
    expect(await moveFromChromeLocal('nothing')).toBeUndefined();
  });

  it('moves once: a value planted in chrome.storage after the move is never adopted', async () => {
    expect(await moveFromChromeLocal('crossDeviceIdentity')).toBeUndefined(); // first read after the upgrade
    local.set('crossDeviceIdentity', { deviceId: 'planted' });
    expect(await moveFromChromeLocal('crossDeviceIdentity')).toBeUndefined();
    expect(await getPrivate('crossDeviceIdentity')).toBeUndefined();
    expect(local.has('crossDeviceIdentity')).toBe(false);
  });

  it('does not adopt again after a real move and a later delete', async () => {
    local.set('geroNexusTokens', { accessToken: 'old' });
    expect(await moveFromChromeLocal('geroNexusTokens')).toEqual({ accessToken: 'old' });
    await removePrivate('geroNexusTokens');
    local.set('geroNexusTokens', { accessToken: 'planted' });
    expect(await moveFromChromeLocal('geroNexusTokens')).toBeUndefined();
  });
});
