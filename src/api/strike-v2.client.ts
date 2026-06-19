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
 * Extract the path (and query string) from an Axios request config URL.
 * Handles both absolute URLs and relative paths.
 * Returns the pathname + search portion only, e.g. "/v2/order?foo=bar".
 */
function extractPath(configUrl: string | undefined, baseURL: string | undefined): string {
  if (!configUrl) return '/';

  // If it's already a relative path (starts with '/'), use it directly
  if (configUrl.startsWith('/')) return configUrl;

  try {
    // Absolute URL — strip the origin to get path + query
    const url = new URL(configUrl);
    return url.pathname + url.search;
  } catch {
    // Fallback: treat as relative path
    return '/' + configUrl;
  }
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
});

strikeClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> => {
    if (!hasStrikeApiKeys()) {
      // No keys — allow public endpoints that don't require auth
      return config;
    }

    const method = (config.method ?? 'GET').toUpperCase();
    const path = extractPath(config.url, config.baseURL);

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

    // Merge auth headers into the request
    config.headers = config.headers ?? {};
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
