import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  context: 'background' as 'background' | 'browser',
  data: new Map<string, unknown>(),
  sets: [] as Record<string, unknown>[],
  readGate: null as Promise<void> | null,
  subscriber: null as ((updates: Record<string, unknown>) => void) | null,
}));
vi.mock('@/utils/storageSync', () => ({ getContextType: () => env.context }));
vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({
  default: { subscribe: (_name: string, callback: typeof env.subscriber) => { env.subscriber = callback; } },
}));
vi.mock('@/api/swap-api', () => ({ default: {} }));
vi.mock('@/shared/utils/parser', () => ({ parseHttpError: (error: unknown) => error }));
vi.mock('@/utils/storeCache', async (original) => {
  const actual = await original<typeof import('@/utils/storeCache')>();
  return { ...actual, writeStoreCache: vi.fn(actual.writeStoreCache) };
});

type StoreModule = typeof import('./tokenMetadataStore') & {
  hydrateTokenMetadataStore?: () => Promise<void>;
  flushTokenMetadataPersistence?: () => Promise<void>;
};
const caches: typeof import('@/utils/storeCache')[] = [];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const tokens = (count = 2) => Object.fromEntries(Array.from({ length: count }, (_, index) => [
  `unit${index}`, { name: `Token ${index}`, ticker: `T${index}`, unit: `unit${index}`, decimals: 6, verified: true, price: index, balance: 0, quantity: '0' },
]));

async function start(context = env.context): Promise<StoreModule> {
  env.context = context;
  vi.resetModules();
  const store = await import('./tokenMetadataStore');
  caches.push(await import('@/utils/storeCache'));
  return store;
}

async function settle(store: StoreModule) {
  await store.hydrateTokenMetadataStore?.();
  // Also runs against the old callback-based implementation for the regression check.
  await new Promise((resolve) => setTimeout(resolve, 350));
  await store.flushTokenMetadataPersistence?.();
}

beforeEach(() => {
  env.context = 'background';
  env.data.clear();
  env.sets.length = 0;
  env.readGate = null;
  env.subscriber = null;
  vi.stubGlobal('chrome', { storage: { local: {
    get: (key: string, callback?: (result: Record<string, unknown>) => void) => {
      const snapshot = env.data.has(key) ? { [key]: clone(env.data.get(key)) } : {};
      const result = (env.readGate ?? Promise.resolve()).then(() => snapshot);
      if (callback) void result.then(callback);
      return result;
    },
    set: async (items: Record<string, unknown>) => {
      env.sets.push(clone(items));
      Object.entries(items).forEach(([key, value]) => env.data.set(key, clone(value)));
    },
  } } });
});

