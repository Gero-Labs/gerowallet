import { describe, it, expect } from 'vitest';
import { summarizeBuySell } from '../tradeSide';

// These assertions encode the backend contract: `type` is TOKEN-perspective and
// must be rendered AS-IS. A regression that re-inverts BUY/SELL will fail here.
describe('summarizeBuySell', () => {
  it('counts a BUY (user bought the token) as buy volume — no inversion', () => {
    const summary = summarizeBuySell([{ type: 'BUY', volumeAda: 100 }]);
    expect(summary.buyVolume).toBe(100);
    expect(summary.buyCount).toBe(1);
    expect(summary.sellVolume).toBe(0);
    expect(summary.sellCount).toBe(0);
  });

  it('counts a SELL (user sold the token) as sell volume — no inversion', () => {
    const summary = summarizeBuySell([{ type: 'SELL', volumeAda: 42 }]);
    expect(summary.sellVolume).toBe(42);
    expect(summary.sellCount).toBe(1);
    expect(summary.buyVolume).toBe(0);
    expect(summary.buyCount).toBe(0);
  });

  it('a net-buying feed reports majority BUY (pumping token is not shown as selling)', () => {
    const trades: { type: 'BUY' | 'SELL'; volumeAda: number }[] = [
      { type: 'BUY', volumeAda: 80 },
      { type: 'BUY', volumeAda: 20 },
      { type: 'SELL', volumeAda: 10 },
    ];
    const { buyVolume, sellVolume } = summarizeBuySell(trades);
    expect(buyVolume).toBe(100);
    expect(sellVolume).toBe(10);
    expect(buyVolume).toBeGreaterThan(sellVolume);
  });

  it('ignores non-finite volumes without corrupting totals', () => {
    const summary = summarizeBuySell([
      { type: 'BUY', volumeAda: Number.NaN },
      { type: 'BUY', volumeAda: 5 },
    ]);
    expect(summary.buyVolume).toBe(5);
    expect(summary.buyCount).toBe(2);
  });
});
