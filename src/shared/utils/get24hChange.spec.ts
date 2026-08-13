import { describe, it, expect } from 'vitest';
import { get24hChange } from './resolver';

const DAY = 24 * 3600;
const series = (...points: [number, number][]) => points.map(([time, close]) => ({ time, close }));

describe('get24hChange — divide-by-zero guard (#936)', () => {
  it('returns a finite 0% when the baseline close is 0', () => {
    // Newly-listed or gap-filled token: this rendered "Infinity%" in the
    // Tokens tab before the guard.
    const result = get24hChange(series([0, 0], [2 * DAY, 5]));
    expect(result?.percentChange).toBe(0);
    expect(Number.isFinite(result?.percentChange)).toBe(true);
  });

  it('returns a finite 0% when both closes are 0 (was NaN%)', () => {
    const result = get24hChange(series([0, 0], [2 * DAY, 0]));
    expect(Number.isFinite(result?.percentChange)).toBe(true);
    expect(result?.percentChange).toBe(0);
    expect(Number.isNaN(result?.percentChange as number)).toBe(false);
  });

  it('still computes a real percentage from a non-zero baseline', () => {
    const result = get24hChange(series([0, 100], [2 * DAY, 110]));
    expect(result?.percentChange).toBeCloseTo(10);
    expect(result?.change).toBeCloseTo(10);
  });

  it('handles a genuine decline', () => {
    const result = get24hChange(series([0, 200], [2 * DAY, 150]));
    expect(result?.percentChange).toBeCloseTo(-25);
  });

  it('returns null for insufficient history rather than a broken figure', () => {
    expect(get24hChange(series([0, 100]))).toBeNull();
    expect(get24hChange([])).toBeNull();
    expect(get24hChange(null)).toBeNull();
  });

  it('sorts by time before picking the baseline', () => {
    const result = get24hChange(series([2 * DAY, 110], [0, 100]));
    expect(result?.latestTime).toBe(2 * DAY);
    expect(result?.pastTime).toBe(0);
  });

  it('never yields a non-finite percentChange across the whole matrix', () => {
    for (const past of [0, -0, 0.0000001, 100]) {
      for (const latest of [0, 5, -5, 1e12]) {
        const result = get24hChange(series([0, past], [2 * DAY, latest]));
        expect(Number.isFinite(result?.percentChange)).toBe(true);
      }
    }
  });
});
