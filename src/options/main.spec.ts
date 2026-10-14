import { h, nextTick, type App } from 'vue';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  wallet: { loggedWallet: null as { id: number } | null, isLocked: true, isSyncing: false },
  hydration: () => Promise.resolve(),
  language: () => Promise.resolve(),
  i18n: { locale: 'us' },
  router: null as unknown as Router,
  apps: [] as App[],
  mounted: vi.fn(),
}));
vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>();
  return { ...actual, createApp: (...args: Parameters<typeof actual.createApp>) => {
    const app = actual.createApp(...args);
    const mount = app.mount.bind(app);
    app.mount = (...mountArgs: Parameters<typeof app.mount>) => {
      env.mounted(...mountArgs);
      return mount(...mountArgs);
    };
    env.apps.push(app);
    return app;
  } };
});
vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  env.wallet = reactive(env.wallet);
  return { walletStore: env.wallet, hydrateWalletStore: () => env.hydration() };
});
vi.mock('@/stores/geroStore', () => ({ geroStore: { config: { locale: 'us' } } }));
vi.mock('@/stores/featureFlagsStore', () => ({ default: { initialize: async () => {} } }));
vi.mock('@/services/activityTracker.service', () => ({ activityTracker: { start: vi.fn(), stop: vi.fn() } }));
vi.mock('@/plugins/i18n', () => ({ default: env.i18n, i18nPlugin: { install() {} }, loadLanguage: () => env.language() }));
vi.mock('@/plugins/vuetify', () => ({ default: { install() {} } }));
vi.mock('@/modules/navigation/router', () => ({ get default() { return env.router; } }));
vi.mock('@/shared/components/FlagIcon.vue', () => ({ default: { render: () => null } }));
vi.mock('@/shared/components/ToastNotifications.vue', () => ({ default: { render: () => null } }));
vi.mock('vuetify/directives', () => ({ ClickOutside: {} }));
vi.mock('./App.vue', () => ({ default: { render: () => h('div', { id: 'startup-app' }) } }));

const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
  await nextTick();
};
let mount: ReturnType<typeof vi.spyOn>;
let storage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  env.wallet.loggedWallet = null;
  env.wallet.isLocked = true;
  env.wallet.isSyncing = false;
  env.i18n.locale = 'us';
  env.mounted.mockClear();
  env.hydration = async () => {};
  env.language = async () => {};

  const component = { render: () => h('div') };
  env.router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component }, { path: '/welcome', component },
    { path: '/governance', component },
    { path: '/help/articles/:slug', component, meta: { public: true } },
    { path: '/blog', component, meta: { public: true } },
    { path: '/blog/:slug', component, meta: { public: true } },
    { path: '/passkey-auth', name: 'passkey-auth', component },
    { path: '/ledger-ble-sign', name: 'ledger-ble-sign', component },
  ] });
  env.router.beforeEach((to, _from, next) => {
    if (to.path === '/governance' && (!env.wallet.loggedWallet || env.wallet.isLocked || env.wallet.isSyncing)) {
      next({ path: '/welcome', query: { redirect: to.fullPath } });
    } else next();
  });
  storage = vi.fn((_keys: string | string[], callback: (value: unknown) => void) => callback({}));
  vi.stubGlobal('chrome', { runtime: {}, storage: { local: { get: storage } } });
  document.body.innerHTML = '<div id="app"></div>';
  mount = env.mounted;
});

afterEach(() => {
  env.apps.splice(0).forEach(app => app.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('options entry point', () => {
  it.each(['/help/articles/backup?q=recovery&chain=midnight', '/blog', '/blog/security'])('preserves public %s through startup, unlock and lock', async path => {
    await env.router.push(path);
    await import('./main');
    await tick();
    expect(env.router.currentRoute.value.fullPath).toBe(path);
    env.wallet.loggedWallet = { id: 1 };
    env.wallet.isLocked = false;
    await tick();
    env.wallet.isLocked = true;
    await tick();
    expect(env.router.currentRoute.value.fullPath).toBe(path);
  });

  it('still evicts private content on lock', async () => {
    env.wallet.loggedWallet = { id: 1 };
    env.wallet.isLocked = false;
    await env.router.push('/governance');
    await import('./main');
    await tick();
    env.wallet.isLocked = true;
    await tick();
    expect(env.router.currentRoute.value.path).toBe('/welcome');
  });

  it('mounts once after five seconds when all storage remains pending', async () => {
    storage.mockImplementation(() => {});
    env.hydration = () => new Promise(() => {});
    await import('./main');
    await vi.advanceTimersByTimeAsync(4999);
    expect(mount).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(document.querySelector('#startup-app')).not.toBeNull();
    expect(mount.mock.calls.filter(([target]) => target === '#app')).toHaveLength(1);
  });

  it.each(['locale storage', 'locale bundle'])('also bounds a stalled %s', async (stall) => {
    storage.mockImplementation((keys, callback) => {
      if (Array.isArray(keys)) {
        if (stall === 'locale storage') return;
        callback({ geroStore: { config: { locale: 'de' } } });
      } else callback({});
    });
    env.language = () => new Promise(() => {});
    await import('./main');
    await vi.advanceTimersByTimeAsync(5000);
    expect(mount.mock.calls.filter(([target]) => target === '#app')).toHaveLength(1);
    expect(env.i18n.locale).toBe('us');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('locale'));
  });

  it('waits for a normal locale load and mounts before the deadline', async () => {
    storage.mockImplementation((_keys, callback) => callback({ geroStore: { config: { locale: 'de' } } }));
    await import('./main');
    await tick();
    expect(env.i18n.locale).toBe('de');
    expect(mount.mock.calls.filter(([target]) => target === '#app')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('mounts after rejected hydration and a synchronous storage failure', async () => {
    storage.mockImplementation(() => { throw new Error('storage unavailable'); });
    env.hydration = () => Promise.reject(new Error('read failed'));
    await import('./main');
    await tick();
    expect(mount.mock.calls.filter(([target]) => target === '#app')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers the requested route after late hydration without remounting', async () => {
    let resolve!: () => void;
    env.hydration = () => new Promise<void>((done) => { resolve = done; });
    await env.router.push('/governance').catch(() => {});
    await import('./main');
    await vi.advanceTimersByTimeAsync(5000);
    expect(env.router.currentRoute.value.path).toBe('/welcome');
    env.wallet.loggedWallet = { id: 1 };
    env.wallet.isLocked = false;
    resolve();
    await tick();
    expect(env.router.currentRoute.value.path).toBe('/governance');
    expect(mount.mock.calls.filter(([target]) => target === '#app')).toHaveLength(1);
  });

  it('does not redirect a still-locked wallet after late hydration', async () => {
    await env.router.push('/welcome');
    await import('./main');
    await tick();
    env.wallet.loggedWallet = { id: 1 };
    await tick();
    expect(env.router.currentRoute.value.path).toBe('/welcome');
  });

  it.each(['/passkey-auth', '/ledger-ble-sign', '/welcome?addWallet=1'])('preserves %s when hydration finishes', async (path) => {
    await env.router.push(path);
    await import('./main');
    await tick();
    env.wallet.loggedWallet = { id: 1 };
    env.wallet.isLocked = false;
    await tick();
    expect(env.router.currentRoute.value.fullPath).toBe(path);
  });
});
