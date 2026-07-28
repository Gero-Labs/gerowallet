/**
 * Wallet-side Midnight proof-server integration.
 *
 * Hand-rolled `ledger.ProvingProvider` for any HTTP proof server exposing
 * the NATIVE proof-server API — the self-hosted docker server
 * (`docker run -p 6300:6300 midnightntwrk/proof-server:<tag>
 * midnight-proof-server -v`, default `http://localhost:6300`) and the
 * hosted Arkhia zkPaaS gateway (which relays the same API behind
 * `x-api-key`/`x-api-secret` auth, see midnightZkpaas.ts) — plus a
 * `/health` poller. Deliberately NOT a wrapper around
 * `@midnightntwrk/wallet-sdk-prover-client` — that package's whole HTTP
 * client reduces to two plain fetches (see
 * `node_modules/@midnightntwrk/wallet-sdk-prover-client/dist/effect/HttpProverClient.js`)
 * behind an Effect + web-worker dependency graph this wallet doesn't
 * otherwise need. See docs/plans/2026-07-13-midnight-proof-server-setting.md
 * section 0 and ground rule 12.
 *
 * Runs in whichever context calls it — the BG service worker
 * (`midnightShieldedBuilder.ts`, local/zkPaaS shielded sends; reachable via
 * the wildcard host_permissions manifest grant, see scripts/manifest.ts)
 * and extension pages (the Settings proof-server status chip, WP-P4;
 * reachable via the prod CSP `connect-src` localhost + arkhia entries).
 * Both contexts have `fetch` / `AbortSignal.timeout` natively, so no
 * context-specific branching is needed here.
 *
 * PRIVACY (ground rule 13): never log request/response BODIES — the
 * preimage and proof bytes carry the tx's witness data whether the server
 * is the user's own machine or a remote TEE. Durations, byte lengths, and
 * the target path/host are fine. Never log auth header VALUES either.
 */

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { debugLog } from '@/utils/debug';

/** Transient proof-server states worth retrying (matches the SDK client). */
const RETRYABLE_STATUS = new Set([502, 503, 504]);
/** Backoff before attempt 2 and attempt 3 respectively (3 attempts total). */
const RETRY_BACKOFF_MS = [2_000, 4_000];
/** Short timeout so the settings-page status poll (WP-P4) stays responsive. */
const HEALTH_CHECK_TIMEOUT_MS = 2_500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Optional per-request extras: `headers` carries gateway auth
 * (`x-api-key`/`x-api-secret` for Arkhia zkPaaS); absent for the plain
 * localhost docker server.
 */
export interface ProverRequestOptions {
  headers?: Record<string, string>;
}

/**
 * Join `path` onto `baseUrl` PRESERVING the base's own path segments.
 * `new URL('/prove', base)` would discard them — harmless for the docker
 * server's root base (`http://localhost:6300`) but wrong for Arkhia's
 * path-carrying bases (`https://starter.arkhia.io/midnight/zkpaas/mainnet`
 * or a user-pasted keyed URL ending in the API key segment).
 */
function joinProverUrl(baseUrl: string, path: string): URL {
  return new URL(`${baseUrl.replace(/\/+$/, '')}${path}`);
}

/** A failed attempt worth retrying: network-level failure, or 502/503/504. */
class RetryableProverError extends Error {}

/**
 * One HTTP attempt against the proof server. Throws
 * {@link RetryableProverError} for failures worth retrying, a plain
 * {@link Error} for anything else (e.g. 400/401/404/500 — retrying those
 * would just fail the same way again).
 */
async function attemptPost(
  url: URL,
  path: string,
  body: Uint8Array,
  options?: ProverRequestOptions,
): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { ...options?.headers, 'Content-Type': 'application/octet-stream' },
      body,
    });
  } catch (networkErr) {
    throw new RetryableProverError(
      networkErr instanceof Error ? networkErr.message : `network error contacting ${path}`,
    );
  }
  if (res.status === 200) {
    return new Uint8Array(await res.arrayBuffer());
  }
  // Error TEXT is diagnostic (HTTP status explanation from the proof
  // server), never the request payload — safe to log per the file header.
  const text = await res.text().catch(() => '');
  const message = `proof server ${path}: HTTP ${res.status}${text ? ` - ${text.slice(0, 200)}` : ''}`;
  if (RETRYABLE_STATUS.has(res.status)) throw new RetryableProverError(message);
  throw new Error(message);
}

