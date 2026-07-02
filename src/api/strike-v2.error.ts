// Strike Finance v2 API — error-message extraction
//
// Axios surfaces `"Request failed with status code 400"` as `error.message`,
// which hides the actual reason Strike rejected the request. Strike returns the
// reason in the response body as `{ error | message | detail: "..." }`
// (e.g. a minimum-amount message, an unknown-field message, or an
// insufficient-balance message). Prefer that body text — it's authoritative —
// and only fall back to the opaque message / `fallback` when the body has
// nothing usable.

/**
 * Pull the most useful human-readable message out of a Strike API error.
 *
 * @param e        The thrown error (usually an Axios error).
 * @param fallback Message to use when the body has nothing usable.
 */
export function extractStrikeError(e: unknown, fallback: string): string {
  const anyErr = e as
    | { response?: { status?: number; data?: unknown }; message?: string }
    | undefined;
  const data = anyErr?.response?.data;

  let serverMsg = '';
  if (typeof data === 'string') {
    serverMsg = data;
  } else if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    serverMsg = String(d.error ?? d.message ?? d.detail ?? '');
  }
  serverMsg = serverMsg.trim();

  if (serverMsg && serverMsg.toLowerCase() !== 'undefined') {
    // Capitalise the first letter so it reads as a sentence in the UI.
    return serverMsg.charAt(0).toUpperCase() + serverMsg.slice(1);
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/** The raw `{ status, body }` of an Axios-style error, for diagnostic logging. */
export function strikeErrorDebugInfo(e: unknown): { status?: number; body?: unknown } {
  const anyErr = e as { response?: { status?: number; data?: unknown } } | undefined;
  return { status: anyErr?.response?.status, body: anyErr?.response?.data };
}
