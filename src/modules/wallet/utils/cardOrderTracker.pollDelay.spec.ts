import { describe, expect, it } from 'vitest';
import { orderPollDelay } from './cardOrderTracker';

const MINUTE = 60_000;

describe('orderPollDelay', () => {
  it('checks a fresh order every 10 s for its first five minutes', () => {
    expect(orderPollDelay(0)).toBe(10_000);
    expect(orderPollDelay(5 * MINUTE - 1)).toBe(10_000);
  });

  it('checks every minute until the order is an hour old', () => {
    expect(orderPollDelay(5 * MINUTE)).toBe(MINUTE);
    expect(orderPollDelay(60 * MINUTE - 1)).toBe(MINUTE);
  });

  it('checks every five minutes after that', () => {
    expect(orderPollDelay(60 * MINUTE)).toBe(5 * MINUTE);
    expect(orderPollDelay(3 * 24 * 60 * MINUTE)).toBe(5 * MINUTE);
  });

  it('treats an unknown age as fresh', () => {
    expect(orderPollDelay(Number.NaN)).toBe(10_000);
  });
});
