// src/services/copilot/detectors.spec.ts
import { describe, it, expect } from 'vitest';
import { detectPriceMoves, type TokenSnapshot } from './detectors';

const snap = (over: Partial<TokenSnapshot>): TokenSnapshot => ({
  unit: 'u', ticker: 'SNEK', held: true, priceChange24h: 0, priceChange7d: 0, ...over,
});

describe('detectPriceMoves', () => {
  it('flags a 24h up-move beyond the threshold', () => {
    const events = detectPriceMoves([snap({ priceChange24h: 22 })], { pct24h: 15 }, 'day-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'priceUp', ticker: 'SNEK', window: '24h', pct: 22 });
    expect(events[0].key).toBe('priceUp:24h:u:day-1');
  });

  it('flags a 24h down-move beyond the threshold', () => {
    const events = detectPriceMoves([snap({ priceChange24h: -30 })], { pct24h: 15 }, 'day-1');
    expect(events[0]).toMatchObject({ kind: 'priceDown', window: '24h', pct: 30 });
  });

  it('ignores moves within the threshold', () => {
    expect(detectPriceMoves([snap({ priceChange24h: 5 })], { pct24h: 15 }, 'day-1')).toEqual([]);
  });

  it('reports at most one move per token (largest-magnitude window wins)', () => {
    const events = detectPriceMoves([snap({ priceChange24h: 16, priceChange7d: -40 })], { pct24h: 15, pct7d: 15 }, 'day-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ window: '7d', kind: 'priceDown', pct: 40 });
  });
});
