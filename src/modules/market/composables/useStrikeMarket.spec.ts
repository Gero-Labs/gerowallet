import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nodeProcess from 'node:process';
import { effectScope } from 'vue';

const api = vi.hoisted(() => ({
  getExchangeInfo: vi.fn(),
  get24hrTicker: vi.fn(),
  getPremiumIndex: vi.fn(),
}));

vi.mock('@/api/strike-v2.market', () => ({ strikeMarketApi: api }));

const REFRESH_MS = 30_000;
const timeout = () => Promise.reject(new Error('timeout of 15000ms exceeded'));
const ticker = (symbol: string, lastPrice: string) => ({ symbol, lastPrice });

/** Let pending API promises settle and give Node a turn to report unhandled rejections. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function freshModule() {
  vi.resetModules();
  return import('./useStrikeMarket');
}

describe('useStrikeMarket', () => {
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    unhandled = [];
    nodeProcess.on('unhandledRejection', onUnhandled);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    api.getExchangeInfo.mockResolvedValue({ symbols: [{ symbol: 'ADA-USD', status: 'TRADING' }] });
    api.get24hrTicker.mockResolvedValue([ticker('ADA-USD', '0.50')]);
    api.getPremiumIndex.mockResolvedValue([{ symbol: 'ADA-USD' }]);
  });

  afterEach(() => {
    nodeProcess.off('unhandledRejection', onUnhandled);
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('does not leak an unhandled rejection when the initial load or a refresh fails', async () => {
    api.getExchangeInfo.mockImplementation(timeout);
    api.get24hrTicker.mockImplementation(timeout);
    api.getPremiumIndex.mockImplementation(timeout);
    const { useStrikeMarket } = await freshModule();

    const scope = effectScope();
    const market = scope.run(() => useStrikeMarket())!;
    await settle();
    expect(market.loading.value).toBe(false);

    vi.advanceTimersByTime(REFRESH_MS);
    await settle();

    expect(unhandled).toEqual([]);
    scope.stop();
  });

  it('keeps the last good tickers when a refresh fails', async () => {
    const { useStrikeMarket } = await freshModule();
    const scope = effectScope();
    const market = scope.run(() => useStrikeMarket())!;
    await settle();
    expect(market.getTicker('ADA-USD')?.lastPrice).toBe('0.50');

    api.get24hrTicker.mockImplementation(timeout);
    vi.advanceTimersByTime(REFRESH_MS);
    await settle();

    expect(market.getTicker('ADA-USD')?.lastPrice).toBe('0.50');
    scope.stop();
  });

  it('retries exchange info on the next refresh when the initial load failed', async () => {
    api.getExchangeInfo.mockImplementationOnce(timeout);
    const { useStrikeMarket } = await freshModule();
    const scope = effectScope();
    const market = scope.run(() => useStrikeMarket())!;
    await settle();
    expect(market.symbolNames.value).toEqual([]);

    vi.advanceTimersByTime(REFRESH_MS);
    await settle();

    expect(market.symbolNames.value).toEqual(['ADA-USD']);
    scope.stop();
  });

  it('stops polling once the last consumer is disposed and resumes for the next one', async () => {
    const { useStrikeMarket } = await freshModule();
    const first = effectScope();
    const second = effectScope();
    first.run(() => useStrikeMarket());
    second.run(() => useStrikeMarket());
    await settle();
    expect(api.get24hrTicker).toHaveBeenCalledTimes(1);

    first.stop();
    vi.advanceTimersByTime(REFRESH_MS);
    await settle();
    expect(api.get24hrTicker).toHaveBeenCalledTimes(2);

    second.stop();
    vi.advanceTimersByTime(REFRESH_MS * 3);
    await settle();
    expect(api.get24hrTicker).toHaveBeenCalledTimes(2);

    const third = effectScope();
    third.run(() => useStrikeMarket());
    await settle();
    expect(api.get24hrTicker).toHaveBeenCalledTimes(3);
    third.stop();
  });
});
