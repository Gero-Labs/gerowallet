import TokenMetadataStore from '@/stores/tokenMetadataStore';

/** How long a page trusts its swap token list before re-fetching it when the swap opens. */
export const SWAP_TOKEN_LIST_MAX_AGE_MS = 10 * 60 * 1000;

let lastRefreshAt = 0;
let inFlight: Promise<void> | null = null;

/**
 * Re-fetches the swap-tradable token list when the swap opens, at most once per
 * {@link SWAP_TOKEN_LIST_MAX_AGE_MS} per page.
 *
 * The list is otherwise loaded at login and kept, so a token listed later never reached
 * the picker until the user locked and unlocked (USDrf, 2026-10-05). GeroSwapEmbed's
 * catalog watch rebuilds the picker when the new list lands. Concurrent opens share one
 * request, and a failed refresh is retried on the next open.
 *
 * Never throws: on any failure the page keeps the list it already has.
 */
export function refreshSwapTokensIfStale(): Promise<void> {
  if (inFlight) return inFlight;
  if (lastRefreshAt && Date.now() - lastRefreshAt < SWAP_TOKEN_LIST_MAX_AGE_MS) {
    return Promise.resolve();
  }
  inFlight = (async () => {
    try {
      if (await TokenMetadataStore.loadTokens()) lastRefreshAt = Date.now();
    } catch {
      // Keep the list the page already has; the next open tries again.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Test seam: forget the last refresh. */
export function resetSwapTokenRefresh(): void {
  lastRefreshAt = 0;
  inFlight = null;
}
