import { describe, expect, it, vi } from 'vitest';
import { settlePanelMessage, type PanelPendingEntry } from './dappPanelSettlement';

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
