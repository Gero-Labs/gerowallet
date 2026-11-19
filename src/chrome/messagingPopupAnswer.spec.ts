import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A popup approval (sendToPopupInternal) is answered exactly once: by the
 * popup's returnData, or with the declined error when the user closes the popup
 * (its port disconnects or its tab is removed). Nothing after the first answer
 * changes it, and another popup closing never answers this one.
 */

const OWN = 'abcdefghijklmnopabcdefghijklmnop';
const PAGE: chrome.runtime.MessageSender = { id: OWN, url: `chrome-extension://${OWN}/popup/index.html` };
const PORT_NAME = 'internal-background-popup-communication';

type Listener<T extends unknown[]> = (...args: T) => void;
function event<T extends unknown[]>() {
  let listeners: Array<Listener<T>> = [];
  return {
    addListener: (fn: Listener<T>) => { listeners.push(fn); },
    removeListener: (fn: Listener<T>) => { listeners = listeners.filter(l => l !== fn); },
    emit: (...args: T) => listeners.slice().forEach(fn => fn(...args)),
    count: () => listeners.length,
  };
}

let onConnect: ReturnType<typeof event<[chrome.runtime.Port]>>;
let onTabRemoved: ReturnType<typeof event<[number]>>;

/** A popup page's port; with `tab`, its sender names the popup tab as Chrome does. */
function popupPort(tab?: number) {
  const onMessage = event<[unknown]>();
  const onDisconnect = event<[]>();
  const posted: unknown[] = [];
  const port = {
    name: PORT_NAME,
    sender: tab === undefined ? PAGE : { ...PAGE, tab: { id: tab } as chrome.tabs.Tab },
    postMessage: (m: unknown) => posted.push(m),
    onMessage,
    onDisconnect,
  } as unknown as chrome.runtime.Port;
  onConnect.emit(port);
  return { posted, send: (m: unknown) => onMessage.emit(m), close: () => onDisconnect.emit() };
}

beforeEach(() => {
  onConnect = event();
  onTabRemoved = event();
  vi.stubGlobal('chrome', {
    runtime: { id: OWN, getURL: (p: string) => `chrome-extension://${OWN}/${p}`, onConnect },
    tabs: { onRemoved: onTabRemoved },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function request(tabId: number, method = 'signTx') {
  const { Messaging } = await import('./messaging');
  const { METHOD } = await import('./config');
  const answers: unknown[] = [];
  void Messaging.sendToPopupInternal(tabId, { method, data: { tx: 'ab' } } as never).then(r => answers.push(r));
  const settle = () => new Promise(r => setTimeout(r, 0));
  return { answers, METHOD, settle };
}

describe('popup approval: answered exactly once', () => {
  it('a second returnData, a later close or tab removal never changes the first answer', async () => {
    const { answers, METHOD, settle } = await request(42);
    const popup = popupPort();
    popup.send({ tabId: 42, method: METHOD.requestData });
    expect(popup.posted).toHaveLength(1);
    popup.send({ tabId: 42, method: METHOD.returnData, data: 'signed' });
    popup.send({ tabId: 42, method: METHOD.returnData, data: 'second' });
    popup.close();
    onTabRemoved.emit(42);
    await settle();
    expect(answers).toEqual([expect.objectContaining({ data: 'signed' })]);
    expect(onConnect.count()).toBe(0);
    expect(onTabRemoved.count()).toBe(0);
  });

  it('closing the popup (its port disconnects) declines the pending request once', async () => {
    const { answers, METHOD, settle } = await request(42);
    const popup = popupPort();
    popup.send({ tabId: 42, method: METHOD.requestData });
    popup.close();
    onTabRemoved.emit(42);
    await settle();
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ error: expect.anything() });
    expect(answers[0]).not.toHaveProperty('data');
  });

  it('removing the popup tab declines the pending request once', async () => {
    const { answers, METHOD, settle } = await request(42);
    const popup = popupPort();
    popup.send({ tabId: 42, method: METHOD.requestData });
    onTabRemoved.emit(42);
    popup.close();
    await settle();
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ error: expect.anything() });
  });

  it('a popup closed before its page connects still declines the request', async () => {
    const { answers, settle } = await request(42);
    onTabRemoved.emit(42);
    await settle();
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ error: expect.anything() });
    expect(onConnect.count()).toBe(0);
  });

  it('closing the popup of another request never answers this one', async () => {
    const first = await request(42);
    const second = await request(43);
    const popupA = popupPort();
    const popupB = popupPort();
    popupA.send({ tabId: 42, method: first.METHOD.requestData });
    popupB.send({ tabId: 43, method: first.METHOD.requestData });
    popupB.close();
    onTabRemoved.emit(43);
    await first.settle();
    expect(first.answers).toEqual([]);
    expect(second.answers).toHaveLength(1);
    popupA.send({ tabId: 42, method: first.METHOD.returnData, data: 'signed' });
    await first.settle();
    expect(first.answers).toEqual([expect.objectContaining({ data: 'signed' })]);
  });

  it('does not add a tab listener per message', async () => {
    const { METHOD } = await request(42);
    const popup = popupPort();
    for (let i = 0; i < 5; i++) popup.send({ tabId: 42, method: METHOD.requestData });
    expect(onTabRemoved.count()).toBeLessThanOrEqual(1);
  });

  it('a page that dies before speaking still declines its own popup, never another', async () => {
    const first = await request(42);
    const second = await request(43);
    popupPort(43).close(); // popup 43 crashed before asking for its request
    await first.settle();
    expect(first.answers).toEqual([]);
    expect(second.answers).toEqual([expect.objectContaining({ error: expect.anything() })]);
  });

  it('a port from another popup tab is never bound, whatever tab it claims', async () => {
    const { answers, METHOD, settle } = await request(42);
    const other = popupPort(43);
    other.send({ tabId: 42, method: METHOD.requestData });
    other.send({ tabId: 42, method: METHOD.returnData, data: 'forged' });
    await settle();
    expect(other.posted).toEqual([]);
    expect(answers).toEqual([]);
  });
});

