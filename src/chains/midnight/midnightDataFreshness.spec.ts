import { describe, expect, it } from 'vitest';
import {
  MIDNIGHT_DATA_PAUSED_AFTER_MS,
  MIDNIGHT_TIP_OBSERVED_WITHIN_MS,
  blockTimeToMs,
  isMidnightDataPaused,
  midnightNetworkChipState,
  midnightTipAgeMs,
} from './midnightDataFreshness';

const NOW = Date.parse('2026-01-01T12:00:00Z');
const tipAt = (ageMs: number, observedAt = NOW) => ({ hash: 'ab', height: 1000, timestamp: NOW - ageMs, observedAt });

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

  it('treats a tip not seen in this session as unknown, never paused', () => {
    // Restored from storage after the worker restarted: old block, old sighting.
    expect(isMidnightDataPaused(tipAt(60 * 60_000, NOW - 60 * 60_000), NOW)).toBe(false);
    expect(isMidnightDataPaused({ hash: 'ab', height: 1, timestamp: NOW - 60 * 60_000 }, NOW)).toBe(false);
    expect(isMidnightDataPaused(tipAt(60 * 60_000, NOW - MIDNIGHT_TIP_OBSERVED_WITHIN_MS + 1), NOW)).toBe(true);
  });

  it('keeps a frozen chain paused when the wallet stops seeing tips: it was already old when last seen', () => {
    // Last seen 20 minutes ago, when its block was already 40 minutes old.
    expect(isMidnightDataPaused(tipAt(60 * 60_000, NOW - 20 * 60_000), NOW)).toBe(true);
    // Last seen 20 minutes ago while fresh: unknown, not paused.
    expect(isMidnightDataPaused(tipAt(20 * 60_000 + 6_000, NOW - 20 * 60_000), NOW)).toBe(false);
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
    // A block from six seconds ago, seen and judged by a clock that is off by `skew`.
    expect(isMidnightDataPaused(tipAt(6_000, NOW + skew), NOW + skew)).toBe(false);
    // And a tip that really is old still reads as paused.
    expect(isMidnightDataPaused(tipAt(30 * 60_000, NOW + skew), NOW + skew)).toBe(true);
  });
});

describe('block times', () => {
  it('reads epoch seconds (the latest-block route) and milliseconds (sync frames) as milliseconds', () => {
    expect(blockTimeToMs(1_788_996_846)).toBe(1_788_996_846_000);
    expect(blockTimeToMs(1_788_996_846.5)).toBe(1_788_996_846_500);
    expect(blockTimeToMs(1_788_996_846_001)).toBe(1_788_996_846_001);
  });

  it('is 0 for anything that is not a time', () => {
    for (const v of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, '1788996846', null, undefined]) expect(blockTimeToMs(v)).toBe(0);
  });

  it('a seconds-shaped block time read as-is would have been "paused" forever; normalised it is fresh', () => {
    const seconds = Math.floor((NOW - 6_000) / 1000);
    expect(isMidnightDataPaused({ hash: 'ab', height: 1, timestamp: seconds, observedAt: NOW }, NOW)).toBe(true);
    expect(isMidnightDataPaused({ hash: 'ab', height: 1, timestamp: blockTimeToMs(seconds), observedAt: NOW }, NOW)).toBe(false);
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
