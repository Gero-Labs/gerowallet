// The shared TTL memo. Each case below is a property the governance surfaces
// depend on; the failure mode of each is a page that refetches, blanks, or pins
// an error it should have forgotten.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTtlCache } from './ttlCache';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ttlCache', () => {
  it('loads once and serves the same promise inside the window', async () => {
    const load = vi.fn(async () => 'value');
    const cache = createTtlCache<string>(1000);

    const a = cache.get('k', load);
    const b = cache.get('k', load);

    expect(await a).toBe('value');
    expect(await b).toBe('value');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight request between callers on the same tick', async () => {
    // The reason the PROMISE is cached and not the value: two components
    // mounting together must not race two identical requests.
    let resolve!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>(r => (resolve = r)));
    const cache = createTtlCache<string>(1000);

    const both = Promise.all([cache.get('k', load), cache.get('k', load)]);
    resolve('value');

    expect(await both).toEqual(['value', 'value']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads once the entry is stale', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    const load = vi.fn(async () => 'value');
    const cache = createTtlCache<string>(1000);

    await cache.get('k', load);
    now.mockReturnValue(999);
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1001);
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keys are independent', async () => {
    const load = vi.fn(async () => 'value');
    const cache = createTtlCache<string>(1000);

    await cache.get('a', load);
    await cache.get('b', load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failure', async () => {
    // A transient outage must not pin an error for the whole TTL — the next
    // mount has to be able to succeed.
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce('value');
    const cache = createTtlCache<string>(1000);

    await expect(cache.get('k', load)).rejects.toThrow('down');
    await expect(cache.get('k', load)).resolves.toBe('value');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest key past the bound', async () => {
    const load = vi.fn(async () => 'value');
    const cache = createTtlCache<string>(1000, 2);

    await cache.get('a', load);
    await cache.get('b', load);
    await cache.get('c', load);

    // 'a' went out; 'b' and 'c' are still held.
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
  });

  it('forgets one key and clears them all', async () => {
    const load = vi.fn(async () => 'value');
    const cache = createTtlCache<string>(1000);

    await cache.get('a', load);
    await cache.get('b', load);

    cache.forget('a');
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);

    cache.clear();
    expect(cache.has('b')).toBe(false);
  });

  it('reports a stale entry as absent', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    const cache = createTtlCache<string>(1000);
    await cache.get('k', async () => 'value');

    expect(cache.has('k')).toBe(true);
    now.mockReturnValue(2000);
    expect(cache.has('k')).toBe(false);
  });
});
