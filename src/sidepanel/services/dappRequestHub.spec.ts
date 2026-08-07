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
    hub.setOverlayReady(true); // simulate DAppOverlay being mounted (wallet unlocked)
    port._fire({ type: 'dapp-request', method: 'enable', requestId: 'r1', payload: {} });
    port._fire({ type: 'dapp-request', method: 'signTx', requestId: 'r2', payload: {} });
    expect(hub.currentRequest.value?.requestId).toBe('r1');
    expect(hub.requestQueue.value.length).toBe(1);
    expect(hub.isVisible.value).toBe(true);
  });

  it('accepts midnight_connect and midnight_signData as valid methods', async () => {
    const { initDappRequestHub, hub } = await import('./dappRequestHub');
    await initDappRequestHub();
    hub.setOverlayReady(true); // simulate DAppOverlay being mounted (wallet unlocked)
    port._fire({ type: 'dapp-request', method: 'midnight_connect', requestId: 'm1', payload: {} });
    expect(hub.currentRequest.value?.requestId).toBe('m1');
    expect(port.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dapp-nack', requestId: 'm1' })
    );
  });

  it('accepts btcSignPsbt and btcSignMessage as valid methods', async () => {
    const { initDappRequestHub, hub } = await import('./dappRequestHub');
    await initDappRequestHub();
    hub.setOverlayReady(true); // simulate DAppOverlay being mounted (wallet unlocked)
    port._fire({ type: 'dapp-request', method: 'btcSignPsbt', requestId: 'b1', payload: {} });
    expect(hub.currentRequest.value?.requestId).toBe('b1');
    expect(port.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dapp-nack', requestId: 'b1' })
    );
  });

  it('accepts wcSessionProposal as a valid method', async () => {
    const { initDappRequestHub, hub } = await import('./dappRequestHub');
    await initDappRequestHub();
    hub.setOverlayReady(true); // simulate DAppOverlay being mounted (wallet unlocked)
    port._fire({ type: 'dapp-request', method: 'wcSessionProposal', requestId: 'w1', payload: {} });
    expect(hub.currentRequest.value?.requestId).toBe('w1');
    expect(port.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dapp-nack', requestId: 'w1' })
    );
  });

  it('deduplicates re-delivered requestIds', async () => {
    const { initDappRequestHub, hub } = await import('./dappRequestHub');
    await initDappRequestHub();
    hub.setOverlayReady(true); // simulate DAppOverlay being mounted (wallet unlocked)
    port._fire({ type: 'dapp-request', method: 'enable', requestId: 'r1', payload: {} });
    port._fire({ type: 'dapp-request', method: 'enable', requestId: 'r1', payload: {} });
    expect(hub.requestQueue.value.length).toBe(0);
  });

  it('coalesces duplicate enable() from the same origin onto one prompt', async () => {
    const { initDappRequestHub, hub } = await import('./dappRequestHub');
    await initDappRequestHub();
    hub.setOverlayReady(true);
    const payload = { website: 'https://app.dexhunter.io' };
    port._fire({ type: 'dapp-request', method: 'enable', requestId: 'e1', payload });
    port._fire({ type: 'dapp-request', method: 'enable', requestId: 'e2', payload });
    port._fire({ type: 'dapp-request', method: 'enable', requestId: 'e3', payload });
    // Only the first prompts; the duplicates do not stack in the queue.
    expect(hub.currentRequest.value?.requestId).toBe('e1');
    expect(hub.requestQueue.value.length).toBe(0);
    // Approving once answers all three enable() calls.
    hub.approve(true);
    for (const id of ['e1', 'e2', 'e3']) {
      expect(port.postMessage).toHaveBeenCalledWith({
        type: 'dapp-response', requestId: id, data: true, error: null,
      });
    }
  });

  it('rejecting a coalesced enable rejects every duplicate', async () => {
    const { initDappRequestHub, hub } = await import('./dappRequestHub');
    await initDappRequestHub();
    hub.setOverlayReady(true);
    const payload = { website: 'https://app.dexhunter.io' };
    port._fire({ type: 'dapp-request', method: 'enable', requestId: 'e1', payload });
    port._fire({ type: 'dapp-request', method: 'enable', requestId: 'e2', payload });
    hub.reject();
    for (const id of ['e1', 'e2']) {
      expect(port.postMessage).toHaveBeenCalledWith({
        type: 'dapp-response', requestId: id, data: null, error: 'user_rejected',
      });
    }
  });

  it('enable() from different origins each get their own prompt', async () => {
    const { initDappRequestHub, hub } = await import('./dappRequestHub');
    await initDappRequestHub();
    hub.setOverlayReady(true);
    port._fire({ type: 'dapp-request', method: 'enable', requestId: 'a1', payload: { website: 'https://a.io' } });
    port._fire({ type: 'dapp-request', method: 'enable', requestId: 'b1', payload: { website: 'https://b.io' } });
    expect(hub.currentRequest.value?.requestId).toBe('a1');
    expect(hub.requestQueue.value.map((r) => r.requestId)).toEqual(['b1']);
  });

  it('NACKs unknown methods instead of dropping them', async () => {
    const { initDappRequestHub } = await import('./dappRequestHub');
    await initDappRequestHub();
    port._fire({ type: 'dapp-request', method: 'weird_future_method', requestId: 'r9', payload: {} });
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'dapp-nack', requestId: 'r9', error: 'unsupported_method',
    });
  });

  // Apex shares the same Cardano signTx/signData/enable pipeline (no popup
  // view special-cases it), so it gets no special hub treatment: it connects
  // and renders through DAppOverlay exactly like a Cardano wallet instead of
  // eating a 5s dead wait before falling back to a popup.
  it('connects normally when the active wallet is Apex', async () => {
    const { walletStore } = await import('@/stores/walletStore');
    const { Blockchain } = await import('@/models/types');
    walletStore.loggedWallet = { chain: Blockchain.APEX_PRIME } as never;
    const { initDappRequestHub } = await import('./dappRequestHub');
    await initDappRequestHub();
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
  });

  it('queues a response while disconnected and flushes it after reconnect', async () => {
    const { initDappRequestHub, hub } = await import('./dappRequestHub');
    await initDappRequestHub();
    hub.setOverlayReady(true); // simulate DAppOverlay being mounted (wallet unlocked)
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

  it('swallows the parked ghost re-delivery of a request answered while disconnected', async () => {
    // Background parks a request on disconnect and re-delivers it synchronously
    // in onConnect — BEFORE it processes the panel's flushed response. If the
    // answered id were evicted from the dedupe set on an undelivered respond(),
    // the user would get the approval dialog a second time.
    const { initDappRequestHub, hub } = await import('./dappRequestHub');
    await initDappRequestHub();
    hub.setOverlayReady(true); // simulate DAppOverlay being mounted (wallet unlocked)
    port._fire({ type: 'dapp-request', method: 'signTx', requestId: 'r1', payload: {} });
    port._drop();
    hub.approve('signed-cbor'); // answered while the port was down (queued)
    const port2 = makePort();
    vi.mocked(chrome.runtime.connect).mockReturnValueOnce(port2 as unknown as chrome.runtime.Port);
    await hub._reconnectNow();
    port2._fire({ type: 'dapp-request', method: 'signTx', requestId: 'r1', payload: {} }); // the ghost
    expect(hub.currentRequest.value).toBe(null);
    expect(hub.requestQueue.value.length).toBe(0);
    expect(hub.isVisible.value).toBe(false);
  });

  it('rejectQueued removes one queued item without disturbing currentRequest', async () => {
    const { initDappRequestHub, hub } = await import('./dappRequestHub');
    await initDappRequestHub();
    hub.setOverlayReady(true); // simulate DAppOverlay being mounted (wallet unlocked)
    port._fire({ type: 'dapp-request', method: 'enable', requestId: 'r1', payload: {} });
    port._fire({ type: 'dapp-request', method: 'signTx', requestId: 'r2', payload: {} });
    port._fire({ type: 'dapp-request', method: 'signData', requestId: 'r3', payload: {} });

    hub.rejectQueued('r2');

    expect(hub.currentRequest.value?.requestId).toBe('r1'); // untouched
    expect(hub.requestQueue.value.map((r) => r.requestId)).toEqual(['r3']);
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'dapp-response', requestId: 'r2', data: null, error: 'user_rejected',
    });
  });

  it('rejectAll clears the queue and the current request', async () => {
    const { initDappRequestHub, hub } = await import('./dappRequestHub');
    await initDappRequestHub();
    port._fire({ type: 'dapp-request', method: 'enable', requestId: 'r1', payload: {} });
    port._fire({ type: 'dapp-request', method: 'signTx', requestId: 'r2', payload: {} });

    hub.rejectAll();

    expect(hub.currentRequest.value).toBe(null);
    expect(hub.requestQueue.value.length).toBe(0);
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'r1', error: 'user_rejected' })
    );
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'r2', error: 'user_rejected' })
    );
  });
});