describe('one request per popup tab', () => {
  it('a second signing request for a popup tab already waiting is declined, not given the first answer', async () => {
    const first = await request(42);
    const second = await request(42);
    await first.settle();
    expect(second.answers).toEqual([expect.objectContaining({ error: expect.anything() })]);
    const popup = popupPort(42);
    popup.send({ tabId: 42, method: first.METHOD.requestData });
    expect(popup.posted).toHaveLength(1);
    popup.send({ tabId: 42, method: first.METHOD.returnData, data: 'signed' });
    await first.settle();
    expect(first.answers).toEqual([expect.objectContaining({ data: 'signed' })]);
  });

  it('duplicate enable requests share the popup and its answer', async () => {
    const first = await request(42, 'enable');
    const second = await request(42, 'enable');
    const popup = popupPort(42);
    popup.send({ tabId: 42, method: first.METHOD.returnData, data: true });
    await first.settle();
    expect(first.answers).toEqual([expect.objectContaining({ data: true })]);
    expect(second.answers).toEqual([expect.objectContaining({ data: true })]);
  });

  it('the popup tab takes a new request once the last one is answered', async () => {
    const first = await request(42);
    onTabRemoved.emit(42);
    await first.settle();
    const next = await request(42);
    const popup = popupPort(42);
    popup.send({ tabId: 42, method: next.METHOD.returnData, data: 'signed' });
    await next.settle();
    expect(next.answers).toEqual([expect.objectContaining({ data: 'signed' })]);
  });
});

describe('popup approval: the wallet locks while it waits (issue 1592)', () => {
  it('answers every waiting request with the locked refusal, closes its popup, and ignores a late answer', async () => {
    const removed: number[] = [];
    (globalThis as unknown as { chrome: { tabs: Record<string, unknown> } }).chrome.tabs.remove = (id: number) => { removed.push(id); return Promise.resolve(); };
    const first = await request(42);
    const other = await request(43, 'signData');
    const { Messaging } = await import('./messaging');
    const { APPROVAL_LOCKED_MESSAGE } = await import('./config');
    Messaging.declinePopupApprovalsOnLock();
    await first.settle();
    const locked = { code: -3, info: APPROVAL_LOCKED_MESSAGE };
    expect(first.answers).toEqual([expect.objectContaining({ error: locked })]);
    expect(other.answers).toEqual([expect.objectContaining({ error: locked })]);
    expect(removed.sort()).toEqual([42, 43]);
    // The popup page answering after the lock changes nothing.
    const popup = popupPort(42);
    popup.send({ tabId: 42, method: first.METHOD.returnData, data: 'signed' });
    await first.settle();
    expect(first.answers).toHaveLength(1);
    // A second lock has nothing left to answer, and the tab takes a new request.
    Messaging.declinePopupApprovalsOnLock();
    const next = await request(42);
    popupPort(42).send({ tabId: 42, method: next.METHOD.returnData, data: 'signed' });
    await next.settle();
    expect(next.answers).toEqual([expect.objectContaining({ data: 'signed' })]);
  });

  it('a Midnight request gets the connector Rejected shape', async () => {
    (globalThis as unknown as { chrome: { tabs: Record<string, unknown> } }).chrome.tabs.remove = () => Promise.resolve();
    const { MIDNIGHT_METHOD } = await import('./config');
    const pending = await request(44, MIDNIGHT_METHOD.connect);
    const { Messaging } = await import('./messaging');
    Messaging.declinePopupApprovalsOnLock();
    await pending.settle();
    expect(pending.answers).toEqual([expect.objectContaining({ error: expect.objectContaining({ type: 'DAppConnectorAPIError', code: 'Rejected' }) })]);
  });
});
