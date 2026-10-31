import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BITCOIN_METHOD, METHOD } from './config';
import { BITCOIN_DAPP_ENABLED, isBitcoinDappMethod, isDappMethodAvailable } from './bitcoinDappGate';

/**
 * The Bitcoin dApp API is gated off (BITCOIN_DAPP_ENABLED = false). Hiding the
 * page-world provider is not enough: a page can post the raw request message
 * to the content relay itself, so the background must refuse it too.
 */

const OWN = 'abcdefghijklmnopabcdefghijklmnop';
const PAGE_ORIGIN = 'https://dapp.example';
const CONTENT: chrome.runtime.MessageSender = {
  id: OWN, url: `${PAGE_ORIGIN}/`, origin: PAGE_ORIGIN, tab: { id: 9 } as chrome.tabs.Tab, frameId: 0,
};

type OnMessage = (msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r?: unknown) => void) => boolean;
let messageListeners: OnMessage[];
let sentToBackground: Array<{ method?: string }>;

beforeEach(() => {
  messageListeners = [];
  sentToBackground = [];
  vi.stubGlobal('chrome', {
    runtime: {
      id: OWN,
      getURL: (path: string) => `chrome-extension://${OWN}/${path}`,
      onMessage: { addListener: (fn: OnMessage) => messageListeners.push(fn) },
      onConnect: { addListener: () => {}, removeListener: () => {} },
      sendMessage: vi.fn((msg: { method?: string }, cb?: (r: unknown) => void) => {
        sentToBackground.push(msg);
        // The relay's whitelist pre-check: this origin is not connected.
        cb?.({ error: { code: -3, info: 'Refused' } });
      }),
    },
    tabs: { onRemoved: { addListener: () => {}, removeListener: () => {} } },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('bitcoinDappGate', () => {
  it('is off for this release', () => {
    expect(BITCOIN_DAPP_ENABLED).toBe(false);
  });

  it('recognises every Bitcoin dApp method and nothing else', () => {
    for (const method of Object.values(BITCOIN_METHOD)) expect(isBitcoinDappMethod(method)).toBe(true);
    expect(isBitcoinDappMethod(METHOD.signTx)).toBe(false);
    expect(isBitcoinDappMethod(undefined)).toBe(false);
  });

  it('withholds Bitcoin methods only while the API is gated off', () => {
    expect(isDappMethodAvailable(BITCOIN_METHOD.signPsbt, false)).toBe(false);
    expect(isDappMethodAvailable(BITCOIN_METHOD.signPsbt, true)).toBe(true);
    expect(isDappMethodAvailable(METHOD.signTx, false)).toBe(true);
  });
});

describe('background router refuses gated Bitcoin dApp methods', () => {
  async function router() {
    const { Messaging } = await import('./messaging');
    const { SENDER, TARGET } = await import('./config');
    const app = Messaging.createBackgroundController();
    const handled: string[] = [];
    for (const method of [...Object.values(BITCOIN_METHOD), METHOD.getUtxos]) {
      app.add(method, (_req, sendResponse) => { handled.push(method); sendResponse({ data: 'handled' }); });
    }
    app.listen();
    const send = (method: string) => {
      const responses: unknown[] = [];
      messageListeners[0]({ id: 'r1', method, sender: SENDER.webpage, target: TARGET, origin: PAGE_ORIGIN, data: {} }, CONTENT, r => responses.push(r));
      return responses[0] as { error?: { code?: number } } | undefined;
    };
    return { send, handled };
  }

  it('answers every Bitcoin dApp method with a refusal and never reaches its handler', async () => {
    const { send, handled } = await router();
    for (const method of Object.values(BITCOIN_METHOD)) {
      expect(send(method)?.error).toMatchObject({ code: -3 });
    }
    expect(handled).toEqual([]);
  });

  it('still dispatches Cardano dApp methods', async () => {
    const { send, handled } = await router();
    send(METHOD.getUtxos);
    expect(handled).toEqual([METHOD.getUtxos]);
  });
});

describe('content relay does not fast-path gated Bitcoin methods', () => {
  it('sends a Bitcoin sign request through the whitelist pre-check instead of straight to the background', async () => {
    const { Messaging } = await import('./messaging');
    const { SENDER, TARGET } = await import('./config');
    Messaging.createProxyController();
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { id: 'p1', target: TARGET, sender: SENDER.webpage, method: BITCOIN_METHOD.signPsbt, data: { psbtHex: '00' } },
    }));
    await vi.waitFor(() => expect(sentToBackground.length).toBeGreaterThan(0));
    expect(sentToBackground[0].method).toBe(METHOD.isWhitelisted);
    expect(sentToBackground.some(m => m.method === BITCOIN_METHOD.signPsbt)).toBe(false);
  });

  it('keeps fast-pathing Cardano sign requests', async () => {
    const { Messaging } = await import('./messaging');
    const { SENDER, TARGET } = await import('./config');
    Messaging.createProxyController();
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { id: 'p2', target: TARGET, sender: SENDER.webpage, method: METHOD.signTx, data: {} },
    }));
    await vi.waitFor(() => expect(sentToBackground.length).toBeGreaterThan(0));
    expect(sentToBackground[0].method).toBe(METHOD.signTx);
  });
});
