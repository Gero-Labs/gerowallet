/**
 * Background-side rules that make the wallet lock more than a UI screen.
 *
 *  - `unlockThrottle`: exponential back-off on failed unlock attempts, per
 *    secrets record, kept in chrome.storage.session so a service-worker restart
 *    does not reset it.
 *  - `preLoginGrants` + `mustLockAfterLogin`: a LOGIN never turns a locked (or
 *    logged-out) session into an unlocked one without a credential. A wallet with
 *    an unlock method lands locked unless its pre-login unlock was just verified.
 *  - `verifySecondFactor`: the 2FA check every unlock path shares.
 *
 * None of this makes keys reachable or unreachable: signing still needs the
 * spending password, the PassKey or a fresh MPC session. It closes the gap where
 * an options-channel caller could unlock the UI and its settings without one.
 */

// ---------------------------------------------------------------------------
// Unlock attempt throttle
// ---------------------------------------------------------------------------

/** Failed attempts allowed before the first wait. */
export const UNLOCK_FREE_ATTEMPTS = 5;
/** First wait, doubled with every further failure. */
export const UNLOCK_BASE_DELAY_MS = 30_000;
/** Longest wait. */
export const UNLOCK_MAX_DELAY_MS = 15 * 60_000;

/** Wait imposed after the `failures`-th consecutive failure (0 while attempts are free). */
export function unlockDelayAfter(failures: number): number {
  if (failures < UNLOCK_FREE_ATTEMPTS) return 0;
  const doublings = Math.min(failures - UNLOCK_FREE_ATTEMPTS, 20);
  return Math.min(UNLOCK_BASE_DELAY_MS * 2 ** doublings, UNLOCK_MAX_DELAY_MS);
}

let formatThrottleMessage = (seconds: number): string => `Too many attempts. Try again in ${seconds} seconds.`;

/**
 * The text a back-off error carries. The worker installs its translated
 * `unlockGuard.tooManyAttempts` at startup, so a page that shows a handler's
 * error message as-is (a signing flow, for one) shows the wait in the user's
 * language.
 */
export function setUnlockThrottleMessage(format: (seconds: number) => string): void {
  formatThrottleMessage = format;
}

/** Thrown when an unlock is attempted during a back-off. Carries the remaining wait. */
export class UnlockThrottledError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(formatThrottleMessage(Math.ceil(retryAfterMs / 1000)));
    this.name = 'UnlockThrottledError';
  }
}

interface ThrottleRecord {
  failures: number;
  /** Epoch ms before which no attempt is checked. */
  until: number;
}

export interface ThrottleStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

/** chrome.storage.session: survives worker restarts, cleared with the browser session, never on disk. */
export const sessionThrottleStorage: ThrottleStorage = {
  async get(key) {
    return (await chrome.storage.session.get(key))?.[key];
  },
  async set(key, value) {
    await chrome.storage.session.set({ [key]: value });
  },
  async remove(key) {
    await chrome.storage.session.remove(key);
  },
};

function asRecord(value: unknown): ThrottleRecord {
  const r = value as Partial<ThrottleRecord> | undefined;
  return {
    failures: typeof r?.failures === 'number' && r.failures >= 0 ? r.failures : 0,
    until: typeof r?.until === 'number' ? r.until : 0,
  };
}

export function createUnlockThrottle(storage: ThrottleStorage = sessionThrottleStorage, now: () => number = Date.now) {
  const keyFor = (walletId: number) => `unlockThrottle:${walletId}`;
  // The worker's own copy of every record. Storage carries the count across a
  // worker restart; this copy keeps a storage error (a full session quota, an
  // unreadable record) from ever loosening the back-off within one worker.
  const kept = new Map<number, ThrottleRecord>();
  /** The stricter of the stored record and the worker's copy. Never throws. */
  async function current(walletId: number): Promise<ThrottleRecord> {
    const own = kept.get(walletId) ?? { failures: 0, until: 0 };
    let stored: ThrottleRecord;
    try {
      stored = asRecord(await storage.get(keyFor(walletId)));
    } catch {
      return own;
    }
    return { failures: Math.max(own.failures, stored.failures), until: Math.max(own.until, stored.until) };
  }
  return {
    /** Throws `UnlockThrottledError` while `walletId` is in a back-off, and nothing else. */
    async assertAllowed(walletId: number): Promise<void> {
      const { until } = await current(walletId);
      const wait = until - now();
      if (wait > 0) throw new UnlockThrottledError(wait);
    },
    /**
     * Count a wrong credential. Returns the wait it imposes (0 while attempts are
     * free). The worker's copy counts it even when storing it fails.
     */
    async recordFailure(walletId: number): Promise<number> {
      const failures = (await current(walletId)).failures + 1;
      const wait = unlockDelayAfter(failures);
      const record = { failures, until: wait > 0 ? now() + wait : 0 };
      kept.set(walletId, record);
      await storage.set(keyFor(walletId), record);
      return wait;
    },
    async recordSuccess(walletId: number): Promise<void> {
      kept.delete(walletId);
      await storage.remove(keyFor(walletId));
    },
  };
}

