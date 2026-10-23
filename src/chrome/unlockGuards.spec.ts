import { describe, expect, it } from 'vitest';
import { encryptSecret } from '@/shared/utils/passwordSecret';
import { generateTotpCode } from '@/shared/utils/security';
import {
  PRE_LOGIN_GRANT_TTL_MS,
  UNLOCK_BASE_DELAY_MS,
  UNLOCK_FREE_ATTEMPTS,
  UNLOCK_MAX_DELAY_MS,
  UnlockThrottledError,
  createPreLoginGrants,
  createUnlockThrottle,
  mustLockAfterLogin,
  unlockDelayAfter,
  verifySecondFactor,
  type ThrottleStorage,
} from './unlockGuards';

function memoryStorage(): ThrottleStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key) { return data.get(key); },
    async set(key, value) { data.set(key, value); },
    async remove(key) { data.delete(key); },
  };
}

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('unlock back-off', () => {
  it('allows a few wrong attempts, then doubles the wait up to a cap', () => {
    for (let n = 1; n < UNLOCK_FREE_ATTEMPTS; n++) expect(unlockDelayAfter(n)).toBe(0);
    expect(unlockDelayAfter(UNLOCK_FREE_ATTEMPTS)).toBe(UNLOCK_BASE_DELAY_MS);
    expect(unlockDelayAfter(UNLOCK_FREE_ATTEMPTS + 1)).toBe(2 * UNLOCK_BASE_DELAY_MS);
    expect(unlockDelayAfter(UNLOCK_FREE_ATTEMPTS + 2)).toBe(4 * UNLOCK_BASE_DELAY_MS);
    expect(unlockDelayAfter(UNLOCK_FREE_ATTEMPTS + 50)).toBe(UNLOCK_MAX_DELAY_MS);
  });

  it('refuses attempts during the wait, even with the right credential, and lifts it after', async () => {
    const storage = memoryStorage();
    const c = clock();
    const throttle = createUnlockThrottle(storage, c.now);
    for (let n = 0; n < UNLOCK_FREE_ATTEMPTS - 1; n++) {
      await throttle.assertAllowed(7);
      expect(await throttle.recordFailure(7)).toBe(0);
    }
    await throttle.assertAllowed(7);
    expect(await throttle.recordFailure(7)).toBe(UNLOCK_BASE_DELAY_MS);

    const refused = await throttle.assertAllowed(7).catch(e => e);
    expect(refused).toBeInstanceOf(UnlockThrottledError);
    expect((refused as UnlockThrottledError).retryAfterMs).toBe(UNLOCK_BASE_DELAY_MS);

    c.advance(UNLOCK_BASE_DELAY_MS);
    await expect(throttle.assertAllowed(7)).resolves.toBeUndefined();
    // The next failure waits twice as long.
    expect(await throttle.recordFailure(7)).toBe(2 * UNLOCK_BASE_DELAY_MS);
  });

  it('survives a new throttle instance on the same storage (a worker restart)', async () => {
    const storage = memoryStorage();
    const c = clock();
    const first = createUnlockThrottle(storage, c.now);
    for (let n = 0; n < UNLOCK_FREE_ATTEMPTS; n++) await first.recordFailure(3);
    const afterRestart = createUnlockThrottle(storage, c.now);
    await expect(afterRestart.assertAllowed(3)).rejects.toBeInstanceOf(UnlockThrottledError);
  });

  it('resets on success and keeps wallets apart', async () => {
    const storage = memoryStorage();
    const throttle = createUnlockThrottle(storage, clock().now);
    for (let n = 0; n < UNLOCK_FREE_ATTEMPTS; n++) await throttle.recordFailure(1);
    await expect(throttle.assertAllowed(1)).rejects.toBeInstanceOf(UnlockThrottledError);
    await expect(throttle.assertAllowed(2)).resolves.toBeUndefined();
    await throttle.recordSuccess(1);
    await expect(throttle.assertAllowed(1)).resolves.toBeUndefined();
    expect(await throttle.recordFailure(1)).toBe(0);
  });

  it('treats a corrupt stored record as no failures', async () => {
    const storage = memoryStorage();
    storage.data.set('unlockThrottle:9', { failures: 'many', until: 'later' });
    const throttle = createUnlockThrottle(storage, clock().now);
    await expect(throttle.assertAllowed(9)).resolves.toBeUndefined();
    expect(await throttle.recordFailure(9)).toBe(0);
  });
});

