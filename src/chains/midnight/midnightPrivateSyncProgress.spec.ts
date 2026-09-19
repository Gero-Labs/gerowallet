// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { privateSyncPercent } from './midnightPrivateSyncProgress';

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
