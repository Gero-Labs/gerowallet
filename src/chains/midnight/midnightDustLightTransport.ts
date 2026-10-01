import type { MidnightNetworkEndpoints } from './midnightConfig';
import type { CollapsedDustTree, DustLightTransport, DustSnapshot, DustSpendTransaction } from './midnightDustLightSync';
import { getNexusAccessToken, reauthenticateNexus } from '@/services/nexusDevice.service';
import { withMidnightAbort } from './midnightAbort';

const MAX_RATE_LIMIT_RETRIES = 5;
const MAX_RETRY_DELAY_MS = 30_000;

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

export function createDustLightTransport(endpoints: MidnightNetworkEndpoints, signal: AbortSignal): DustLightTransport {
  const url = `${endpoints.nexusBaseUrl}/api/midnight/midnight-${endpoints.sdkNetworkId}/dust/light-sync`;
  async function request<T>(body: { operation: string } & Record<string, unknown>): Promise<T> {
    const attempt = async (token: string) => fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body), signal,
    });
    let token = await withMidnightAbort(getNexusAccessToken(), signal);
    let refreshed = false;
    let rateLimitRetries = 0;
    for (;;) {
      signal.throwIfAborted();
      const response = await attempt(token);
      if ((response.status === 401 || response.status === 403) && !refreshed) {
        await response.body?.cancel();
        token = await withMidnightAbort(reauthenticateNexus(), signal);
        refreshed = true;
        continue;
      }
      if (response.ok) return response.json();
      const delay = response.status === 429 && rateLimitRetries < MAX_RATE_LIMIT_RETRIES
        ? retryDelay(response.headers.get('Retry-After'), rateLimitRetries) : null;
      await response.body?.cancel();
      // Deliberately omit payloads, addresses, prefixes, tokens and response bodies.
      console.warn('Midnight DUST projection request rejected', {
        operation: body.operation, status: response.status, retryInMs: delay,
      });
      if (delay !== null) {
        rateLimitRetries++;
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
      const result = await request<{ blockHash: string; transactions: DustSpendTransaction[]; nextBlock: number | null }>({ operation: 'spends', blockHash: block.hash, prefixes, fromBlock, toBlock });
      if (result.blockHash !== block.hash || !Array.isArray(result.transactions)) throw new Error('DUST spend snapshot mismatch');
      return { transactions: result.transactions, nextBlock: result.nextBlock };
    },
    commitments: async (block, ranges) => {
      const result = await request<{ blockHash: string; updates: CollapsedDustTree[] }>({ operation: 'commitments', blockHash: block.hash, ranges });
      if (result.blockHash !== block.hash || !Array.isArray(result.updates)) throw new Error('DUST tree snapshot mismatch');
      return result.updates;
    },
  };
}
