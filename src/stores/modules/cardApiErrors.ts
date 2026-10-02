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
