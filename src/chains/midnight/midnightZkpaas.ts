/**
 * Arkhia zkPaaS (Midnight ZK Prover-as-a-Service) helpers.
 *
 * zkPaaS is the Midnight ecosystem's HOSTED proof server — run by BCW
 * behind the Arkhia API gateway inside Google Confidential Compute (TEE).
 * Its gateway relays the native proof-server API (`/prove`, `/check`), so
 * the wallet reuses the same hand-rolled ProvingProvider it uses for the
 * self-hosted docker server (`midnightLocalProver.ts`), plus `x-api-key` /
 * `x-api-secret` auth headers from the user's Arkhia project.
 * Source: `.claude/ZkPaaS Guide.pdf` (BCW, confidential).
 *
 * Privacy posture (mirrors the consent copy): like ANY remote prover,
 * zkPaaS receives the unproven tx with witness data — that is what proving
 * is. Selecting it therefore requires the same shielded-proving consent as
 * Gero Cloud; only `mode: 'local'` skips consent.
 *
 * Deliberately free of heavy imports (no ledger WASM) so browser-context
 * consumers (settings composable, tx service) can import it statically
 * without dragging ledger-v8 into their chunks.
 */

import { getMidnightEndpoints } from '@/chains/midnight/midnightConfig';

/** Where users create a project + API key. Linked from the setup guide. */
export const ARKHIA_DASHBOARD_URL = 'https://auth.arkhia.io';

/**
 * The slice of `midnightStore.proofServer` zkPaaS resolution needs. Kept
 * structural so callers can pass the store field (or a draft) directly.
 */
export interface ZkpaasSettings {
  /** Endpoint override; empty string = derive per network from config. */
  zkpaasUrl: string;
  zkpaasApiKey: string;
  zkpaasApiSecret: string;
}

/**
 * Effective zkPaaS base URL for `network`: the user's override when set,
 * else the per-network Arkhia default from `midnightConfig`. Returns '' for
 * unrecognized networks with no override (callers treat that as
 * not-configured rather than throwing — the send preflight surfaces it).
 */
export function resolveZkpaasUrl(network: string | undefined, settings: ZkpaasSettings): string {
  const override = settings.zkpaasUrl.trim();
  if (override) return override;
  if (!network) return '';
  return getMidnightEndpoints(network)?.zkpaasProofServerUrl ?? '';
}

/**
 * Auth headers for the Arkhia gateway. Key/secret are optional at this
 * layer (a user-pasted override URL may embed the key as a path segment,
 * which the gateway also accepts) — {@link isZkpaasConfigured} decides
 * whether the combination is usable at all.
 */
export function buildZkpaasHeaders(settings: ZkpaasSettings): Record<string, string> {
  const headers: Record<string, string> = {};
  const key = settings.zkpaasApiKey.trim();
  const secret = settings.zkpaasApiSecret.trim();
  if (key) headers['x-api-key'] = key;
  if (secret) headers['x-api-secret'] = secret;
  return headers;
}

/**
 * Usable zkPaaS config = an API key, OR an override URL (which may embed
 * the key in its path). An override alone is deliberately accepted so a
 * keyed URL pasted straight from the Arkhia dashboard works without
 * re-entering the key separately.
 */
export function isZkpaasConfigured(settings: ZkpaasSettings): boolean {
  return settings.zkpaasApiKey.trim().length > 0 || settings.zkpaasUrl.trim().length > 0;
}
