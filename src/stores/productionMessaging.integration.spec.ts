import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isProxy, reactive, watch } from 'vue';

const env = vi.hoisted(() => ({
  context: 'background' as 'background' | 'browser',
  data: new Map<string, unknown>(),
  connect: undefined as undefined | ((port: chrome.runtime.Port) => void),
  disconnects: [] as (() => void)[],
  wire: [] as Record<string, unknown>[],
}));

vi.mock('@/utils/storageSync', () => ({ getContextType: () => env.context }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: async () => {}, disconnect: () => {} } }));
vi.mock('@/utils/debug', () => ({ debugLog: () => {} }));

/** Only Chrome's transport is simulated. Production stores, serializers,
 * subscriptions and persistence execute unchanged; no published-state replay,
 * store-message mock or direct assignment to the observed UI store is used. */
function connectPorts(): chrome.runtime.Port {
  const toWorker: ((message: unknown) => void)[] = [];
  const toPage: ((message: unknown) => void)[] = [];
  const onClose: (() => void)[] = [];
  let closed = false;
  const disconnect = () => {
    if (closed) return;
    closed = true;
    onClose.forEach(callback => callback());
  };
  const send = (listeners: ((message: unknown) => void)[], message: Record<string, unknown>) => {
    if (closed) throw new Error('Port disconnected');
    // Deliberately reject Vue proxies; JSON and chunk branches must both yield
    // detached data before crossing the transport boundary.
    const copy = structuredClone(message);
    env.wire.push(copy);
    listeners.forEach(callback => callback(copy));
  };
  const common = { name: 'store-sync', disconnect, onDisconnect: { addListener: (fn: () => void) => onClose.push(fn) } };
  const workerPort = {
    ...common,
    sender: { id: 'wallet-extension', url: 'chrome-extension://wallet-extension/index.html' },
    onMessage: { addListener: (fn: (m: unknown) => void) => toWorker.push(fn) },
    postMessage: (m: Record<string, unknown>) => send(toPage, m),
  } as unknown as chrome.runtime.Port;
  const pagePort = {
    ...common,
    onMessage: { addListener: (fn: (m: unknown) => void) => toPage.push(fn) },
    postMessage: (m: Record<string, unknown>) => send(toWorker, m),
  } as unknown as chrome.runtime.Port;
  env.disconnects.push(disconnect);
  env.connect?.(workerPort);
  return pagePort;
}

interface Graph {
  wallet: typeof import('./walletStore');
  messaging: typeof import('@/services/storeMessaging.service')['default'];
  background: typeof import('@/chrome/storeMessagingBg')['default'];
  cache: typeof import('@/utils/storeCache');
}
const graphs: Graph[] = [];
async function loadContext(context: typeof env.context) {
  env.context = context;
  vi.resetModules();
  const wallet = await import('./walletStore');
  const messaging = (await import('@/services/storeMessaging.service')).default;
  const background = (await import('@/chrome/storeMessagingBg')).default;
  const cache = await import('@/utils/storeCache');
  await wallet.hydrateWalletStore();
  const graph = { wallet, messaging, background, cache };
  graphs.push(graph);
  return graph;
}

beforeEach(() => {
  env.data.clear();
  env.wire.length = 0;
  env.disconnects.length = 0;
  env.connect = undefined;
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'wallet-extension', getURL: (path: string) => `chrome-extension://wallet-extension/${path}`,
      onConnect: { addListener: (fn: typeof env.connect) => { env.connect = fn; } },
      connect: connectPorts,
    },
    storage: { local: {
      get: async (keys: string | string[], callback?: (items: Record<string, unknown>) => void) => {
        const items = Object.fromEntries((Array.isArray(keys) ? keys : [keys])
          .filter(key => env.data.has(key)).map(key => [key, structuredClone(env.data.get(key))]));
        callback?.(items);
        return items;
      },
      set: async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(structuredClone(items))) env.data.set(key, value);
      },
    } },
    alarms: { getAll: (callback: (alarms: unknown[]) => void) => callback([]), clear: () => {} },
  });
});

