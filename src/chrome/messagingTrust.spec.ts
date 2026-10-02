import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The background router and the approval ports must only trust our own
 * extension pages. A content script runs in every frame of every page and shares
 * our sender.id, so code with content-script privileges (e.g. a compromised
 * renderer) must not be able to drive options-context handlers or answer an
 * approval prompt.
 */

const OWN = 'abcdefghijklmnopabcdefghijklmnop';
const PAGE: chrome.runtime.MessageSender = { id: OWN, url: `chrome-extension://${OWN}/sidepanel/index.html` };
const CONTENT: chrome.runtime.MessageSender = { id: OWN, url: 'https://evil.example/', tab: { id: 9 } as chrome.tabs.Tab, frameId: 0 };

type OnMessage = (msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r?: unknown) => void) => boolean;
type OnConnect = (port: chrome.runtime.Port) => void;

let messageListeners: OnMessage[];
let connectListeners: OnConnect[];

function fakePort(name: string, sender: chrome.runtime.MessageSender) {
  const onMessage: Array<(m: unknown) => void> = [];
  const onDisconnect: Array<() => void> = [];
  const posted: unknown[] = [];
  const port = {
    name,
    sender,
    postMessage: (m: unknown) => posted.push(m),
    disconnect: () => onDisconnect.forEach(fn => fn()),
    onMessage: { addListener: (fn: (m: unknown) => void) => onMessage.push(fn), removeListener: () => {} },
    onDisconnect: { addListener: (fn: () => void) => onDisconnect.push(fn), removeListener: () => {} },
  } as unknown as chrome.runtime.Port;
  return { port, posted, emit: (m: unknown) => onMessage.slice().forEach(fn => fn(m)) };
}

/** Which browser the stubbed runtime behaves like: its page root comes from getURL(''). */
let browserRoot: string;
// Firefox: the add-on id is not the host of its page URLs (a per-install UUID is).
const FIREFOX_ID = 'wallet@gerowallet.io';
const FIREFOX_ROOT = 'moz-extension://3f1c9a52-7d1e-4b8e-9a4f-2c6d0e5b7a10/';

