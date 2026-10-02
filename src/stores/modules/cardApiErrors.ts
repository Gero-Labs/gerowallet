/** True for an axios-style error whose response is HTTP 401. */
export function isUnauthorized(error: unknown): boolean {
  return (error as { response?: { status?: number } } | null)?.response?.status === 401;
}

/**
 * Response-error handler for card API calls. The provider has no refresh-token
 * endpoint (only /api/token, /api/revoke-token and /api/logout), so a 401 means
 * the session is over: drop it so the card page falls back to sign-in, then
 * rethrow so the caller's own error handling still runs.
 */
export async function handleCardApiError(error: unknown, expireSession: () => Promise<void>): Promise<never> {
  if (isUnauthorized(error)) {
    await expireSession();
  }
  throw error;
}

/**
 * The provider's own explanation from a failed card API call, when it sent one: a plain-text
 * body, or `error` (string or { message }), `reason` or `message` in a JSON body.
 */
export function providerReason(error: unknown): string | undefined {
  const data = (error as { response?: { data?: unknown } } | null)?.response?.data;
  if (typeof data === 'string') return data.trim() || undefined;
  if (!data || typeof data !== 'object') return undefined;
  const body = data as { error?: { message?: unknown } | unknown; reason?: unknown; message?: unknown };
  const nested = typeof body.error === 'object' && body.error ? (body.error as { message?: unknown }).message : body.error;
  for (const candidate of [nested, body.reason, body.message]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}
