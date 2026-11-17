import { describe, expect, it, vi } from 'vitest';
import { admitPanelPort, attachPanelPort, settlePanelMessage, type PanelChannel, type PanelPendingEntry } from './dappPanelSettlement';

function pendingWith(entry: Partial<PanelPendingEntry> = {}) {
  const resolve = vi.fn();
  const pending = new Map<string, PanelPendingEntry>([
    ['r1', { resolve, tabId: 7, method: 'signTx', walletId: 1, ...entry }],
  ]);
  return { pending, resolve };
}

describe('side-panel answers settle a dApp request exactly once', () => {
  it('a second approval, a later reject or a NACK for an answered request settles nothing', () => {
    const { pending, resolve } = pendingWith();
    expect(settlePanelMessage(pending, { requestId: 'r1', type: 'dapp-response', data: 'signed' }, 7, 1)).toBe(true);
    expect(settlePanelMessage(pending, { requestId: 'r1', type: 'dapp-response', data: 'again' }, 7, 1)).toBe(false);
    expect(settlePanelMessage(pending, { requestId: 'r1', type: 'dapp-response', error: 'rejected' }, 7, 1)).toBe(false);
    expect(settlePanelMessage(pending, { requestId: 'r1', type: 'dapp-nack', error: 'x' }, 7, 1)).toBe(false);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ data: 'signed' }));
    expect(pending.size).toBe(0);
  });

  it('a reject is answered once and a later approval cannot overturn it', () => {
    const { pending, resolve } = pendingWith();
    expect(settlePanelMessage(pending, { requestId: 'r1', type: 'dapp-response', error: 'User declined' }, 7, 1)).toBe(true);
    expect(settlePanelMessage(pending, { requestId: 'r1', type: 'dapp-response', data: 'signed' }, 7, 1)).toBe(false);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ error: 'User declined' }));
  });

  it('a NACK answers with its error once', () => {
    const { pending, resolve } = pendingWith();
    expect(settlePanelMessage(pending, { requestId: 'r1', type: 'dapp-nack' }, 7, 1)).toBe(true);
    expect(resolve).toHaveBeenCalledWith({ error: 'unsupported_method' });
    expect(pending.size).toBe(0);
  });

  it('after a worker restart, an answer for a request the worker never issued is dropped', () => {
    const pending = new Map<string, PanelPendingEntry>();
    expect(settlePanelMessage(pending, { requestId: 'from-before-restart', type: 'dapp-response', data: 'signed' }, 7, 1)).toBe(false);
  });

  it("another tab's panel cannot answer; a tabless request goes to any panel", () => {
    const { pending, resolve } = pendingWith();
    expect(settlePanelMessage(pending, { requestId: 'r1', type: 'dapp-response', data: 'signed' }, 8, 1)).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
    const tabless = pendingWith({ tabId: NaN });
    expect(settlePanelMessage(tabless.pending, { requestId: 'r1', type: 'dapp-response', data: 'ok' }, 8, 1)).toBe(true);
  });

  it('ignores messages without a request id or of another type, leaving the request pending', () => {
    const { pending, resolve } = pendingWith();
    for (const message of [null, undefined, {}, { requestId: 1 }, { requestId: 'r1', type: 'dapp-request' }]) {
      expect(settlePanelMessage(pending, message as never, 7, 1)).toBe(false);
    }
    expect(resolve).not.toHaveBeenCalled();
    expect(pending.size).toBe(1);
  });

  it('an approval after a wallet switch is refused; a reject still goes through', () => {
    const approved = pendingWith();
    settlePanelMessage(approved.pending, { requestId: 'r1', type: 'dapp-response', data: 'signed' }, 7, 2);
    expect(approved.resolve).toHaveBeenCalledWith({ error: 'wallet_changed_during_request' });
    const rejected = pendingWith();
    settlePanelMessage(rejected.pending, { requestId: 'r1', type: 'dapp-response', error: 'declined' }, 7, 2);
    expect(rejected.resolve).toHaveBeenCalledWith(expect.objectContaining({ error: 'declined' }));
  });

  it('a connect approval naming the now-active account is honoured after the switch', () => {
    const { pending, resolve } = pendingWith({ method: 'enable' });
    settlePanelMessage(pending, { requestId: 'r1', type: 'dapp-response', data: { accountId: 2 } }, 7, 2);
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ data: { accountId: 2 } }));
  });
});

describe('side-panel port admission', () => {
  const OWN_ID = 'abcdefghijklmnopabcdefghijklmnop';
  const own = { id: OWN_ID, root: `chrome-extension://${OWN_ID}/` };
  const page = { id: OWN_ID, url: `chrome-extension://${OWN_ID}/sidepanel/index.html?tabId=7` };
  const content = { id: OWN_ID, url: 'https://evil.example/', tab: { id: 7 } as chrome.tabs.Tab, frameId: 0 };
  const port = (name: string, sender: chrome.runtime.MessageSender) =>
    ({ name, sender, disconnect: vi.fn() }) as unknown as chrome.runtime.Port & { disconnect: ReturnType<typeof vi.fn> };

  it('registers our own panel page under its tab, or a synthetic key without one', () => {
    let next = -1;
    expect(admitPanelPort(port('mini-gero-dapp-channel:7', page), own, () => next--)).toBe(7);
    expect(admitPanelPort(port('mini-gero-dapp-channel:', page), own, () => next--)).toBe(-1);
    expect(admitPanelPort(port('mini-gero-dapp-channel', page), own, () => next--)).toBe(-2);
  });

  it('refuses and disconnects a content-script port claiming to be the panel', () => {
    const forged = port('mini-gero-dapp-channel:7', content);
    expect(admitPanelPort(forged, own, () => -1)).toBeNull();
    expect(forged.disconnect).toHaveBeenCalled();
  });

  it('ignores other ports without touching them', () => {
    const other = port('store-sync', page);
    expect(admitPanelPort(other, own, () => -1)).toBeNull();
    expect(other.disconnect).not.toHaveBeenCalled();
  });
});

