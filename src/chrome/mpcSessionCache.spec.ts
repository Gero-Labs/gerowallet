import { describe, it, expect, beforeEach } from 'vitest';
import { mpcSessionCache } from './mpcSessionCache';

describe('mpcSessionCache', () => {
  beforeEach(() => {
    mpcSessionCache.clearAll();
  });

  it('get returns undefined for a wallet that was never set', () => {
    expect(mpcSessionCache.get(1)).toBeUndefined();
  });

  it('set then get returns the same bytes', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    mpcSessionCache.set(1, bytes);
    expect(mpcSessionCache.get(1)).toBe(bytes);
  });

  it('keeps separate entries per walletId', () => {
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2]);
    mpcSessionCache.set(1, a);
    mpcSessionCache.set(2, b);
    expect(mpcSessionCache.get(1)).toBe(a);
    expect(mpcSessionCache.get(2)).toBe(b);
  });

  it('clear removes only the given wallet', () => {
    mpcSessionCache.set(1, new Uint8Array([1]));
    mpcSessionCache.set(2, new Uint8Array([2]));
    mpcSessionCache.clear(1);
    expect(mpcSessionCache.get(1)).toBeUndefined();
    expect(mpcSessionCache.get(2)).toBeDefined();
  });

  it('clearAll removes every entry', () => {
    mpcSessionCache.set(1, new Uint8Array([1]));
    mpcSessionCache.set(2, new Uint8Array([2]));
    mpcSessionCache.clearAll();
    expect(mpcSessionCache.get(1)).toBeUndefined();
    expect(mpcSessionCache.get(2)).toBeUndefined();
  });
});
