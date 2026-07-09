import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shape of the messages fired at the mock port in these tests — loose on
// purpose (mirrors the wire format), but typed instead of `any`.
type FiredMessage = { type: string; requestId?: string; method?: string; payload?: unknown };

// Minimal chrome mock: onMessage/onDisconnect capture listeners so tests can fire them.
function makePort() {
  const listeners: { msg: Array<(m: FiredMessage) => void>; dis: Array<() => void> } = { msg: [], dis: [] };
  return {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: { addListener: (f: (m: FiredMessage) => void) => listeners.msg.push(f) },
    onDisconnect: { addListener: (f: () => void) => listeners.dis.push(f) },
    _fire: (m: FiredMessage) => listeners.msg.forEach((f) => f(m)),
    _drop: () => listeners.dis.forEach((f) => f()),
  };
}

type MockPort = ReturnType<typeof makePort>;
let port: MockPort;

beforeEach(() => {
  vi.resetModules();
  port = makePort();
  vi.stubGlobal('chrome', {
    runtime: { connect: vi.fn(() => port) },
    tabs: { query: vi.fn((_q: unknown, cb: (tabs: Array<{ id: number }>) => void) => cb([{ id: 42 }])) },
  });
});

describe('dappRequestHub', () => {
  it('resolves tabId from chrome.tabs.query when URL has none and connects with it', async () => {
    const { initDappRequestHub } = await import('./dappRequestHub');
    await initDappRequestHub();
    expect(vi.mocked(chrome.runtime.connect).mock.calls[0][0].name).toBe('mini-gero-dapp-channel:42');
  });

  it('presents the first request and queues the second', async () => {
    const { initDappRequestHub, hub } = await import('./dappRequestHub');
    await initDappRequestHub();
    port._fire({ type: 'dapp-request', method: 'enable', requestId: 'r1', payload: {} });
    port._fire({ type: 'dapp-request', method: 'signTx', requestId: 'r2', payload: {} });
    expect(hub.currentRequest.value?.requestId).toBe('r1');
    expect(hub.requestQueue.value.length).toBe(1);
    expect(hub.isVisible.value).toBe(true);
  });

  it('accepts midnight_connect and midnight_signData as valid methods', async () => {
    const { initDappRequestHub, hub } = await import('./dappRequestHub');
    await initDappRequestHub();
    port._fire({ type: 'dapp-request', method: 'midnight_connect', requestId: 'm1', payload: {} });
    expect(hub.currentRequest.value?.requestId).toBe('m1');
    expect(port.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dapp-nack', requestId: 'm1' })
    );
  });

  it('deduplicates re-delivered requestIds', async () => {
    const { initDappRequestHub, hub } = await import('./dappRequestHub');
    await initDappRequestHub();
    port._fire({ type: 'dapp-request', method: 'enable', requestId: 'r1', payload: {} });
    port._fire({ type: 'dapp-request', method: 'enable', requestId: 'r1', payload: {} });
    expect(hub.requestQueue.value.length).toBe(0);
  });

  it('NACKs unknown methods instead of dropping them', async () => {
    const { initDappRequestHub } = await import('./dappRequestHub');
    await initDappRequestHub();
    port._fire({ type: 'dapp-request', method: 'weird_future_method', requestId: 'r9', payload: {} });
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'dapp-nack', requestId: 'r9', error: 'unsupported_method',
    });
  });

  // These two import walletStore/Blockchain/nextTick DYNAMICALLY, after the
  // same vi.resetModules() as the hub itself — a static top-level import
  // would resolve to a DIFFERENT module instance than the one dappRequestHub
  // reads internally once resetModules() decouples the graphs, so mutating
  // it would silently do nothing.
  it('never connects while the active wallet is Apex (preserves the popup fallback)', async () => {
    const { walletStore } = await import('@/stores/walletStore');
    const { Blockchain } = await import('@/models/types');
    walletStore.loggedWallet = { chain: Blockchain.APEX_PRIME } as never;
    const { initDappRequestHub } = await import('./dappRequestHub');
    await initDappRequestHub();
    expect(chrome.runtime.connect).not.toHaveBeenCalled();
  });

  it('disconnects immediately when switching to an Apex wallet mid-session, reconnects on switching away', async () => {
    const { walletStore } = await import('@/stores/walletStore');
    const { Blockchain } = await import('@/models/types');
    const { nextTick } = await import('vue');
    const { initDappRequestHub } = await import('./dappRequestHub');
    await initDappRequestHub();
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);

    walletStore.loggedWallet = { chain: Blockchain.APEX_PRIME } as never;
    await nextTick();
    expect(port.disconnect).toHaveBeenCalled();

    const port2 = makePort();
    vi.mocked(chrome.runtime.connect).mockReturnValueOnce(port2 as unknown as chrome.runtime.Port);
    walletStore.loggedWallet = { chain: Blockchain.CARDANO } as never;
    await nextTick();
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(2);
  });

  it('queues a response while disconnected and flushes it after reconnect', async () => {
    const { initDappRequestHub, hub } = await import('./dappRequestHub');
    await initDappRequestHub();
    port._fire({ type: 'dapp-request', method: 'signTx', requestId: 'r1', payload: {} });
    port._drop(); // panel port died (tab switch etc.)
    hub.approve('signed-cbor'); // user finished signing after the drop
    // reconnect happens via backoff; simulate by advancing the newly connected port
    const port2 = makePort();
    vi.mocked(chrome.runtime.connect).mockReturnValueOnce(port2 as unknown as chrome.runtime.Port);
    await hub._reconnectNow(); // test hook
    expect(port2.postMessage).toHaveBeenCalledWith({
      type: 'dapp-response', requestId: 'r1', data: 'signed-cbor', error: null,
    });
  });
});
