import type { MidnightNetworkEndpoints } from './midnightConfig';
import type { CollapsedDustTree, DustLightTransport, DustSnapshot, DustSpendTransaction } from './midnightDustLightSync';
import { getNexusAccessToken, reauthenticateNexus } from '@/services/nexusDevice.service';
import { withMidnightAbort } from './midnightAbort';
import { geroClientHeaders } from './midnightClientVersion';

const MAX_RATE_LIMIT_RETRIES = 5;
const MAX_RETRY_DELAY_MS = 30_000;
/**
 * Answers that say "not now" about a page the server can serve a moment later:
 * a service behind Nexus restarting (503), a connection on the way to Nexus
 * dropped mid-request (502, 504). Seen on preprod on 2026-11-22, where one of
 * them ended a 15 minute synchronization.
 */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);
/** Per request, after the first try: 2 s, 4 s, 8 s (or the server's Retry-After). */
const MAX_TRANSIENT_RETRIES = 3;

/** A long Retry-After must never be shortened into an early retry. */
function retryDelay(header: string | null, retry: number): number | null {
  const value = header?.trim();
  if (value && /^\d+$/.test(value) && !Number.isFinite(Number(value) * 1000)) return null;
  const requested = value && /^\d+$/.test(value) ? Number(value) * 1000
    : value ? Date.parse(value) - Date.now() : Number.NaN;
  const delay = Number.isFinite(requested) ? Math.max(1000, requested)
    : Math.min(1000 * 2 ** retry, 10_000);
  return delay <= MAX_RETRY_DELAY_MS ? delay : null;
}

/**
 * Pace of light-sync requests: at most this many a second, evenly spaced (one start every
 * 200 ms), for every transport in this context that talks to the same light-sync URL. The URL
 * names the network, so a wallet's syncs and fee builds share one pace. The spend scan runs
 * `DUST_SPEND_CONCURRENCY` requests side by side and a cached page answers in milliseconds,
 * so without this a sync sent its pages in bursts. Every attempt takes a slot: retries,
 * re-authentication and the first try alike.
 */
export const DUST_LIGHT_SYNC_REQUESTS_PER_SECOND = 5;
const PACE_GAP_MS = 1000 / DUST_LIGHT_SYNC_REQUESTS_PER_SECOND;
/**
 * A next slot further ahead than any Retry-After hold plus a queue can put it means the
 * clock was set back: start again from now rather than stall the sync.
 */
const PACE_MAX_AHEAD_MS = MAX_RETRY_DELAY_MS + 30_000;
/** Per light-sync URL: when the next request may start, and a 429's hold (ms since epoch). */
const paces = new Map<string, { next: number; holdUntil: number }>();

/**
 * Wait for this URL's next request slot. Slots are handed out in call order, and a hold
 * placed while a request waits (another request's 429) moves that request past it too.
 */
async function waitForSlot(url: string, signal: AbortSignal): Promise<void> {
  const pace = paces.get(url) ?? { next: 0, holdUntil: 0 };
  paces.set(url, pace);
  for (;;) {
    signal.throwIfAborted();
    const now = Date.now();
    if (pace.holdUntil - now > PACE_MAX_AHEAD_MS) pace.holdUntil = 0;
    if (pace.holdUntil > now) {
      await waitForRetry(pace.holdUntil - now, signal);
      continue;
    }
    const slot = pace.next - now > PACE_MAX_AHEAD_MS ? now : Math.max(now, pace.next);
    pace.next = slot + PACE_GAP_MS;
    if (slot === now) return;
    await waitForRetry(slot - now, signal);
    if (pace.holdUntil <= Date.now()) return;
  }
}

/** A 429's Retry-After holds every request to this URL, not just the one that got it. */
function holdSlots(url: string, milliseconds: number): void {
  const pace = paces.get(url) ?? { next: 0, holdUntil: 0 };
  pace.holdUntil = Math.max(pace.holdUntil, Date.now() + milliseconds);
  paces.set(url, pace);
}

export function resetDustLightSyncPaceForTest(): void {
  paces.clear();
}

function waitForRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/**
 * @param onActivity called each time Nexus answers (any status) and each time a reply body has
 *   been read, so the caller can tell a slow sync from a stalled one.
 */
