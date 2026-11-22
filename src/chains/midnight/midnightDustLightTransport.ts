import type { MidnightNetworkEndpoints } from './midnightConfig';
import type { CollapsedDustTree, DustLightTransport, DustSnapshot, DustSpendTransaction } from './midnightDustLightSync';
import { getNexusAccessToken, reauthenticateNexus } from '@/services/nexusDevice.service';
import { withMidnightAbort } from './midnightAbort';
import { geroClientHeaders } from './midnightClientVersion';

const MAX_RATE_LIMIT_RETRIES = 5;
const MAX_RETRY_DELAY_MS = 30_000;
/**
 * Answers that say "not now" about a page the server can serve a moment later:
 * Nexus or its indexer restarting (503, seconds), the connection between
 * Cloudflare and Nexus dropped mid-request (502, 504). Seen on preprod on
 * 2026-11-22, where one of them ended a 15 minute synchronization.
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
        if (response.status === 429) rateLimitRetries++;
        else transientRetries++;
        await waitForRetry(delay, signal);
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
