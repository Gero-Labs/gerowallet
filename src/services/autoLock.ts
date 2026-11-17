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

/** The background alarm that runs {@link checkAutoLock}, and how often it fires. */
export const AUTO_LOCK_ALARM = 'auto-lock-check';
export const AUTO_LOCK_PERIOD_MINUTES = 1;

/** What one auto-lock tick reads and does; background.ts wires the wallet store, the wallet DBs and walletManager. */
export interface AutoLockDeps<W extends { id: number | string }> {
  loggedWallet: () => W | null | undefined;
  isLocked: () => boolean;
  /** The record whose DB holds the lock settings: account #0 of the wallet's group. */
  settingsWalletId: (wallet: W) => W['id'];
  /** A row of the per-wallet `config` table, or undefined. */
  readConfig: (walletId: W['id'], key: string) => Promise<{ value?: unknown } | undefined>;
  lock: () => Promise<unknown>;
  now: () => number;
}

/**
 * One auto-lock tick, run by the {@link AUTO_LOCK_ALARM} alarm. Locks the logged
 * wallet when a lock method is set and it has been inactive for at least
 * `autoLockMinutes`. An added account's lock settings are its account #0's; its
 * activity is tracked on the account itself. A wallet with no recorded activity
 * yet (just logged in) is skipped. Returns whether it locked.
 */
export async function checkAutoLock<W extends { id: number | string }>(deps: AutoLockDeps<W>): Promise<boolean> {
  const wallet = deps.loggedWallet();
  if (!wallet || deps.isLocked()) return false;
  const settingsId = deps.settingsWalletId(wallet);
  const [autoLock, unlockMethod, lastActivity] = await Promise.all([
    deps.readConfig(settingsId, 'autoLockMinutes'),
    deps.readConfig(settingsId, 'unlockMethod'),
    deps.readConfig(wallet.id, 'lastActivityTimestamp'),
  ]);
  const lastActivityAt = Number(lastActivity?.value);
  if (!lastActivityAt) return false;
  const autoLockMinutes = Number(autoLock?.value) || 0;
  const inactiveMinutes = (deps.now() - lastActivityAt) / (1000 * 60);
  if (!shouldAutoLock({ autoLockMinutes, hasUnlockMethod: !!unlockMethod?.value, inactiveMinutes })) return false;
  await deps.lock();
  return true;
}