export function createDustLightTransport(
  endpoints: MidnightNetworkEndpoints, signal: AbortSignal, onActivity: () => void = () => {},
): DustLightTransport {
  const url = `${endpoints.nexusBaseUrl}/api/midnight/midnight-${endpoints.sdkNetworkId}/dust/light-sync`;
  /**
   * @param retryTransient retry 502/503/504 and a dropped connection. Only for a page pinned to
   *   the snapshot block (`spends`, `commitments`): the same request has the same answer, and
   *   failing it throws away every page before it. A `snapshot` that fails has cost nothing yet.
   */
  async function request<T>(body: { operation: string } & Record<string, unknown>, retryTransient = false): Promise<T> {
    const attempt = async (token: string) => fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...geroClientHeaders() },
      body: JSON.stringify(body), signal,
    });
    let token = await withMidnightAbort(getNexusAccessToken(), signal);
    let refreshed = false;
    let rateLimitRetries = 0;
    let transientRetries = 0;
    // No usable answer (connection reset or cut mid-body, DNS, offline): wait, or rethrow when out of retries.
    const waitAfterFailure = async (error: unknown) => {
      if (signal.aborted || !retryTransient || transientRetries >= MAX_TRANSIENT_RETRIES) throw error;
      const delay = Math.min(2000 * 2 ** transientRetries++, 10_000);
      console.warn('Midnight DUST projection request failed', { operation: body.operation, retryInMs: delay });
      await waitForRetry(delay, signal);
    };
    for (;;) {
      signal.throwIfAborted();
      await waitForSlot(url, signal);
      let response: Response;
      // Not reported as activity: no answer is silence, and the caller's watchdog bounds it.
      try { response = await attempt(token); } catch (error) { await waitAfterFailure(error); continue; }
      onActivity();
      if ((response.status === 401 || response.status === 403) && !refreshed) {
        await response.body?.cancel();
        token = await withMidnightAbort(reauthenticateNexus(), signal);
        refreshed = true;
        continue;
      }
      if (response.ok) {
        let result: T;
        try { result = await response.json(); } catch (error) { await waitAfterFailure(error); continue; }
        onActivity();
        return result;
      }
      const transient = retryTransient && TRANSIENT_STATUSES.has(response.status) && transientRetries < MAX_TRANSIENT_RETRIES;
      const delay = response.status === 429 && rateLimitRetries < MAX_RATE_LIMIT_RETRIES
        ? retryDelay(response.headers.get('Retry-After'), rateLimitRetries)
        : transient ? retryDelay(response.headers.get('Retry-After'), transientRetries + 1) : null;
      await response.body?.cancel();
      // Deliberately omit payloads, addresses, prefixes, tokens and response bodies.
      console.warn('Midnight DUST projection request rejected', {
        operation: body.operation, status: response.status, retryInMs: delay,
      });
      if (delay !== null) {
        if (response.status === 429) {
          // The retry, and every other request to this URL, waits in `waitForSlot` until then.
          rateLimitRetries++;
          holdSlots(url, delay);
        } else {
          transientRetries++;
          await waitForRetry(delay, signal);
        }
        continue;
      }
      if (response.status === 429) throw new Error('DUST synchronization is busy. Please try again shortly.');
      throw new Error('DUST synchronization is temporarily unavailable. Please try again shortly.');
    }
  }
  return {
    snapshot: address => request<DustSnapshot>({ operation: 'snapshot', dustAddress: address }),
    spends: async (block, prefixes, fromBlock, toBlock) => {
      const result = await request<{ blockHash: string; transactions: DustSpendTransaction[]; nextBlock: number | null }>({ operation: 'spends', blockHash: block.hash, prefixes, fromBlock, toBlock }, true);
      if (result.blockHash !== block.hash || !Array.isArray(result.transactions)) throw new Error('DUST spend snapshot mismatch');
      return { transactions: result.transactions, nextBlock: result.nextBlock };
    },
    commitments: async (block, ranges) => {
      const result = await request<{ blockHash: string; updates: CollapsedDustTree[] }>({ operation: 'commitments', blockHash: block.hash, ranges }, true);
      if (result.blockHash !== block.hash || !Array.isArray(result.updates)) throw new Error('DUST tree snapshot mismatch');
      return result.updates;
    },
  };
}
