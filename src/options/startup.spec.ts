import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForOptionsStartup } from './startup';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('options startup budget', () => {
  it('returns at the deadline and reports only the unfinished operations', async () => {
    let mounted = false;
    const startup = waitForOptionsStartup({
      preferences: async () => {},
      wallet: () => new Promise(() => {}),
      locale: () => new Promise(() => {}),
    }, 5000).then(() => { mounted = true; });
    await vi.advanceTimersByTimeAsync(4999);
    expect(mounted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await startup;
    expect(mounted).toBe(true);
    expect(console.warn).toHaveBeenCalledExactlyOnceWith('[options startup] timed out after 5000ms: wallet, locale');
  });

  it('handles synchronous throws and rejected promises without waiting for the deadline', async () => {
    await waitForOptionsStartup({
      preferences: () => { throw new Error('failed'); },
      wallet: () => Promise.reject(new Error('failed')),
    });
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows late work to finish without mounting twice or leaking a rejection', async () => {
    let reject!: (reason: Error) => void;
    const mount = vi.fn();
    const startup = waitForOptionsStartup({ wallet: () => new Promise((_, fail) => { reject = fail; }) }, 10).then(mount);
    await vi.advanceTimersByTimeAsync(10);
    await startup;
    reject(new Error('late failure'));
    await Promise.resolve();
    await Promise.resolve();
    expect(mount).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
