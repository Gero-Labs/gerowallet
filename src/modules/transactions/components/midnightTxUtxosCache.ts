/**
 * Session cache for a Midnight transaction's UTxOs, shared across every
 * MidnightTxUtxos instance.
 *
 * This lives in its own module because it has to. The previous version
 * declared the Map inside `<script setup>` and documented it as module-scope —
 * it is not. `<script setup>` IS the setup function body, so it re-runs on
 * every mount and each instance got a fresh, empty Map. The cache never hit,
 * and a component that mounts repeatedly restarted the request every time.
 *
 * Two maps, not one:
 *
 * - `results` holds settled responses, so a re-expand is free.
 * - `inflight` holds the in-flight promise, so N concurrent mounts for the
 *   same key share ONE request instead of racing N of them. Without this, a
 *   remounting component can start a request, be destroyed before it settles,
 *   and repeat forever — every instance loading, none ever finishing.
 *
 * A failed request is removed from `inflight` so the next attempt genuinely
 * retries rather than re-awaiting a rejected promise.
 */
import type { MidnightTransactionUtxosDto } from '@/api/midnight-api';

const results = new Map<string, MidnightTransactionUtxosDto>();
const inflight = new Map<string, Promise<MidnightTransactionUtxosDto>>();

/** A settled result for this key, if one has already been fetched. */
export function getCachedTxUtxos(key: string): MidnightTransactionUtxosDto | undefined {
  return results.get(key);
}

/**
 * Fetch once per key, sharing both the settled result and the in-flight
 * promise. `force` bypasses the settled cache (used by the retry button) but
 * still joins an in-flight request rather than stacking a second one.
 */
export async function fetchTxUtxos(
  key: string,
  fetcher: () => Promise<MidnightTransactionUtxosDto>,
  force = false,
): Promise<MidnightTransactionUtxosDto> {
  if (!force) {
    const settled = results.get(key);
    if (settled) return settled;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = fetcher()
    .then((res) => {
      results.set(key, res);
      return res;
    })
    .finally(() => {
      // Always clear, success or failure: a rejected promise left here would
      // make every later attempt re-await the same failure.
      inflight.delete(key);
    });

  inflight.set(key, p);
  return p;
}
