import { afterEach, describe, expect, it, vi } from 'vitest';
import { canCheckForExtensionUpdate, checkForExtensionUpdate, restartExtensionForUpdate } from './extensionUpdate';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const withRuntime = (runtime: Record<string, unknown>) => vi.stubGlobal('chrome', { runtime });

describe('Check for update', () => {
  it('is not offered where the browser has no update check', async () => {
    expect(canCheckForExtensionUpdate()).toBe(false);
    withRuntime({});
    expect(canCheckForExtensionUpdate()).toBe(false);
    await expect(checkForExtensionUpdate()).resolves.toBe('none');
  });

  it('reports an update the store has', async () => {
    withRuntime({ requestUpdateCheck: (cb: (s: string, d?: { version?: string }) => void) => cb('update_available', { version: '2.9.0' }) });
    expect(canCheckForExtensionUpdate()).toBe(true);
    await expect(checkForExtensionUpdate()).resolves.toBe('available');
  });

  it.each(['no_update', 'throttled', undefined])('reads %s as no update yet', async (status) => {
    withRuntime({ requestUpdateCheck: (cb: (s?: string) => void) => cb(status) });
    await expect(checkForExtensionUpdate()).resolves.toBe('none');
  });

  it('a throwing check, or none at all, still ends in a message', async () => {
    withRuntime({ requestUpdateCheck: () => { throw new Error('not from a store'); } });
    await expect(checkForExtensionUpdate()).resolves.toBe('none');

    vi.useFakeTimers();
    withRuntime({ requestUpdateCheck: () => undefined });
    const pending = checkForExtensionUpdate(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toBe('none');
  });

  it('answers once, even if Chrome calls back after the timeout', async () => {
    vi.useFakeTimers();
    let late: ((s: string) => void) | undefined;
    withRuntime({ requestUpdateCheck: (cb: (s: string) => void) => { late = cb; } });
    const pending = checkForExtensionUpdate(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    late?.('update_available');
    await expect(pending).resolves.toBe('none');
  });

  it('Restart reloads the extension', () => {
    const reload = vi.fn();
    withRuntime({ reload });
    restartExtensionForUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