beforeEach(() => {
  messageListeners = [];
  connectListeners = [];
  browserRoot = `chrome-extension://${OWN}/`;
  vi.stubGlobal('chrome', {
    runtime: {
      get id() { return browserRoot === FIREFOX_ROOT ? FIREFOX_ID : OWN; },
      getURL: (path: string) => `${browserRoot}${path}`,
      onMessage: { addListener: (fn: OnMessage) => messageListeners.push(fn) },
      onConnect: {
        addListener: (fn: OnConnect) => connectListeners.push(fn),
        removeListener: (fn: OnConnect) => { connectListeners = connectListeners.filter(l => l !== fn); },
      },
      sendMessage: vi.fn(),
    },
    tabs: { onRemoved: { addListener: () => {}, removeListener: () => {} } },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function router() {
  const { Messaging } = await import('./messaging');
  const { SENDER, TARGET } = await import('./config');
  const app = Messaging.createBackgroundController();
  const handled: string[] = [];
  for (const m of ['UNLOCK', 'SIGN_TX', 'VERIFY_SPENDING_PASSWORD', 'LOGIN', 'WC_PAIR', 'TRUST_CROSS_DEVICE']) {
    app.addToOptions(m, (_req, sendResponse) => { handled.push(m); sendResponse({ data: { success: true } }); });
  }
  app.add('getUtxos', (_req, sendResponse) => { handled.push('getUtxos'); sendResponse({ data: [] }); });
  app.listen();
  const send = (method: string, sender: chrome.runtime.MessageSender, channel = SENDER.options) => {
    const responses: unknown[] = [];
    messageListeners[0]({ method, sender: channel, target: TARGET, data: {} }, sender, r => responses.push(r));
    return responses[0] as { data?: { success?: boolean; error?: string } } | undefined;
  };
  return { send, handled, SENDER };
}

describe('background router: options channel is default-deny', () => {
  it('dispatches options methods for our own extension pages', async () => {
    const { send, handled } = await router();
    for (const m of ['UNLOCK', 'SIGN_TX', 'VERIFY_SPENDING_PASSWORD', 'LOGIN', 'TRUST_CROSS_DEVICE']) send(m, PAGE);
    expect(handled).toEqual(['UNLOCK', 'SIGN_TX', 'VERIFY_SPENDING_PASSWORD', 'LOGIN', 'TRUST_CROSS_DEVICE']);
  });

  it('refuses options methods from a content script forging sender:"options" (e.g. UNLOCK with passkey-authenticated)', async () => {
    const { send, handled } = await router();
    for (const m of ['UNLOCK', 'SIGN_TX', 'VERIFY_SPENDING_PASSWORD', 'LOGIN', 'TRUST_CROSS_DEVICE']) {
      const res = send(m, CONTENT);
      expect(res?.data).toEqual({ success: false, error: 'Unauthorized sender' });
    }
    expect(handled).toEqual([]);
  });

  it('still accepts the allowlisted WC_PAIR from the content script', async () => {
    const { send, handled } = await router();
    send('WC_PAIR', CONTENT);
    expect(handled).toEqual(['WC_PAIR']);
  });

  it('leaves the dApp (webpage) channel to its own per-handler origin checks', async () => {
    const { send, handled, SENDER } = await router();
    send('getUtxos', CONTENT, SENDER.webpage);
    expect(handled).toEqual(['getUtxos']);
  });
});

describe('Firefox: own pages live under moz-extension://<internal-uuid>/ (PR #1241 review)', () => {
  const FIREFOX_PAGE: chrome.runtime.MessageSender = { id: FIREFOX_ID, url: `${FIREFOX_ROOT}index.html#/login` };
  const FIREFOX_CONTENT: chrome.runtime.MessageSender = { id: FIREFOX_ID, url: 'https://evil.example/', tab: { id: 9 } as chrome.tabs.Tab, frameId: 0 };

  it("dispatches the Firefox build's own page (LOGIN, UNLOCK, SIGN_TX reach their handlers)", async () => {
    browserRoot = FIREFOX_ROOT;
    const { send, handled } = await router();
    for (const m of ['LOGIN', 'UNLOCK', 'SIGN_TX']) send(m, FIREFOX_PAGE);
    expect(handled).toEqual(['LOGIN', 'UNLOCK', 'SIGN_TX']);
  });

  it('still refuses a Firefox content script, another install\'s UUID, and a moz URL built from the add-on id', async () => {
    browserRoot = FIREFOX_ROOT;
    const { send, handled } = await router();
    for (const sender of [
      FIREFOX_CONTENT,
      { id: FIREFOX_ID, url: 'moz-extension://00000000-0000-4000-8000-000000000000/index.html' },
      { id: FIREFOX_ID, url: `moz-extension://${FIREFOX_ID}/index.html` },
    ] as chrome.runtime.MessageSender[]) {
      expect(send('LOGIN', sender)?.data).toEqual({ success: false, error: 'Unauthorized sender' });
    }
    expect(handled).toEqual([]);
  });

  it('a Firefox approval port from our own page settles the prompt', async () => {
    browserRoot = FIREFOX_ROOT;
    const { Messaging } = await import('./messaging');
    const { METHOD } = await import('./config');
    let settled: unknown;
    void Messaging.sendToPopupInternal(42, { method: 'signTx', data: { tx: 'ab' } } as never).then(r => { settled = r; });
    const real = fakePort('internal-background-popup-communication', FIREFOX_PAGE);
    connectListeners.forEach(l => l(real.port));
    real.emit({ tabId: 42, method: METHOD.returnData, data: 'signed' });
    await Promise.resolve();
    expect(settled).toMatchObject({ data: 'signed' });
  });
});

describe('approval ports only trust our own pages', () => {
  it('popup: a forged content-script port cannot answer the approval', async () => {
    const { Messaging } = await import('./messaging');
    const { METHOD } = await import('./config');
    let settled: unknown;
    void Messaging.sendToPopupInternal(42, { method: 'signTx', data: { tx: 'ab' } } as never).then(r => { settled = r; });

    const forged = fakePort('internal-background-popup-communication', CONTENT);
    connectListeners.forEach(l => l(forged.port));
    forged.emit({ tabId: 42, method: METHOD.requestData });
    forged.emit({ tabId: 42, method: METHOD.returnData, data: true });
    await Promise.resolve();
    expect(forged.posted).toEqual([]); // never even saw the request payload
    expect(settled).toBeUndefined();

    const real = fakePort('internal-background-popup-communication', PAGE);
    connectListeners.forEach(l => l(real.port));
    real.emit({ tabId: 42, method: METHOD.returnData, data: 'signed' });
    await Promise.resolve();
    expect(settled).toMatchObject({ data: 'signed' });
  });

  it('side panel: a forged content-script port cannot answer the approval', async () => {
    const { Messaging } = await import('./messaging');
    const { METHOD } = await import('./config');
    let settled: unknown;
    void Messaging.sendToSidePanelInternal(7, { method: 'signData', data: {} } as never).then(r => { settled = r; });

    const forged = fakePort('anything', CONTENT);
    connectListeners.forEach(l => l(forged.port));
    forged.emit({ tabId: 7, method: METHOD.requestData });
    forged.emit({ tabId: 7, method: METHOD.returnData, data: true });
    await Promise.resolve();
    expect(forged.posted).toEqual([]);
    expect(settled).toBeUndefined();

    const real = fakePort('anything', PAGE);
    connectListeners.forEach(l => l(real.port));
    real.emit({ tabId: 7, method: METHOD.returnData, data: 'ok' });
    await Promise.resolve();
    expect(settled).toMatchObject({ data: 'ok' });
  });
});
