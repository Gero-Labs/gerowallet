import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrivate, resetPrivateStoreForTest, setPrivate } from '@/utils/privateStore';

const post = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({ default: { create: () => ({ post }) } }));

import { getNexusAccessToken, reauthenticateNexus } from './nexusDevice.service';

const local = new Map<string, unknown>();

function tokens(access: string, refresh = `ref-${access}`, expiresIn = 3_600_000) {
  return { data: { accessToken: access, refreshToken: refresh, tokenType: 'Bearer', expiresIn, deviceId: 'x' } };
}

/** A POST whose answer the test releases, so callers can pile up while it is in flight. */
function heldPost() {
  let answer!: (value: unknown) => void;
  let fail!: (reason: unknown) => void;
  let called!: () => void;
  const reached = new Promise<void>(resolve => { called = resolve; });
  post.mockImplementationOnce(() => {
    called();
    return new Promise((resolve, reject) => { answer = resolve; fail = reject; });
  });
  return { reached, answer: (value: unknown) => answer(value), fail: (reason: unknown) => fail(reason) };
}

const logins = () => post.mock.calls.filter(([path]) => path === '/api/auth/device');
const refreshes = () => post.mock.calls.filter(([path]) => path === '/api/auth/device/refresh');
/** Long enough for every caller's store reads to finish, so each is waiting on the POST in flight. */
const parked = () => new Promise(resolve => setTimeout(resolve, 50));

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

describe('one device registration for concurrent callers', () => {
  it('sends one POST /api/auth/device, with one device id, for N callers on first start', async () => {
    const login = heldPost();
    const callers = Array.from({ length: 6 }, () => getNexusAccessToken());
    await login.reached;
    await parked();
    login.answer(tokens('acc-1'));

    expect(await Promise.all(callers)).toEqual(Array(6).fill('acc-1'));
    expect(logins()).toHaveLength(1);
    expect(logins()[0][1].deviceId).toBe(await getPrivate('geroNexusDeviceId'));
    // Later callers read the stored tokens: no request at all.
    expect(await getNexusAccessToken()).toBe('acc-1');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('clears the lock after a failed attempt: every waiting caller fails, the next one retries with the same id', async () => {
    const login = heldPost();
    const callers = Array.from({ length: 4 }, () => getNexusAccessToken());
    await login.reached;
    await parked();
    login.fail(new Error('offline'));

    const outcomes = await Promise.allSettled(callers);
    expect(outcomes.map(outcome => outcome.status)).toEqual(Array(4).fill('rejected'));
    expect(logins()).toHaveLength(1);

    post.mockResolvedValueOnce(tokens('acc-2'));
    expect(await getNexusAccessToken()).toBe('acc-2');
    expect(logins()).toHaveLength(2);
    // The id minted before the failed POST is the one registered on retry.
    expect(logins()[1][1].deviceId).toBe(logins()[0][1].deviceId);
  });

  it('refreshes expired tokens once for concurrent callers', async () => {
    await setPrivate('geroNexusDeviceId', 'device-1');
    await setPrivate('geroNexusTokens', { accessToken: 'old', refreshToken: 'ref-old', expiresAt: Date.now() - 1 });
    const refresh = heldPost();
    const callers = Array.from({ length: 5 }, () => getNexusAccessToken());
    await refresh.reached;
    await parked();
    refresh.answer(tokens('acc-new'));

    expect(await Promise.all(callers)).toEqual(Array(5).fill('acc-new'));
    expect(refreshes()).toHaveLength(1);
    expect(logins()).toHaveLength(0);
  });

  it('shares one login between requests rejected together, and with a login already running', async () => {
    await setPrivate('geroNexusDeviceId', 'device-1');
    await setPrivate('geroNexusTokens', { accessToken: 'rejected', refreshToken: 'ref', expiresAt: Date.now() + 3_600_000 });
    const login = heldPost();
    const rejectedTogether = Array.from({ length: 3 }, () => reauthenticateNexus());
    await login.reached;
    await parked();
    const joining = reauthenticateNexus();
    login.answer(tokens('acc-fresh'));

    expect(await Promise.all([...rejectedTogether, joining])).toEqual(Array(4).fill('acc-fresh'));
    expect(logins()).toHaveLength(1);
    expect(logins()[0][1].deviceId).toBe('device-1');
  });

  describe('across extension contexts', () => {
    afterEach(() => { delete (navigator as unknown as { locks?: unknown }).locks; });

    /** Web Locks with one exclusive holder per name, as the browser gives every context. */
    function installLocks() {
      const tails = new Map<string, Promise<unknown>>();
      const request = vi.fn((name: string, callback: (lock: unknown) => unknown) => {
        const run = (tails.get(name) ?? Promise.resolve()).then(() => callback({ name, mode: 'exclusive' }));
        tails.set(name, run.catch(() => undefined));
        return run;
      });
      Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
      return request;
    }

    it('registers once when the background and a page both start at once', async () => {
      const request = installLocks();
      // Each context loads its own copy of the module (and of the private store's connection).
      vi.resetModules();
      const background = await import('./nexusDevice.service');
      vi.resetModules();
      const page = await import('./nexusDevice.service');
      expect(page.getNexusAccessToken).not.toBe(background.getNexusAccessToken);

      const login = heldPost();
      const fromBackground = background.getNexusAccessToken();
      const fromPage = page.getNexusAccessToken();
      await login.reached;
      await parked();
      login.answer(tokens('acc-shared'));

      expect(await Promise.all([fromBackground, fromPage])).toEqual(['acc-shared', 'acc-shared']);
      expect(logins()).toHaveLength(1);
      expect(request).toHaveBeenCalledTimes(2);
      expect(request.mock.calls.every(([name]) => name === 'gero-nexus-device-auth')).toBe(true);
    });
  });
});
