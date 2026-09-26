import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ connect: null as null | ((port: chrome.runtime.Port) => void) }));
vi.mock('@/utils/storageSync', () => ({ getContextType: () => 'background' }));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('chrome', { runtime: { id: 'wallet-extension', onConnect: { addListener: (fn: typeof env.connect) => { env.connect = fn; } } } });
});

function port(sender: chrome.runtime.MessageSender = { id: 'wallet-extension', url: 'chrome-extension://wallet-extension/index.html' }) {
  let receive: (message: unknown) => void = () => undefined;
  let disconnect = () => undefined;
  const send = vi.fn();
  const value = {
    name: 'store-sync', sender, postMessage: send,
    onMessage: { addListener: (fn: typeof receive) => { receive = fn; } },
    onDisconnect: { addListener: (fn: typeof disconnect) => { disconnect = fn; } },
  } as unknown as chrome.runtime.Port;
  env.connect!(value);
  return { send, subscribe: () => receive({ type: 'STORE_SUBSCRIBE', storeName: 'walletStore' }), disconnect: () => disconnect() };
}

describe('live state on subscription', () => {
  it('does not send wallet data to a content-script port', async () => {
    const { default: bg } = await import('./storeMessagingBg');
    bg.registerSnapshot('walletStore', () => ({ loggedWallet: { id: 1 } }), Promise.resolve());
    const content = port({ id: 'wallet-extension', url: 'https://example.com' });
    content.subscribe();
    bg.broadcastUpdate('walletStore', { isSyncing: false });
    await Promise.resolve();
    expect(content.send).not.toHaveBeenCalled();
    expect(bg.getConnectionCount()).toBe(0);
  });

  it('takes a fresh snapshot for a reconnected page', async () => {
    const { default: bg } = await import('./storeMessagingBg');
    const state = { loggedWallet: { id: 1 }, isLocked: false };
    bg.registerSnapshot('walletStore', () => ({ ...state }), Promise.resolve());
    const first = port();
    first.subscribe();
    await Promise.resolve();
    first.disconnect();
    state.loggedWallet = { id: 2 };
    state.isLocked = true;
    const reconnected = port();
    reconnected.subscribe();
    await Promise.resolve();
    expect(reconnected.send).toHaveBeenLastCalledWith(expect.objectContaining({ updates: state }));
  });

  it('serves subscriptions made before the store registers during worker boot', async () => {
    const { default: bg } = await import('./storeMessagingBg');
    const page = port();
    page.subscribe();
    bg.registerSnapshot('walletStore', () => ({ isSyncing: false }), Promise.resolve());
    await Promise.resolve();
    expect(page.send).toHaveBeenCalledWith(expect.objectContaining({ updates: { isSyncing: false } }));
  });

  it('repairs a page that missed the sync-finished broadcast', async () => {
    const { default: bg } = await import('./storeMessagingBg');
    const state = { isSyncing: false, loggedWallet: { id: 1 } };
    bg.registerSnapshot('walletStore', () => ({ ...state }), Promise.resolve());
    bg.broadcastUpdate('walletStore', { isSyncing: false });
    const page = port();
    page.subscribe();
    await Promise.resolve();
    expect(page.send).toHaveBeenCalledWith(expect.objectContaining({ storeName: 'walletStore', updates: state }));
  });

  it('takes the snapshot after hydration and includes updates made while waiting', async () => {
    const { default: bg } = await import('./storeMessagingBg');
    let ready!: () => void;
    const hydration = new Promise<void>(resolve => { ready = resolve; });
    const state = { isSyncing: true, loggedWallet: null as null | { id: number } };
    bg.registerSnapshot('walletStore', () => ({ ...state }), hydration);
    const page = port();
    page.subscribe();
    expect(page.send).not.toHaveBeenCalled();
    state.isSyncing = false;
    state.loggedWallet = { id: 2 };
    ready();
    await hydration;
    expect(page.send).toHaveBeenLastCalledWith(expect.objectContaining({ updates: state }));
  });

  it('sends the snapshot only to the joining context', async () => {
    const { default: bg } = await import('./storeMessagingBg');
    bg.registerSnapshot('walletStore', () => ({ isSyncing: false }), Promise.resolve());
    const existing = port();
    const joining = port();
    joining.subscribe();
    await Promise.resolve();
    expect(existing.send).not.toHaveBeenCalled();
    expect(joining.send).toHaveBeenCalledTimes(1);
  });

  it('does not send a deferred snapshot to a closed page', async () => {
    const { default: bg } = await import('./storeMessagingBg');
    let ready!: () => void;
    const hydration = new Promise<void>(resolve => { ready = resolve; });
    bg.registerSnapshot('walletStore', () => ({ isSyncing: false }), hydration);
    const page = port();
    page.subscribe();
    page.disconnect();
    ready();
    await hydration;
    expect(page.send).not.toHaveBeenCalled();
  });
});