afterEach(async () => {
  caches.splice(0).forEach((cache) => cache.resetStoreCacheForTest());
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('gero-store-cache');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('token metadata persistence', () => {
  it('preserves both back-to-back setters in a cold browser context', async () => {
    const worker = await start();
    worker.default.setTokens(tokens());
    worker.default.setBlacklistPolicies(['blocked-policy']);
    await settle(worker);

    const browser = await start('browser');
    await settle(browser);
    expect(browser.tokenMetadataStore.tokens).toEqual(tokens());
    expect(browser.tokenMetadataStore.blacklistPolicies).toEqual(['blocked-policy']);
  });

  it('keeps the token map out of Chrome storage and skips unchanged bulk writes', async () => {
    const worker = await start();
    worker.default.setTokens(tokens(5000));
    worker.default.setBlacklistPolicies(['blocked-policy']);
    await settle(worker);
    const cache = caches.at(-1)!;
    const write = vi.mocked(cache.writeStoreCache);
    write.mockClear();
    env.sets.length = 0;

    worker.default.setTokens(tokens(5000));
    worker.default.setBlacklistPolicies(['another-policy']);
    await settle(worker);
    expect(env.sets.every((items) => JSON.stringify(items).length < 200)).toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(env.data.get('tokenMetadataStore')).toEqual({ blacklistPolicies: ['another-policy'] });
  });

  it('migrates a legacy record and retains it if IndexedDB initially fails', async () => {
    env.data.set('tokenMetadataStore', { tokens: tokens(), blacklistPolicies: ['old-policy'] });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let release!: () => void;
    env.readGate = new Promise<void>((resolve) => { release = resolve; });
    const worker = await start();
    const cache = caches.at(-1)!;
    vi.mocked(cache.writeStoreCache).mockRejectedValue(new Error('storage unavailable'));
    release();
    env.readGate = null;
    await worker.hydrateTokenMetadataStore?.();
    await worker.flushTokenMetadataPersistence?.();
    expect(env.data.get('tokenMetadataStore')).toEqual({ tokens: tokens(), blacklistPolicies: ['old-policy'] });
    expect(error).toHaveBeenCalled();

    const actual = await vi.importActual<typeof import('@/utils/storeCache')>('@/utils/storeCache');
    vi.mocked(cache.writeStoreCache).mockImplementation(actual.writeStoreCache);
    await worker.flushTokenMetadataPersistence?.();
    expect(env.data.get('tokenMetadataStore')).toEqual({ blacklistPolicies: ['old-policy'] });
    const browser = await start('browser');
    await settle(browser);
    expect(browser.tokenMetadataStore.tokens).toEqual(tokens());
  });

  it('does not let delayed legacy hydration overwrite a newer setter', async () => {
    env.data.set('tokenMetadataStore', { tokens: { stale: {} }, blacklistPolicies: ['old-policy'] });
    let release!: () => void;
    env.readGate = new Promise<void>((resolve) => { release = resolve; });
    const worker = await start();
    worker.default.setTokens(tokens());
    release();
    env.readGate = null;
    await settle(worker);
    const browser = await start('browser');
    await settle(browser);
    expect(browser.tokenMetadataStore.tokens).toEqual(tokens());
    expect(browser.tokenMetadataStore.blacklistPolicies).toEqual(['old-policy']);
  });

  it('does not overwrite a port update with a delayed persisted snapshot', async () => {
    env.data.set('tokenMetadataStore', { tokens: { stale: {} }, blacklistPolicies: [] });
    let release!: () => void;
    env.readGate = new Promise<void>((resolve) => { release = resolve; });
    const browser = await start('browser');
    env.subscriber?.({ tokens: tokens(), blacklistPolicies: ['live-policy'] });
    release();
    await settle(browser);
    expect(browser.tokenMetadataStore.tokens).toEqual(tokens());
    expect(browser.tokenMetadataStore.blacklistPolicies).toEqual(['live-policy']);
    expect(env.sets).toHaveLength(0);
  });

  it('restores the cache on worker restart without replacing the untouched field', async () => {
    const first = await start();
    first.default.setTokens(tokens());
    first.default.setBlacklistPolicies(['old-policy']);
    await settle(first);
    const restarted = await start('background');
    restarted.default.setBlacklistPolicies(['new-policy']);
    await settle(restarted);
    expect(restarted.tokenMetadataStore.tokens).toEqual(tokens());
    const browser = await start('browser');
    await settle(browser);
    expect(browser.tokenMetadataStore.tokens).toEqual(tokens());
    expect(browser.tokenMetadataStore.blacklistPolicies).toEqual(['new-policy']);
  });

  it('keeps a browser-side token refresh over delayed disk hydration without writing', async () => {
    env.data.set('tokenMetadataStore', { tokens: { stale: {} }, blacklistPolicies: [] });
    let release!: () => void;
    env.readGate = new Promise<void>((resolve) => { release = resolve; });
    const browser = await start('browser');
    browser.default.setTokens(tokens());
    release();
    await settle(browser);
    expect(browser.tokenMetadataStore.tokens).toEqual(tokens());
    expect(env.sets).toHaveLength(0);
  });
});