describe('pre-login grants', () => {
  it('are one-shot and expire', () => {
    const c = clock();
    const grants = createPreLoginGrants(c.now);
    expect(grants.consume(5)).toBe(false);
    grants.grant(5);
    expect(grants.consume(6)).toBe(false);
    expect(grants.consume(5)).toBe(true);
    expect(grants.consume(5)).toBe(false);

    grants.grant(5);
    c.advance(PRE_LOGIN_GRANT_TTL_MS + 1);
    expect(grants.consume(5)).toBe(false);
  });
});

describe('mustLockAfterLogin', () => {
  const base = { targetIsMpc: false, hasUnlockMethod: true, preLoginVerified: false, priorLoggedIn: true, priorLocked: false };

  it('never unlocks a locked session: LOGIN while locked lands locked', () => {
    expect(mustLockAfterLogin({ ...base, priorLocked: true })).toBe(true);
  });

  it('never unlocks a logged-out session: LOGOUT then LOGIN lands locked', () => {
    expect(mustLockAfterLogin({ ...base, priorLoggedIn: false })).toBe(true);
  });

  it('opens unlocked after a verified pre-login unlock', () => {
    expect(mustLockAfterLogin({ ...base, priorLoggedIn: false, preLoginVerified: true })).toBe(false);
    expect(mustLockAfterLogin({ ...base, priorLocked: true, preLoginVerified: true })).toBe(false);
  });

  it('keeps switching from an unlocked session as it was', () => {
    expect(mustLockAfterLogin(base)).toBe(false);
  });

  it('leaves wallets without an unlock method, and MPC wallets, to their own rules', () => {
    expect(mustLockAfterLogin({ ...base, priorLoggedIn: false, hasUnlockMethod: false })).toBe(false);
    expect(mustLockAfterLogin({ ...base, priorLocked: true, targetIsMpc: true })).toBe(false);
  });
});

describe('verifySecondFactor', () => {
  const PW = 'spending-password';
  const SECRET = 'JBSWY3DPEHPK3PXP';
  function table(rows: Record<string, unknown>) {
    return { where: ({ key }: { key: string }) => ({ first: async () => (key in rows ? { value: rows[key] } : undefined) }) };
  }

  it('passes when 2FA is off', async () => {
    await expect(verifySecondFactor(table({}))).resolves.toBe(true);
    await expect(verifySecondFactor(table({ twoFactorEnabled: false }))).resolves.toBe(true);
  });

  it('requires the code and the password when 2FA is on', async () => {
    const rows = { twoFactorEnabled: true, encryptedTotpSecret: encryptSecret(SECRET, PW) };
    await expect(verifySecondFactor(table(rows))).rejects.toThrow('2FA enabled');
    await expect(verifySecondFactor(table(rows), '123456')).rejects.toThrow('2FA enabled');
  });

  it('checks the code against the secret sealed under the password', async () => {
    const rows = { twoFactorEnabled: true, encryptedTotpSecret: encryptSecret(SECRET, PW) };
    await expect(verifySecondFactor(table(rows), generateTotpCode(SECRET), PW)).resolves.toBe(true);
    const wrong = generateTotpCode(SECRET) === '000000' ? '111111' : '000000';
    await expect(verifySecondFactor(table(rows), wrong, PW)).resolves.toBe(false);
  });

  it('fails closed when the secret is missing', async () => {
    await expect(verifySecondFactor(table({ twoFactorEnabled: true }), '123456', PW)).rejects.toThrow('TOTP secret not found');
  });
});
