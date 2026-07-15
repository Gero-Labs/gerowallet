import { describe, it, expect } from 'vitest';
import { shouldAutoLock } from './autoLock';

describe('shouldAutoLock', () => {
  it('does not lock when auto-lock is disabled (0 minutes)', () => {
    expect(shouldAutoLock({ autoLockMinutes: 0, hasUnlockMethod: true, inactiveMinutes: 999 })).toBe(false);
  });

  it('does not lock when no unlock method is configured', () => {
    // MPC with lock method None, or a Normal wallet with None — either way, nothing to unlock with.
    expect(shouldAutoLock({ autoLockMinutes: 1, hasUnlockMethod: false, inactiveMinutes: 999 })).toBe(false);
  });

  it('does not lock before the inactivity threshold', () => {
    expect(shouldAutoLock({ autoLockMinutes: 5, hasUnlockMethod: true, inactiveMinutes: 4.9 })).toBe(false);
  });

  it('locks once inactivity reaches the threshold and a method is set', () => {
    expect(shouldAutoLock({ autoLockMinutes: 1, hasUnlockMethod: true, inactiveMinutes: 1 })).toBe(true);
    expect(shouldAutoLock({ autoLockMinutes: 5, hasUnlockMethod: true, inactiveMinutes: 10 })).toBe(true);
  });

  it('ignores wallet type entirely (no MPC special-case)', () => {
    // Same inputs → same result regardless of what wallet produced them.
    expect(shouldAutoLock({ autoLockMinutes: 1, hasUnlockMethod: true, inactiveMinutes: 2 })).toBe(true);
  });
});
