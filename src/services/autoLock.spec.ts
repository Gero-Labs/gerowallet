import { describe, it, expect, vi } from 'vitest';
import { checkAutoLock, shouldAutoLock, type AutoLockDeps } from './autoLock';

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

type TestWallet = { id: number; parentWalletId?: number };
const MINUTE = 60_000;

/** A clock and per-wallet config rows; lock() locks the store like walletManager.lock(). */
function tick(rows: Record<number, Record<string, unknown>>, wallet: TestWallet = { id: 1 }) {
  let locked = false;
  let now = 1; // the activity timestamps below are 1
  const lock = vi.fn(async () => { locked = true; });
  const deps: AutoLockDeps<TestWallet> = {
    loggedWallet: () => wallet,
    isLocked: () => locked,
    settingsWalletId: w => w.parentWalletId ?? w.id,
    readConfig: async (id, key) => (key in (rows[id as number] ?? {}) ? { value: rows[id as number][key] } : undefined),
    lock,
    now: () => now,
  };
  return { run: () => checkAutoLock(deps), lock, advance: (ms: number) => { now += ms; } };
}

describe('auto-lock alarm tick (checkAutoLock)', () => {
  it('locks once the configured inactivity has passed, and only once', async () => {
    const t = tick({ 1: { autoLockMinutes: 5, unlockMethod: 'password', lastActivityTimestamp: 1 } });
    for (let minute = 1; minute < 5; minute++) {
      t.advance(MINUTE);
      expect(await t.run()).toBe(false);
    }
    t.advance(MINUTE);
    expect(await t.run()).toBe(true);
    t.advance(MINUTE);
    expect(await t.run()).toBe(false);
    expect(t.lock).toHaveBeenCalledTimes(1);
  });

  it('never locks without a lock method, with auto-lock off, or before any activity is recorded', async () => {
    for (const rows of [
      { 1: { autoLockMinutes: 1, lastActivityTimestamp: 1 } },
      { 1: { autoLockMinutes: 0, unlockMethod: 'password', lastActivityTimestamp: 1 } },
      { 1: { autoLockMinutes: 1, unlockMethod: 'password' } },
    ]) {
      const t = tick(rows);
      t.advance(60 * MINUTE);
      expect(await t.run()).toBe(false);
      expect(t.lock).not.toHaveBeenCalled();
    }
  });

  it("reads an added account's lock settings from account #0 and its activity from itself", async () => {
    const t = tick({
      1: { autoLockMinutes: 2, unlockMethod: 'passkey', lastActivityTimestamp: 99 * MINUTE },
      2: { lastActivityTimestamp: 1 },
    }, { id: 2, parentWalletId: 1 });
    t.advance(3 * MINUTE);
    expect(await t.run()).toBe(true);
  });

  it('does nothing with no logged wallet', async () => {
    const lock = vi.fn();
    const ran = await checkAutoLock<TestWallet>({
      loggedWallet: () => null, isLocked: () => false, settingsWalletId: w => w.id,
      readConfig: async () => ({ value: 1 }), lock, now: () => 10 * MINUTE,
    });
    expect(ran).toBe(false);
    expect(lock).not.toHaveBeenCalled();
  });
});
