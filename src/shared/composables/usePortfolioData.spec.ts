import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope, ref } from 'vue';

// A first-time wallet's value history answers 202 PENDING until its full history is fetched.
// The chart must say so (not "no data"), ask again after the server's hint, and stop on
// unmount or when a newer request (timeframe, mode, wallet) replaces the pending one.

const ADDR = 'addr1qxwallet';
const { loadForTimeframe } = vi.hoisted(() => ({ loadForTimeframe: vi.fn() }));

vi.mock('@/db/portfolio-cache', () => ({
  PortfolioCacheService: class {
    usdToEurRate = 1;
    loadForTimeframe = loadForTimeframe;
  },
}));
vi.mock('@/shared/composables/useCurrencyConverter', () => ({
  useCurrencyConverter: () => ({ usdToEurRate: ref(1), loadExchangeRate: vi.fn() }),
}));

const pendingResult = (pendingRetryAfterSeconds = 30) =>
  ({ adaData: [], usdData: [], eurData: [], pendingRetryAfterSeconds });
const readyResult = () =>
  ({ adaData: [[1_000, 5]], usdData: [[1_000, 2]], eurData: [[1_000, 1.8]] });

async function load() {
  const { usePortfolioData } = await import('./usePortfolioData');
  const scope = effectScope();
  const portfolio = scope.run(() => usePortfolioData())!;
  return { portfolio, scope };
}

describe('usePortfolioData: 202 PENDING', () => {
  beforeEach(() => {
    vi.resetModules();
    loadForTimeframe.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks the history pending, then loads it after the hint', async () => {
    const { portfolio } = await load();
    loadForTimeframe.mockResolvedValueOnce(pendingResult(30)).mockResolvedValueOnce(readyResult());

    await portfolio.loadForTimeframe(ADDR, '7d', false);
    expect(portfolio.historyPending.value).toBe(true);
    expect(portfolio.adaData.value).toEqual([]);
    expect(portfolio.isLoading.value).toBe(false);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(loadForTimeframe).toHaveBeenCalledTimes(2);
    expect(loadForTimeframe).toHaveBeenLastCalledWith(ADDR, '7d', false);
    expect(portfolio.historyPending.value).toBe(false);
    expect(portfolio.adaData.value).toEqual([[1_000, 5]]);
  });

  it('stops asking on unmount', async () => {
    const { portfolio, scope } = await load();
    loadForTimeframe.mockResolvedValue(pendingResult(30));

    await portfolio.loadForTimeframe(ADDR, '7d', false);
    scope.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(loadForTimeframe).toHaveBeenCalledTimes(1);
  });

  it('a newer request replaces the pending retry', async () => {
    const { portfolio } = await load();
    loadForTimeframe.mockResolvedValueOnce(pendingResult(30)).mockResolvedValue(readyResult());

    await portfolio.loadForTimeframe(ADDR, '7d', false);
    await portfolio.loadForTimeframe(ADDR, '30d', true);
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(loadForTimeframe.mock.calls).toEqual([[ADDR, '7d', false], [ADDR, '30d', true]]);
    expect(portfolio.historyPending.value).toBe(false);
  });

  it('gives up polling after 30 minutes and stays pending', async () => {
    const { portfolio } = await load();
    loadForTimeframe.mockResolvedValue(pendingResult(300));

    await portfolio.loadForTimeframe(ADDR, '7d', false);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    const calls = loadForTimeframe.mock.calls.length;

    expect(calls).toBeLessThanOrEqual(1 + 30 / 5);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(loadForTimeframe).toHaveBeenCalledTimes(calls);
    expect(portfolio.historyPending.value).toBe(true);
  });
});
