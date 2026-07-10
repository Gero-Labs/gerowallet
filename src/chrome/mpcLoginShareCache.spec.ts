import { describe, it, expect, beforeEach } from 'vitest';
import { mpcLoginShareCache } from './mpcLoginShareCache';

describe('mpcLoginShareCache', () => {
  beforeEach(() => {
    mpcLoginShareCache.clearAll();
  });

  it('has/get return false/undefined for a wallet that was never set', () => {
    expect(mpcLoginShareCache.has(1)).toBe(false);
    expect(mpcLoginShareCache.get(1)).toBeUndefined();
  });

  it('set then get/has returns the cached share', () => {
    mpcLoginShareCache.set(1, 'login-share-A');
    expect(mpcLoginShareCache.get(1)).toBe('login-share-A');
    expect(mpcLoginShareCache.has(1)).toBe(true);
  });

  it('keeps separate entries per walletId', () => {
    mpcLoginShareCache.set(1, 'share-1');
    mpcLoginShareCache.set(2, 'share-2');
    expect(mpcLoginShareCache.get(1)).toBe('share-1');
    expect(mpcLoginShareCache.get(2)).toBe('share-2');
  });

  it('clear removes only the given wallet', () => {
    mpcLoginShareCache.set(1, 'share-1');
    mpcLoginShareCache.set(2, 'share-2');
    mpcLoginShareCache.clear(1);
    expect(mpcLoginShareCache.has(1)).toBe(false);
    expect(mpcLoginShareCache.has(2)).toBe(true);
  });

  it('clearAll removes every entry', () => {
    mpcLoginShareCache.set(1, 'share-1');
    mpcLoginShareCache.set(2, 'share-2');
    mpcLoginShareCache.clearAll();
    expect(mpcLoginShareCache.has(1)).toBe(false);
    expect(mpcLoginShareCache.has(2)).toBe(false);
  });
});