afterEach(async () => {
  for (const graph of graphs) graph.messaging.destroy();
  for (const graph of graphs) {
    await graph.wallet.flushWalletStorePersistence();
    graph.cache.resetStoreCacheForTest();
  }
  graphs.length = 0;
  await new Promise<void>(resolve => {
    const request = indexedDB.deleteDatabase('gero-store-cache');
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
  vi.unstubAllGlobals();
});

describe('Vue3 production store and port synchronization', () => {
  it('broadcasts login/lock and wallet replacement to two contexts, then persists a restart', async () => {
    const worker = await loadContext('background');
    const options = await loadContext('browser');
    const sidepanel = await loadContext('browser');
    const surfaces = [options, sidepanel];
    await vi.waitFor(() => expect(worker.background.getConnectionCount()).toBe(2));
    const changes: unknown[] = [];
    const stop = watch(() => (options.wallet.walletStore.tokens as Record<string, unknown>)['asset'], value => changes.push(value), { flush: 'sync' });

    worker.wallet.default.setLoggedWallet({ id: 1, chain: 'Cardano', network: 'Preprod' });
    worker.wallet.default.setLocked(false);
    worker.wallet.default.setTokens({ asset: { quantity: '10' } });
    worker.wallet.default.setTransactions([{ tx_hash: 'wallet-one-history' }]);
    await vi.waitFor(() => {
      for (const surface of surfaces) {
        expect(surface.wallet.walletStore.loggedWallet.id).toBe(1);
        expect(surface.wallet.walletStore.tokens).toEqual({ asset: { quantity: '10' } });
      }
    });
    expect(changes.length).toBeGreaterThan(0);
    worker.wallet.default.setLocked(true);
    for (const surface of surfaces) expect(surface.wallet.walletStore.isLocked).toBe(true);

    worker.wallet.default.clearForWalletSwitch();
    worker.wallet.default.setLoggedWallet({ id: 2, chain: 'Bitcoin', network: 'Testnet' });
    for (const surface of surfaces) {
      expect(surface.wallet.walletStore.loggedWallet.id).toBe(2);
      expect(surface.wallet.walletStore.loggedWallet.network).toBe('Testnet');
      expect(surface.wallet.walletStore.transactions).toEqual([]);
      expect(surface.wallet.walletStore.tokens).toEqual({});
    }
    await worker.wallet.flushWalletStorePersistence();
    surfaces.forEach(surface => surface.messaging.destroy());
    worker.messaging.destroy();
    const restarted = await loadContext('background');
    const reopened = await loadContext('browser');
    expect(restarted.wallet.walletStore.loggedWallet.id).toBe(2);
    expect(restarted.wallet.walletStore.isLocked).toBe(true);
    await vi.waitFor(() => expect(reopened.wallet.walletStore.loggedWallet.id).toBe(2));
    expect(reopened.wallet.walletStore.isLocked).toBe(true);
    expect(reopened.wallet.walletStore.transactions).toEqual([]);
    expect(reopened.wallet.walletStore.tokens).toEqual({});
    stop();
  });

  it('detaches nested proxies before actual port delivery and never recreates a destroyed subscription', async () => {
    const worker = await loadContext('background');
    const browser = await loadContext('browser');
    const received: Record<string, unknown>[] = [];
    browser.messaging.subscribe('proxy-check', update => received.push(update));
    await vi.waitFor(() => expect(worker.background.getConnectionCount()).toBe(1));
    const update = reactive({ entries: [{ amount: '2', bytes: new Uint8Array([1, 2]) }] });
    worker.background.broadcastUpdate('proxy-check', update);
    expect(received).toHaveLength(1);
    expect(isProxy(received[0])).toBe(false);
    expect(isProxy((received[0]['entries'] as unknown[])[0])).toBe(false);
    update.entries[0].amount = '3';
    expect((received[0]['entries'] as { amount: string }[])[0].amount).toBe('2');
    browser.messaging.destroy();
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(worker.background.getConnectionCount()).toBe(0);
    worker.background.broadcastUpdate('proxy-check', { entries: [] });
    expect(received).toHaveLength(1);
  });
});