export const unlockThrottle = createUnlockThrottle();

type UnlockThrottle = ReturnType<typeof createUnlockThrottle>;

async function bestEffort(count: () => Promise<unknown>): Promise<void> {
  try {
    await count();
  } catch {
    // Counting is best-effort: a storage error never blocks or fails the check.
  }
}

/**
 * Check one secret that guards `walletId`'s secrets record under the same back-off
 * as unlocking: refused (UnlockThrottledError) while a wait runs, a wrong secret
 * counted, a right one clearing the count. Unlocking, the spending password and an
 * MPC wallet's device secret all share one counter per secrets record, so none of
 * them is a second, unthrottled way to guess the same secret.
 *
 * `rejected` says whether a result is a wrong secret; a throw counts as one unless
 * `rejection` says it is something else (a network error, a missing record).
 */
export async function withUnlockThrottle<T>(
  walletId: number,
  attempt: () => Promise<T>,
  outcome: { rejected: (result: T) => boolean; rejection?: (error: unknown) => boolean },
  throttle: UnlockThrottle = unlockThrottle,
): Promise<T> {
  await throttle.assertAllowed(walletId);
  let result: T;
  try {
    result = await attempt();
  } catch (error) {
    if (outcome.rejection ? outcome.rejection(error) : true) await bestEffort(() => throttle.recordFailure(walletId));
    throw error;
  }
  await bestEffort(() => (outcome.rejected(result) ? throttle.recordFailure(walletId) : throttle.recordSuccess(walletId)));
  return result;
}

// ---------------------------------------------------------------------------
// Login lock policy
// ---------------------------------------------------------------------------

/** How long a verified pre-login unlock stays valid for the LOGIN that follows it. */
export const PRE_LOGIN_GRANT_TTL_MS = 2 * 60_000;

/**
 * One-shot proof that a wallet group's pre-login unlock (VERIFY_PRE_LOGIN_UNLOCK)
 * just succeeded. Kept in worker memory: if the worker dies in between, the LOGIN
 * lands locked and the user unlocks again, which is the safe direction.
 */
export function createPreLoginGrants(now: () => number = Date.now) {
  const grants = new Map<number, number>();
  return {
    grant(groupId: number): void {
      grants.set(groupId, now() + PRE_LOGIN_GRANT_TTL_MS);
    },
    /** True (once) when `groupId` has an unexpired grant. */
    consume(groupId: number): boolean {
      const expires = grants.get(groupId);
      grants.delete(groupId);
      return expires !== undefined && expires > now();
    },
  };
}

export const preLoginGrants = createPreLoginGrants();

export interface LoginLockInput {
  /** MPC wallets are gated by walletManager on their reconstructed session key instead. */
  targetIsMpc: boolean;
  /** The target's secrets record has an unlock method configured. */
  hasUnlockMethod: boolean;
  /** A pre-login unlock for the target's group was just verified. */
  preLoginVerified: boolean;
  /** A wallet was logged in before this LOGIN. */
  priorLoggedIn: boolean;
  /** That session was locked. */
  priorLocked: boolean;
}

/**
 * Whether a LOGIN must leave the target locked. Switching from an unlocked
 * session keeps today's behaviour; a LOGIN from a locked or logged-out session
 * needs a verified pre-login unlock, so LOGOUT followed by LOGIN never unlocks.
 */
export function mustLockAfterLogin(input: LoginLockInput): boolean {
  if (input.targetIsMpc || !input.hasUnlockMethod || input.preLoginVerified) return false;
  return !input.priorLoggedIn || input.priorLocked;
}

// ---------------------------------------------------------------------------
// Second factor
// ---------------------------------------------------------------------------

interface ConfigLookup {
  where(query: { key: string }): { first(): Promise<{ value?: unknown } | undefined> };
}

/**
 * The 2FA step of an unlock. True when 2FA is off, or the TOTP code checks out
 * against the secret sealed under `password`. Throws when 2FA is on and the code
 * or the password is missing, or the secret is not stored.
 */
export async function verifySecondFactor(configTable: ConfigLookup, totpCode?: string, password?: string): Promise<boolean> {
  const twoFactorConfig = await configTable.where({ key: 'twoFactorEnabled' }).first();
  if (twoFactorConfig?.value !== true) return true;
  if (!totpCode || !password) {
    throw new Error('2FA enabled but TOTP code or password not provided');
  }
  const totpSecretConfig = await configTable.where({ key: 'encryptedTotpSecret' }).first();
  if (!totpSecretConfig?.value) {
    throw new Error('TOTP secret not found');
  }
  const { decryptSecurityData, verifyTotpCode } = await import('@/shared/utils/security');
  const totpSecret = decryptSecurityData(totpSecretConfig.value as string | string[], password) as string;
  return verifyTotpCode(totpCode, totpSecret);
}
