/**
 * Nexus device authentication service.
 *
 * Manages a stable per-install device ID + JWT cache for authenticating with the
 * Nexus backend (server-side tx building, providers, etc.). The device ID is a
 * random UUID generated on first launch and persisted in the extension's private
 * store (privateStore.ts) — it has nothing to do with user wallet keys, so no
 * signing prompt is ever shown. The bearer tokens live there too: content
 * scripts can read chrome.storage.local, where older releases kept both.
 *
 * Auth flow (handled by nexus's existing /api/auth/device endpoints):
 *   1. Wallet generates a UUID once → stores it in the private store
 *   2. POST /api/auth/device { deviceId } → returns { accessToken, refreshToken, expiresIn }
 *   3. Subsequent calls send Authorization: Bearer <accessToken>
 *   4. On 401 / near-expiry, POST /api/auth/device/refresh { refreshToken } → new tokens
 *   5. If refresh fails, fall back to a fresh /api/auth/device login
 */

import axios from 'axios';
import { debugLog } from '@/utils/debug';
import { moveFromChromeLocal, removePrivate, setPrivate } from '@/utils/privateStore';

const DEVICE_ID_KEY = 'geroNexusDeviceId';
const TOKEN_KEY = 'geroNexusTokens';
const EXPIRY_BUFFER_MS = 60_000; // refresh 1 minute before expiry

interface CachedTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms since epoch
}

interface DeviceAuthResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number; // ms
  deviceId: string;
}

/**
 * Lightweight axios instance reserved for the auth endpoints themselves.
 * Keeping it separate from the API client prevents accidental recursion when
 * the API client's auth interceptor calls login() to refresh.
 */
// MUST be the DIRECT Nexus origin (VITE_NEXUS_API_URL), never VITE_NEXUS_URL:
// since the gero-backend proxy migration, VITE_NEXUS_URL points at
// api.gerowallet.io/api/nexus — an explicit-allowlist proxy that does NOT
// forward /api/auth/**. Pointing auth there 404s every login/refresh, and the
// failure mode is nasty: cached tokens keep working until expiry, then every
// authed Midnight call collapses to 403 "Access Denied" while the reauth loop
// keeps 404ing (seen live on preprod, 2026-07-08). Same base as
// midnightConfig's NEXUS_BASE.
// Without a baseURL, axios resolves `/api/auth/device` against the extension's
// own origin, producing an `ERR_FILE_NOT_FOUND` instead of a real network call.
const NEXUS_AUTH_BASE = (typeof import.meta !== 'undefined'
  && import.meta.env
  && import.meta.env['VITE_NEXUS_API_URL']) || 'https://nexus.gerowallet.io';

