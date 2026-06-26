// Strike Finance v2 API — Authenticated Axios Client
// strikeClient       — authenticated, for trade + user API endpoints
// strikeMarketClient — unauthenticated, for public market data endpoints

import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { buildStrikeAuthHeaders } from './strike-v2.auth';

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------

// @ts-ignore — Vite env
const STRIKE_API_BASE: string = import.meta.env.VITE_STRIKE_API_URL || 'https://api.strikefinance.org';

// ---------------------------------------------------------------------------
// Key management — module-level singleton state
// ---------------------------------------------------------------------------

let _privateKeyHex: string | null = null;
let _publicKeyHex: string | null = null;

/** Store Ed25519 keys for use by the auth interceptor. */
export function setStrikeApiKeys(privateKeyHex: string, publicKeyHex: string): void {
  _privateKeyHex = privateKeyHex;
  _publicKeyHex = publicKeyHex;
}

/** Remove stored keys (e.g. on wallet lock / logout). */
export function clearStrikeApiKeys(): void {
  _privateKeyHex = null;
  _publicKeyHex = null;
}

/** Returns true when both keys are present and non-empty. */
export function hasStrikeApiKeys(): boolean {
  return !!(
    _privateKeyHex && _privateKeyHex.length > 0 &&
    _publicKeyHex && _publicKeyHex.length > 0
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the path (without query) from an Axios request config URL.
 * Handles both absolute URLs and relative paths.
 * Returns the pathname portion only, e.g. "/v2/order".
 *
 * NOTE: the query string is intentionally NOT taken from here. Axios serialises
 * `config.params` into the URL *after* the request interceptor runs, so at
 * interceptor time `config.url` carries no query for params-based requests.
 * The query is reconstructed via {@link serializeStrikeParams} and appended to
 * the signed path, and the same serializer is installed as the client's
 * `paramsSerializer` so the wire URL matches what we signed.
 */
function extractPath(configUrl: string | undefined): string {
  if (!configUrl) return '/';

  // If it's already a relative path (starts with '/'), strip any query/hash.
  if (configUrl.startsWith('/')) return configUrl.split('?')[0].split('#')[0];

  try {
    // Absolute URL — strip the origin to get the pathname only.
    const url = new URL(configUrl);
    return url.pathname;
  } catch {
    // Fallback: treat as relative path
    return '/' + configUrl.split('?')[0].split('#')[0];
  }
}

/**
 * Deterministic params serializer used both for the signed path and as axios's
 * `paramsSerializer`, guaranteeing the signature covers the exact query string
 * that is sent on the wire.
 *
 * - `undefined` / `null` values are dropped (axios's default also omits these).
 * - Keys are emitted in declaration order (matches axios's default for plain
 *   objects), values URL-encoded.
 * Returns the query string WITHOUT a leading '?'.
 */
function serializeStrikeParams(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const parts: string[] = [];
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v === undefined || v === null) continue;
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join('&');
}

// ---------------------------------------------------------------------------
// Authenticated client — trade + user API
// ---------------------------------------------------------------------------

export const strikeClient: AxiosInstance = axios.create({
  baseURL: STRIKE_API_BASE,
  timeout: 30_000,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
  // Use our deterministic serializer so the query string on the wire matches
  // exactly what the auth interceptor signs (see serializeStrikeParams).
  paramsSerializer: (params: Record<string, unknown>) => serializeStrikeParams(params),
});

strikeClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> => {
    if (!hasStrikeApiKeys()) {
      // No keys — allow public endpoints that don't require auth. NOTE: an
      // authenticated endpoint hit here WILL 401 — it means the user hasn't
      // connected/unlocked Strike (keys are stored encrypted and only loaded
      // into the client after a successful connect or unlock).
      return config;
    }

    const method = (config.method ?? 'GET').toUpperCase();

    // Build the full signed path = pathname + serialized query. Axios only
    // serialises config.params into the URL AFTER this interceptor runs, so we
    // reconstruct the query here with the same serializer installed as the
    // client's paramsSerializer — guaranteeing signature/URL parity. A query
    // already embedded in config.url (rare) is preserved as-is.
    const pathname = extractPath(config.url);
    const embeddedQuery =
      typeof config.url === 'string' && config.url.includes('?')
        ? config.url.slice(config.url.indexOf('?') + 1)
        : '';
    const paramsQuery = serializeStrikeParams(
      config.params as Record<string, unknown> | undefined,
    );
    const query = [embeddedQuery, paramsQuery].filter(Boolean).join('&');
    const path = query ? `${pathname}?${query}` : pathname;

    // Serialise body to string for body-hash calculation
    const bodyString: string =
      config.data == null
        ? ''
        : typeof config.data === 'string'
          ? config.data
          : JSON.stringify(config.data);

    const authHeaders = await buildStrikeAuthHeaders(
      method,
      path,
      bodyString,
      _privateKeyHex!,
      _publicKeyHex!,
    );

    // Merge auth headers into the request.
    // (config.headers is always defined inside a request interceptor — an
    // AxiosHeaders instance — so we assign onto it directly.)
    Object.assign(config.headers, authHeaders);

    return config;
  },
);

// Auth-failure subscribers — useStrikeOnboarding registers itself here so a
// 401 from the server can flip the composable's isConnected flag without
// creating a circular import.
type AuthFailureHandler = () => void;
const authFailureHandlers = new Set<AuthFailureHandler>();

export function onStrikeAuthFailure(handler: AuthFailureHandler): () => void {
  authFailureHandlers.add(handler);
  return () => authFailureHandlers.delete(handler);
}

strikeClient.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    if (status === 401 || status === 403) {
      clearStrikeApiKeys();
      authFailureHandlers.forEach((h) => {
        try { h(); } catch { /* never let a handler swallow the original error */ }
      });
    }
    return Promise.reject(err);
  },
);

// ---------------------------------------------------------------------------
// Unauthenticated market-data client
// ---------------------------------------------------------------------------

export const strikeMarketClient: AxiosInstance = axios.create({
  baseURL: `${STRIKE_API_BASE}/price`,
  timeout: 15_000,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
});
