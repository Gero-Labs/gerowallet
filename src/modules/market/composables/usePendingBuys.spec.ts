// The listings a purchase of went out for, or may have. They lose their Buy for as long as the
// purchase can still be on its way: the lock lives at module level, not in a component, so
// leaving the collection page and coming back (the "In your wallet" / "For sale" toggle unmounts
// it) does not give the Buy back.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPendingBuy, markPendingBuy, PENDING_BUY_TTL_MS, prunePendingBuys, resetPendingBuys } from './usePendingBuys';

const POLICY = 'cd'.repeat(28);
const OTHER_POLICY = 'ef'.repeat(28);
const REF_A = `${'01'.repeat(32)}#0`;
const REF_B = `${'02'.repeat(32)}#0`;

beforeEach(() => {
  resetPendingBuys();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('usePendingBuys', () => {
  it('knows a listing whose purchase went out, for that wallet only', () => {
    markPendingBuy(1, POLICY, REF_A);
    expect(isPendingBuy(1, REF_A)).toBe(true);
    expect(isPendingBuy(1, REF_B)).toBe(false);
    expect(isPendingBuy(2, REF_A)).toBe(false);
  });

  it('knows nothing without a wallet', () => {
    markPendingBuy(undefined, POLICY, REF_A);
    expect(isPendingBuy(undefined, REF_A)).toBe(false);
    expect(isPendingBuy(1, REF_A)).toBe(false);
  });

  it('lets go after ten minutes, long enough for the sync to catch up', () => {
    expect(PENDING_BUY_TTL_MS).toBe(10 * 60_000);
    markPendingBuy(1, POLICY, REF_A);
    vi.advanceTimersByTime(PENDING_BUY_TTL_MS - 1);
    expect(isPendingBuy(1, REF_A)).toBe(true);
    vi.advanceTimersByTime(2);
    expect(isPendingBuy(1, REF_A)).toBe(false);
  });

  it('starts the ten minutes again when a purchase of the same listing is marked again', () => {
    markPendingBuy(1, POLICY, REF_A);
    vi.advanceTimersByTime(PENDING_BUY_TTL_MS - 1000);
    markPendingBuy(1, POLICY, REF_A);
    vi.advanceTimersByTime(PENDING_BUY_TTL_MS - 1000);
    expect(isPendingBuy(1, REF_A)).toBe(true);
  });

  describe('prunePendingBuys: a listing that is gone from a collection read in full', () => {
    it('is forgotten, and one still listed is kept', () => {
      markPendingBuy(1, POLICY, REF_A);
      markPendingBuy(1, POLICY, REF_B);
      prunePendingBuys(1, POLICY, new Set([REF_B]));
      expect(isPendingBuy(1, REF_A)).toBe(false);
      expect(isPendingBuy(1, REF_B)).toBe(true);
    });

    it('touches only that wallet\'s entries of that collection', () => {
      markPendingBuy(1, POLICY, REF_A);
      markPendingBuy(1, OTHER_POLICY, REF_B);
      markPendingBuy(2, POLICY, `${'03'.repeat(32)}#0`);
      prunePendingBuys(1, POLICY, new Set());
      expect(isPendingBuy(1, REF_A)).toBe(false);
      expect(isPendingBuy(1, REF_B)).toBe(true);
      expect(isPendingBuy(2, `${'03'.repeat(32)}#0`)).toBe(true);
    });

    it('does nothing without a wallet', () => {
      markPendingBuy(1, POLICY, REF_A);
      prunePendingBuys(undefined, POLICY, new Set());
      expect(isPendingBuy(1, REF_A)).toBe(true);
    });
  });

  it('resetPendingBuys forgets everything', () => {
    markPendingBuy(1, POLICY, REF_A);
    resetPendingBuys();
    expect(isPendingBuy(1, REF_A)).toBe(false);
  });
});
