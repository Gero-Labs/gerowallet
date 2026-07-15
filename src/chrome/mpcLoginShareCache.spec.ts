import { describe, it, expect, beforeEach, vi } from 'vitest';

// Minimal in-memory chrome.storage.session stub (the cache is backed by it).
const store = new Map<string, unknown>();
const sessionStorage = {
  set: vi.fn(async (items: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(items)) store.set(k, v);
  }),
  get: vi.fn(async (query: string | null) => {
    if (query === null) return Object.fromEntries(store);
    return store.has(query) ? { [query]: store.get(query) } : {};
  }),
  remove: vi.fn(async (keys: string | string[]) => {
    for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
  }),
};
// @ts-expect-error minimal chrome global for the test
globalThis.chrome = { storage: { session: sessionStorage } };

import { mpcLoginShareCache } from './mpcLoginShareCache';

describe('mpcLoginShareCache', () => {
  beforeEach(() => {
    store.clear();
  });

  it('has/get return false/undefined for a wallet that was never set', async () => {
    expect(await mpcLoginShareCache.has(1)).toBe(false);
    expect(await mpcLoginShareCache.get(1)).toBeUndefined();
  });

  it('set then get/has returns the cached share', async () => {
    await mpcLoginShareCache.set(1, 'login-share-A');
    expect(await mpcLoginShareCache.get(1)).toBe('login-share-A');
    expect(await mpcLoginShareCache.has(1)).toBe(true);
  });

  it('keeps separate entries per walletId', async () => {
    await mpcLoginShareCache.set(1, 'share-1');
    await mpcLoginShareCache.set(2, 'share-2');
    expect(await mpcLoginShareCache.get(1)).toBe('share-1');
    expect(await mpcLoginShareCache.get(2)).toBe('share-2');
  });

  it('clear removes only the given wallet', async () => {
    await mpcLoginShareCache.set(1, 'share-1');
    await mpcLoginShareCache.set(2, 'share-2');
    await mpcLoginShareCache.clear(1);
    expect(await mpcLoginShareCache.has(1)).toBe(false);
    expect(await mpcLoginShareCache.has(2)).toBe(true);
  });

  it('clearAll removes every cache entry but leaves unrelated session keys', async () => {
    await mpcLoginShareCache.set(1, 'share-1');
    await mpcLoginShareCache.set(2, 'share-2');
    store.set('unrelated', 'keep-me');
    await mpcLoginShareCache.clearAll();
    expect(await mpcLoginShareCache.has(1)).toBe(false);
    expect(await mpcLoginShareCache.has(2)).toBe(false);
    expect(store.get('unrelated')).toBe('keep-me');
  });
});
