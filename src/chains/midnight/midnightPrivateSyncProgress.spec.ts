// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { privateSyncPercent, privateSyncProgressOf, sameSyncProgress } from './midnightPrivateSyncProgress';

describe('privateSyncProgressOf', () => {
  it('reads the SDK counters as numbers', () => {
    expect(privateSyncProgressOf({ appliedIndex: 7n, highestRelevantWalletIndex: 40n, isConnected: false }))
      .toEqual({ applied: 7, highest: 40, connected: false });
  });

  it('treats equal counters as no change, and anything else as a change', () => {
    const p = { applied: 7, highest: 40, connected: true };
    expect(sameSyncProgress(p, { ...p })).toBe(true);
    expect(sameSyncProgress(null, p)).toBe(false);
    expect(sameSyncProgress(p, { ...p, applied: 8 })).toBe(false);
    expect(sameSyncProgress(p, { ...p, highest: 41 })).toBe(false);
    expect(sameSyncProgress(p, { ...p, connected: false })).toBe(false);
  });
});

describe('privateSyncPercent', () => {
  it('is 0 without progress or before the first event', () => {
    expect(privateSyncPercent(null)).toBe(0);
    expect(privateSyncPercent(undefined)).toBe(0);
    expect(privateSyncPercent({ applied: 0, highest: 0 })).toBe(0);
    expect(privateSyncPercent({ applied: 0, highest: 100 })).toBe(0);
  });

  it('floors the ratio', () => {
    expect(privateSyncPercent({ applied: 50, highest: 200 })).toBe(25);
    expect(privateSyncPercent({ applied: 1, highest: 3 })).toBe(33);
  });

  it('never reaches 100 while scanning, even past the known tip', () => {
    expect(privateSyncPercent({ applied: 199, highest: 200 })).toBe(99);
    expect(privateSyncPercent({ applied: 200, highest: 200 })).toBe(99);
    expect(privateSyncPercent({ applied: 300, highest: 200 })).toBe(99);
  });

  it('clamps negative or non-finite input to 0', () => {
    expect(privateSyncPercent({ applied: -5, highest: 100 })).toBe(0);
    expect(privateSyncPercent({ applied: Number.NaN, highest: 100 })).toBe(0);
  });
});
