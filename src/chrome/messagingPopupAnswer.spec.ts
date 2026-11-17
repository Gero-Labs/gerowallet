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

function popupPort() {
  const onMessage = event<[unknown]>();
  const onDisconnect = event<[]>();
  const posted: unknown[] = [];
  const port = {
    name: PORT_NAME,
    sender: PAGE,
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

async function request(tabId: number) {
  const { Messaging } = await import('./messaging');
  const { METHOD } = await import('./config');
  const answers: unknown[] = [];
  void Messaging.sendToPopupInternal(tabId, { method: 'signTx', data: { tx: 'ab' } } as never).then(r => answers.push(r));
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
});