describe('closing the side panel parks a request; a reconnecting panel gets it again', () => {
  type Listener = (message?: unknown) => void;
  /** A connected panel page's port: what the worker posts to it, and its two events. */
  function panelPort() {
    const messages: Listener[] = [];
    const disconnects: Listener[] = [];
    const posted: Array<{ type: string; requestId?: string; requestIds?: string[] }> = [];
    const port = {
      postMessage: (message: never) => posted.push(message),
      disconnect: vi.fn(),
      onMessage: { addListener: (fn: Listener) => messages.push(fn) },
      onDisconnect: { addListener: (fn: Listener) => disconnects.push(fn) },
    } as unknown as chrome.runtime.Port;
    return {
      port, posted,
      answer: (message: unknown) => messages.forEach(fn => fn(message)),
      close: () => disconnects.forEach(fn => fn()),
    };
  }

  function channelWith(...entries: Array<[string, Partial<PanelPendingEntry>]>) {
    const resolves = new Map<string, ReturnType<typeof vi.fn>>();
    const pending = new Map<string, PanelPendingEntry>();
    for (const [id, entry] of entries) {
      const resolve = vi.fn();
      resolves.set(id, resolve);
      pending.set(id, { resolve, tabId: 7, method: 'signTx', walletId: 1, payload: { tx: id }, ...entry });
    }
    const onSettled = vi.fn();
    const channel: PanelChannel = { ports: new Map(), pending, activeWalletId: () => 1, onSettled };
    return { channel, pending, resolves, onSettled };
  }

  it('closing the panel answers nothing and keeps the request; the next panel of that tab gets it and can answer', () => {
    const { channel, pending, resolves, onSettled } = channelWith(['r1', {}]);
    const first = panelPort();
    attachPanelPort(channel, first.port, 7);
    expect(first.posted.map(m => m.type)).toEqual(['dapp-request', 'dapp-live']);
    first.close();
    expect(channel.ports.has(7)).toBe(false);
    expect(resolves.get('r1')).not.toHaveBeenCalled();
    expect(pending.has('r1')).toBe(true);

    const second = panelPort();
    attachPanelPort(channel, second.port, 7);
    expect(second.posted).toEqual([
      { type: 'dapp-request', method: 'signTx', requestId: 'r1', payload: { tx: 'r1' } },
      { type: 'dapp-live', requestIds: ['r1'] },
    ]);
    second.answer({ requestId: 'r1', type: 'dapp-response', data: 'signed' });
    expect(resolves.get('r1')).toHaveBeenCalledTimes(1);
    expect(resolves.get('r1')).toHaveBeenCalledWith(expect.objectContaining({ data: 'signed' }));
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(pending.size).toBe(0);
  });

  it("a panel gets its own tab's and tabless requests, never another tab's", () => {
    const { channel } = channelWith(['mine', {}], ['other', { tabId: 8 }], ['tabless', { tabId: NaN }]);
    const panel = panelPort();
    attachPanelPort(channel, panel.port, 7);
    expect(panel.posted.filter(m => m.type === 'dapp-request').map(m => m.requestId)).toEqual(['mine', 'tabless']);
    expect(panel.posted.at(-1)).toEqual({ type: 'dapp-live', requestIds: ['mine', 'tabless'] });
  });

  it('a new panel for the tab replaces the old port; the old one closing later keeps the new one', () => {
    const { channel } = channelWith(['r1', {}]);
    const old = panelPort();
    attachPanelPort(channel, old.port, 7);
    const next = panelPort();
    attachPanelPort(channel, next.port, 7);
    expect(old.port.disconnect).toHaveBeenCalled();
    old.close();
    expect(channel.ports.get(7)).toBe(next.port);
  });

  it('a panel that dies while requests are re-delivered leaves them parked for the next connect', () => {
    const { channel, pending, resolves } = channelWith(['r1', {}], ['r2', {}]);
    const dying = panelPort();
    (dying.port as { postMessage: unknown }).postMessage = () => { throw new Error('Attempting to use a disconnected port object'); };
    expect(() => attachPanelPort(channel, dying.port, 7)).not.toThrow();
    expect(pending.size).toBe(2);
    expect([...resolves.values()].every(resolve => resolve.mock.calls.length === 0)).toBe(true);
    const next = panelPort();
    attachPanelPort(channel, next.port, 7);
    expect(next.posted.filter(m => m.type === 'dapp-request').map(m => m.requestId)).toEqual(['r1', 'r2']);
  });
});
