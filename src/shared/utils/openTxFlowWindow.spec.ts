import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openTxFlowWindow } from './openTxFlowWindow';

const BASE = 'chrome-extension://gero/index.html#/tx-flow/';
const ID = 'AB'.repeat(32);

const chromeMock = {
  runtime: { getURL: (path: string) => `chrome-extension://gero/${path}` },
  windows: { getAll: vi.fn(), update: vi.fn(), create: vi.fn() },
  tabs: { update: vi.fn() },
};

beforeEach(() => {
  vi.stubGlobal('chrome', chromeMock);
  chromeMock.windows.getAll.mockResolvedValue([]);
  for (const fn of [chromeMock.windows.update, chromeMock.windows.create, chromeMock.tabs.update]) fn.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('openTxFlowWindow', () => {
  it('opens a popup window on the transaction', async () => {
    await openTxFlowWindow(ID);
    expect(chromeMock.windows.create).toHaveBeenCalledWith(expect.objectContaining({
      url: `${BASE}${ID.toLowerCase()}`,
      type: 'popup',
      focused: true,
    }));
  });

  it('points an open flow window at the new transaction instead of opening another', async () => {
    chromeMock.windows.getAll.mockResolvedValue([
      { id: 1, tabs: [{ id: 10, url: 'chrome-extension://gero/index.html#/sign-tx' }] },
      { id: 2, tabs: [{ id: 20, url: `${BASE}${'cd'.repeat(32)}` }] },
    ]);
    await openTxFlowWindow(ID);
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(20, { url: `${BASE}${ID.toLowerCase()}` });
    expect(chromeMock.windows.update).toHaveBeenCalledWith(2, { focused: true });
    expect(chromeMock.windows.create).not.toHaveBeenCalled();
  });

  it('opens nothing for an id that is not a transaction hash', async () => {
    for (const bad of ['', '../welcome', `${'ab'.repeat(32)}?x=1`, 'ab'.repeat(31)]) await openTxFlowWindow(bad);
    expect(chromeMock.windows.create).not.toHaveBeenCalled();
    expect(chromeMock.tabs.update).not.toHaveBeenCalled();
  });
});
