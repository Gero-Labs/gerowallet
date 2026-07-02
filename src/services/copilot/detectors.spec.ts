// src/services/copilot/detectors.spec.ts
import { describe, it, expect } from 'vitest';
import {
  detectPriceMoves,
  detectTokenActivitySpikes,
  type TokenSnapshot,
  type TokenActivityRow,
} from './detectors';

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

const row = (over: Partial<TokenActivityRow>): TokenActivityRow => ({
  unit: 'u', ticker: 'SNEK', volume24h: 0, volume7d: 0, ...over,
});

const OPTS = { spikeMultiple: 3, minVolume24h: 1000 };

describe('detectTokenActivitySpikes', () => {
  it('flags a token whose 24h volume is a large multiple of its daily average', () => {
    // daily avg = 7000/7 = 1000; 24h = 6000 -> 6x
    const events = detectTokenActivitySpikes([row({ volume24h: 6000, volume7d: 7000 })], OPTS, 'day-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'tokenActivitySpike', ticker: 'SNEK', mult: 6 });
    expect(events[0].key).toBe('tokenActivitySpike:u:day-1');
  });

  it('ignores tokens below the spike multiple', () => {
    // daily avg = 1000; 24h = 2000 -> 2x < 3x
    expect(detectTokenActivitySpikes([row({ volume24h: 2000, volume7d: 7000 })], OPTS, 'd')).toEqual([]);
  });

  it('ignores tokens below the volume floor even if the multiple is huge', () => {
    // 24h = 500 < 1000 floor (would be 50x)
    expect(detectTokenActivitySpikes([row({ volume24h: 500, volume7d: 70 })], OPTS, 'd')).toEqual([]);
  });

  it('skips tokens with no 7d baseline (null or zero)', () => {
    expect(detectTokenActivitySpikes([row({ volume24h: 9999, volume7d: null })], OPTS, 'd')).toEqual([]);
    expect(detectTokenActivitySpikes([row({ volume24h: 9999, volume7d: 0 })], OPTS, 'd')).toEqual([]);
  });

  it('returns the loudest spikes first and respects the limit', () => {
    const events = detectTokenActivitySpikes(
      [
        row({ unit: 'a', ticker: 'A', volume24h: 4000, volume7d: 7000 }), // 4x
        row({ unit: 'b', ticker: 'B', volume24h: 10000, volume7d: 7000 }), // 10x
        row({ unit: 'c', ticker: 'C', volume24h: 7000, volume7d: 7000 }), // 7x
      ],
      { ...OPTS, limit: 2 },
      'd',
    );
    expect(events.map((e) => e.ticker)).toEqual(['B', 'C']);
  });
});
