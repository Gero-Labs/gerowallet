import i18n from '@/plugins/i18n';

/**
 * What to show when the background refused a spending password
 * (VERIFY_SPENDING_PASSWORD). During the back-off after repeated wrong guesses it
 * answers with `retryAfterMs` instead of checking the password; say how long to
 * wait then, otherwise show the caller's own "wrong password" text.
 */
export function passwordCheckFailure(response: unknown, fallback: string): string {
  const retryAfterMs = (response as { data?: { retryAfterMs?: unknown } } | null | undefined)?.data?.retryAfterMs;
  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
    return String(i18n.t('unlockGuard.tooManyAttempts', { seconds: Math.ceil(retryAfterMs / 1000) }));
  }
  return fallback;
}