const authClient = axios.create({
  baseURL: NEXUS_AUTH_BASE,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Get-or-create the persistent device ID for this wallet install.
 * UUIDs are 36 chars, well within nexus's 8-100 char limit.
 */
async function getOrCreateDeviceId(): Promise<string> {
  const existing = await moveFromChromeLocal<string>(DEVICE_ID_KEY);
  if (typeof existing === 'string' && existing) return existing;

  const deviceId = crypto.randomUUID();
  await setPrivate(DEVICE_ID_KEY, deviceId);
  debugLog('[nexusAuth] Generated new device ID:', deviceId);
  return deviceId;
}

async function readCachedTokens(): Promise<CachedTokens | null> {
  return (await moveFromChromeLocal<CachedTokens>(TOKEN_KEY)) ?? null;
}

async function writeCachedTokens(tokens: CachedTokens): Promise<void> {
  await setPrivate(TOKEN_KEY, tokens);
}

async function clearCachedTokens(): Promise<void> {
  await removePrivate(TOKEN_KEY);
}

function tokensFromResponse(res: DeviceAuthResponse): CachedTokens {
  return {
    accessToken: res.accessToken,
    refreshToken: res.refreshToken,
    expiresAt: Date.now() + res.expiresIn,
  };
}

async function login(): Promise<CachedTokens> {
  const deviceId = await getOrCreateDeviceId();
  // @ts-expect-error - APP_VERSION is injected at build time by Vite (see vite config define block)
  const appVersion = typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'unknown';
  const { data } = await authClient.post<DeviceAuthResponse>('/api/auth/device', {
    deviceId,
    platform: 'chrome-extension',
    appVersion,
  });
  const tokens = tokensFromResponse(data);
  await writeCachedTokens(tokens);
  debugLog('[nexusAuth] Device login successful');
  return tokens;
}

async function refresh(refreshToken: string): Promise<CachedTokens> {
  const { data } = await authClient.post<DeviceAuthResponse>('/api/auth/device/refresh', {
    refreshToken,
  });
  const tokens = tokensFromResponse(data);
  await writeCachedTokens(tokens);
  debugLog('[nexusAuth] Token refresh successful');
  return tokens;
}

/**
 * The one token acquisition (refresh or device login) running in this context, if any.
 * Every caller that needs new tokens awaits it, so N requests made at once on first start
 * send one POST /api/auth/device for one device id, instead of N each with its own id.
 * Cleared once it settles, success or failure, so the next caller after a failure tries again.
 */
let pendingTokens: Promise<CachedTokens> | null = null;

/**
 * The background and every extension page each load this module, so the promise above
 * covers one context. Where the Web Locks API exists (extension pages and the MV3 worker),
 * the acquisition also runs under one lock for the whole extension; it re-reads the store
 * first, so a context that waited takes the tokens and device id the other one just wrote.
 */
const DEVICE_AUTH_LOCK = 'gero-nexus-device-auth';

async function acrossContexts(work: () => Promise<CachedTokens>): Promise<CachedTokens> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? locks.request(DEVICE_AUTH_LOCK, work) : work();
}

function singleFlight(acquire: () => Promise<CachedTokens>): Promise<CachedTokens> {
  if (pendingTokens) return pendingTokens;
  const attempt = acrossContexts(acquire);
  pendingTokens = attempt;
  const release = () => { if (pendingTokens === attempt) pendingTokens = null; };
  attempt.then(release, release);
  return attempt;
}

function stillValid(tokens: CachedTokens): boolean {
  return tokens.expiresAt > Date.now() + EXPIRY_BUFFER_MS;
}

/** Tokens that are still good (another caller may have just written them), else refreshed, else a login. */
async function acquireTokens(): Promise<CachedTokens> {
  const cached = await readCachedTokens();
  if (cached && stillValid(cached)) return cached;
  if (cached?.refreshToken) {
    try {
      return await refresh(cached.refreshToken);
    } catch (err) {
      debugLog('[nexusAuth] Refresh failed, falling back to fresh login:', err);
      await clearCachedTokens();
    }
  }
  return login();
}

/**
 * Returns a valid access token for nexus, refreshing or re-logging in as needed.
 * Safe to call from request interceptors: it caches and only contacts the
 * server when the cached token is missing or near expiry, once for all callers.
 */
export async function getNexusAccessToken(): Promise<string> {
  const cached = await readCachedTokens();
  if (cached && stillValid(cached)) return cached.accessToken;
  return (await singleFlight(acquireTokens)).accessToken;
}

/**
 * A login that never answers with `refused`: tokens another caller or context wrote since
 * that request was refused are taken as they are, anything else is a fresh login.
 */
async function freshLogin(refused: string | undefined): Promise<CachedTokens> {
  const current = await readCachedTokens();
  if (current && stillValid(current) && current.accessToken !== refused) return current;
  await clearCachedTokens();
  return login();
}

/**
 * Force a fresh login (used by the API clients' 401/403 handlers).
 *
 * @param refusedToken the access token the refused request sent. Never handed back: a
 *   login or refresh already running is joined, but when it answers with that same token
 *   (it read the cache before the refusal), a fresh login is started or joined instead.
 *   Without it, the token cached now stands in for it.
 *
 * Requests refused together share one login, here and across contexts.
 */
export async function reauthenticateNexus(refusedToken?: string): Promise<string> {
  const refused = refusedToken ?? (await readCachedTokens())?.accessToken;
  // A joined acquisition can answer with the refused token once; the login after it cannot.
  // Three rounds only bound a pathological run of other callers' acquisitions.
  for (let round = 0; round < 3; round++) {
    const tokens = await singleFlight(() => freshLogin(refused));
    if (tokens.accessToken !== refused) return tokens.accessToken;
  }
  throw new Error('Nexus re-authentication kept answering with the refused token');
}
