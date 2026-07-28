/**
 * Pure decision for the background auto-lock alarm. Kept side-effect-free so it
 * is unit-testable — the alarm handler (`checkAutoLock` in background.ts) reads
 * config/timestamps and calls this.
 *
 * Deliberately wallet-type agnostic: a wallet auto-locks iff a lock method is
 * configured AND the inactivity timer has elapsed. MPC wallets are NOT special —
 * "None" means no `unlockMethod`, so `hasUnlockMethod` is false and they don't lock,
 * exactly like a Normal wallet set to None.
 */
export function shouldAutoLock(params: {
  autoLockMinutes: number;
  hasUnlockMethod: boolean;
  inactiveMinutes: number;
}): boolean {
  if (params.autoLockMinutes <= 0) return false;
  if (!params.hasUnlockMethod) return false;
  return params.inactiveMinutes >= params.autoLockMinutes;
}