/**
 * POST `body` to `{baseUrl}{path}` with the proof server's expected
 * `application/octet-stream` framing. Retries up to 3 total attempts on a
 * network-level failure or HTTP 502/503/504, waiting 2s then 4s between
 * attempts — mirrors the official SDK HTTP prover client's retry policy
 * without pulling in its Effect dependency (see plan section 0 /
 * `HttpProverClient.js:56-62`). Any other non-200 status fails immediately.
 */
async function postToProver(
  baseUrl: string,
  path: string,
  body: Uint8Array,
  options?: ProverRequestOptions,
): Promise<Uint8Array> {
  const url = joinProverUrl(baseUrl, path);
  const totalAttempts = RETRY_BACKOFF_MS.length + 1;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    if (attempt > 1) await delay(RETRY_BACKOFF_MS[attempt - 2]);
    const startedAt = Date.now();
    try {
      const bytes = await attemptPost(url, path, body, options);
      debugLog(`🌙 proof server ${path}: 200 OK (${Date.now() - startedAt}ms, ${bytes.length}B)`);
      return bytes;
    } catch (err) {
      if (!(err instanceof RetryableProverError) || attempt === totalAttempts) {
        throw err instanceof Error ? err : new Error(String(err));
      }
      debugLog(`🌙 proof server ${path}: attempt ${attempt}/${totalAttempts} failed, retrying`, err.message);
    }
  }
  // Unreachable — the loop above always returns or throws.
  throw new Error(`proof server ${path}: exhausted retries`);
}

/**
 * Build a `ledger.ProvingProvider` that talks to a native-API Midnight
 * proof server at `baseUrl` — self-hosted docker
 * (`http://localhost:6300`) or the Arkhia zkPaaS gateway (pass its auth
 * via `options.headers`) — instead of Gero Cloud. Pass straight to
 * `UnprovenTransaction.prove(provider, costModel)` — see
 * `midnightShieldedBuilder.ts`.
 */
export function makeLocalProvingProvider(
  baseUrl: string,
  options?: ProverRequestOptions,
): ledger.ProvingProvider {
  return {
    check: async (serializedPreimage, _keyLocation) => {
      const payload = ledger.createCheckPayload(serializedPreimage);
      const result = await postToProver(baseUrl, '/check', payload, options);
      return ledger.parseCheckResult(result);
    },
    prove: async (serializedPreimage, _keyLocation, overwriteBindingInput) => {
      const payload = ledger.createProvingPayload(serializedPreimage, overwriteBindingInput);
      return postToProver(baseUrl, '/prove', payload, options);
    },
  };
}

/**
 * `GET {baseUrl}/health` — resolves `true` on HTTP 200 within a short
 * timeout, `false` on any error, non-200 status, or timeout. Never throws.
 * Used both for the shielded-send preflight (this WP) and the Settings
 * proof-server status chip poll (WP-P4).
 *
 * `options.acceptNotFound` (Arkhia zkPaaS): the gateway relays the native
 * `/prove`/`/check` endpoints but is not documented to relay `GET /health`
 * — a 404 there means "gateway reachable, auth accepted, no health route",
 * which is a healthy-enough signal to let a send proceed. Auth failures
 * (401/403) and everything else still report unhealthy so a bad API key
 * blocks BEFORE a long build, not after.
 */
export async function checkProofServerHealth(
  baseUrl: string,
  options?: ProverRequestOptions & { acceptNotFound?: boolean },
): Promise<boolean> {
  try {
    const res = await fetch(joinProverUrl(baseUrl, '/health'), {
      headers: options?.headers,
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });
    if (res.status === 200) return true;
    return !!options?.acceptNotFound && res.status === 404;
  } catch {
    return false;
  }
}
