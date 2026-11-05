import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORDER_SPEND_BOUND, ORDER_OVERHEAD_MAX_LOVELACE, SERVICE_FEE_MIN_LOVELACE, TOKEN_SALE_LIMIT_ADA, aggregatorFeeCap,
  routeFromQuoteEvent, swapSpendBound, toBaseUnits,
} from '../orderSpendBound';

const ADA = 1_000_000n;
const TOKEN = `${'ab'.repeat(28)}474552`;
const adaLeg = (intent: Parameters<typeof swapSpendBound>[0]) =>
  swapSpendBound(intent).maxOutflow.get('lovelace')! - (intent.tokenIn === 'lovelace' ? intent.amountIn : 0n);

describe('swap spend budget', () => {
  it('allows the amount typed plus the largest DEX overhead and the minimum service fee for an ordinary swap', () => {
    // 50 ADA: 5 ADA at 10 bps is below the 1.2 ADA minimum. No flat floor on top.
    expect(swapSpendBound({ tokenIn: 'lovelace', amountIn: 50n * ADA }).maxOutflow.get('lovelace')).toBe(56_700_000n);
  });

  it('raises the leg only by the service fee at 10 bps of a large ADA sale', () => {
    // 100,000 ADA: 100 ADA at 10 bps, plus the largest DEX overhead.
    expect(adaLeg({ tokenIn: 'lovelace', amountIn: 100_000n * ADA })).toBe(100n * ADA + ORDER_OVERHEAD_MAX_LOVELACE);
  });

  it('budgets a token sale as the tokens typed plus the minimum service fee only, however large', () => {
    const bound = swapSpendBound({ tokenIn: TOKEN, amountIn: 10n ** 15n });
    expect(bound.maxOutflow.get(TOKEN)).toBe(10n ** 15n);
    expect(bound.maxOutflow.get('lovelace')).toBe(ORDER_OVERHEAD_MAX_LOVELACE + SERVICE_FEE_MIN_LOVELACE);
  });

  it('puts the token-sale limit where 10 bps reaches the 1.2 ADA minimum', () => {
    expect(TOKEN_SALE_LIMIT_ADA).toBe(1_200n);
    // An ADA sale of that size is still charged only the minimum.
    expect(adaLeg({ tokenIn: 'lovelace', amountIn: TOKEN_SALE_LIMIT_ADA * ADA })).toBe(ORDER_OVERHEAD_MAX_LOVELACE + SERVICE_FEE_MIN_LOVELACE);
  });
});

describe('quote events', () => {
  it('reads the route a quote event carries, or nothing', () => {
    expect(routeFromQuoteEvent([{ route: { tokenIn: 'lovelace', amountIn: '5' } }])).toEqual({ tokenIn: 'lovelace', amountIn: '5' });
    expect(routeFromQuoteEvent({ route: { tokenIn: '', amountIn: '5' } })).toBeNull();
    expect(routeFromQuoteEvent({ route: { tokenIn: 'lovelace', amountIn: '-5' } })).toBeNull();
    expect(routeFromQuoteEvent(null)).toBeNull();
  });
});

describe('typed amounts', () => {
  it('converts the way the widget does, cutting extra decimals', () => {
    expect(toBaseUnits('1.5', 6)).toBe(1_500_000n);
    expect(toBaseUnits('1.1234567', 6)).toBe(1_123_456n);
    expect(toBaseUnits('.5', 6)).toBe(500_000n);
    expect(toBaseUnits('5.', 6)).toBe(5_000_000n);
    expect(toBaseUnits('12.9', 0)).toBe(12n);
    expect(toBaseUnits(' 7 ', 2)).toBe(700n);
  });

  it('refuses anything that is not a plain non-negative decimal', () => {
    for (const bad of ['', '.', '-1', '1e3', 'abc', '1,000', undefined, null, {}]) {
      expect(toBaseUnits(bad, 6)).toBeNull();
    }
    expect(toBaseUnits('1', -1)).toBeNull();
    expect(toBaseUnits('1', 1.5)).toBeNull();
  });

});

describe('aggregator fee cap', () => {
  /** What cardano-market-data charges an ADA sale: max(ceil(amount x 0.001), 0.5 ADA), floored to a 1.2 ADA output. */
  const builderFee = (amountIn: bigint) => {
    const rated = (amountIn + 999n) / 1_000n;
    const fee = rated > 500_000n ? rated : 500_000n;
    return fee > 1_200_000n ? fee : 1_200_000n;
  };

  it('is the 1.2 ADA minimum output for an ordinary swap', () => {
    expect(aggregatorFeeCap(swapSpendBound({ tokenIn: 'lovelace', amountIn: 50n * ADA }))).toBe(SERVICE_FEE_MIN_LOVELACE);
  });

  it('never falls below what the aggregator charges an ADA sale, and exceeds it by about a thousandth at most', () => {
    for (const amountIn of [1n, 2n * ADA, 1_199n * ADA, 1_200n * ADA, 1_201n * ADA, 12_345_678_901n, 100_000n * ADA, 10n ** 15n]) {
      const fee = builderFee(amountIn);
      const cap = aggregatorFeeCap(swapSpendBound({ tokenIn: 'lovelace', amountIn }));
      expect(cap).toBeGreaterThanOrEqual(fee);
      // The budget also holds the order leg (overhead and the fee itself), so 10 bps of that rides on top.
      expect(cap - fee).toBeLessThanOrEqual(fee / 1_000n + ORDER_OVERHEAD_MAX_LOVELACE / 1_000n + 1n);
    }
  });

  it('is the minimum for a token sale, whatever its size: the wallet has no ADA side to trust', () => {
    expect(aggregatorFeeCap(swapSpendBound({ tokenIn: TOKEN, amountIn: 10n ** 15n }))).toBe(SERVICE_FEE_MIN_LOVELACE);
  });

  it('is the minimum without a quote', () => {
    expect(aggregatorFeeCap(DEFAULT_ORDER_SPEND_BOUND)).toBe(SERVICE_FEE_MIN_LOVELACE);
  });
});
