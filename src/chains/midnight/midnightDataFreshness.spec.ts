import { describe, expect, it } from 'vitest';
import {
  MIDNIGHT_DATA_PAUSED_AFTER_MS,
  isMidnightDataPaused,
  midnightNetworkChipState,
  midnightTipAgeMs,
} from './midnightDataFreshness';

const NOW = Date.parse('2026-01-01T12:00:00Z');
const tipAt = (ageMs: number) => ({ hash: 'ab', height: 1000, timestamp: NOW - ageMs });

describe('Midnight data paused', () => {
  it('is paused once the tip\'s block is more than ten minutes old', () => {
    expect(MIDNIGHT_DATA_PAUSED_AFTER_MS).toBe(10 * 60_000);
    expect(isMidnightDataPaused(tipAt(6_000), NOW)).toBe(false);
    expect(isMidnightDataPaused(tipAt(10 * 60_000), NOW)).toBe(false);
    expect(isMidnightDataPaused(tipAt(10 * 60_000 + 1), NOW)).toBe(true);
    expect(isMidnightDataPaused(tipAt(3 * 60 * 60_000), NOW)).toBe(true);
  });

  it('flips as time passes, with no new tip', () => {
    const tip = tipAt(9 * 60_000);
    expect(isMidnightDataPaused(tip, NOW)).toBe(false);
    expect(isMidnightDataPaused(tip, NOW + 2 * 60_000)).toBe(true);
  });

  it('is never paused for an unknown tip or block time', () => {
    expect(isMidnightDataPaused(null, NOW)).toBe(false);
    expect(isMidnightDataPaused({ hash: null, height: 0, timestamp: 0 }, NOW)).toBe(false);
    expect(isMidnightDataPaused({ hash: 'ab', height: 5, timestamp: 0 }, NOW)).toBe(false);
    expect(midnightTipAgeMs({ hash: 'ab', height: 5, timestamp: Number.NaN }, NOW)).toBeNull();
  });

  it.each([
    ['five minutes fast', 5 * 60_000],
    ['five minutes slow', -5 * 60_000],
    ['three minutes fast', 3 * 60_000],
  ])('does not flip on a device clock %s', (_name, skew) => {
    // A block from six seconds ago, read by a clock that is off by `skew`.
    expect(isMidnightDataPaused(tipAt(6_000), NOW + skew)).toBe(false);
    // And a tip that really is old still reads as paused.
    expect(isMidnightDataPaused(tipAt(30 * 60_000), NOW + skew)).toBe(true);
  });
});

describe('Midnight network chip', () => {
  it('never says online for a connected socket that delivers old blocks', () => {
    expect(midnightNetworkChipState('connected', true)).toBe('paused');
    expect(midnightNetworkChipState('connected', false)).toBe('online');
  });

  it('keeps connecting and offline as they were', () => {
    expect(midnightNetworkChipState('connecting', true)).toBe('connecting');
    expect(midnightNetworkChipState('disconnected', true)).toBe('offline');
    expect(midnightNetworkChipState('error', false)).toBe('offline');
  });
});
