import { describe, expect, it } from 'vitest';
import {
  ORDER_LEG_FLOOR_LOVELACE, ORDER_OVERHEAD_MAX_LOVELACE, routeFromQuoteEvent, swapSpendBound, toBaseUnits, tokenValueLovelace,
} from '../orderSpendBound';

const ADA = 1_000_000n;
const TOKEN = `${'ab'.repeat(28)}474552`;
const adaLeg = (intent: Parameters<typeof swapSpendBound>[0]) =>
  swapSpendBound(intent).maxOutflow.get('lovelace')! - (intent.tokenIn === 'lovelace' ? intent.amountIn : 0n);

describe('swap spend budget', () => {
  it('allows the amount typed plus the 12 ADA floor for an ordinary swap', () => {
    expect(swapSpendBound({ tokenIn: 'lovelace', amountIn: 50n * ADA }).maxOutflow.get('lovelace')).toBe(62n * ADA);
  });

  it('raises the leg only by the service fee at 30 bps of a large ADA sale', () => {
    // 100,000 ADA: 300 ADA at 30 bps, plus the largest DEX overhead.
    expect(adaLeg({ tokenIn: 'lovelace', amountIn: 100_000n * ADA })).toBe(300n * ADA + ORDER_OVERHEAD_MAX_LOVELACE);
  });

  it('budgets a token sale as the tokens typed plus a leg sized on the wallet\'s own valuation', () => {
    // Worth 10,000 ADA at the wallet's price; with 2x headroom the fee is sized on 20,000 ADA.
    const bound = swapSpendBound({ tokenIn: TOKEN, amountIn: 500n, tokenValueLovelace: 10_000n * ADA });
    expect(bound.maxOutflow.get(TOKEN)).toBe(500n);
    expect(bound.maxOutflow.get('lovelace')).toBe(60n * ADA + ORDER_OVERHEAD_MAX_LOVELACE);
  });

  it('keeps a token sale without a wallet price to the floor', () => {
    expect(adaLeg({ tokenIn: TOKEN, amountIn: 500n, tokenValueLovelace: null })).toBe(ORDER_LEG_FLOOR_LOVELACE);
    expect(adaLeg({ tokenIn: TOKEN, amountIn: 500n })).toBe(ORDER_LEG_FLOOR_LOVELACE);
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

  it('values tokens at a price per display unit', () => {
    expect(tokenValueLovelace(1_000_000n, 6, 2.5)).toBe(2_500_000n);
    expect(tokenValueLovelace(100n, 0, 0.0001)).toBe(10_000n);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '2', undefined]) {
      expect(tokenValueLovelace(1n, 0, bad)).toBeNull();
    }
  });
});
