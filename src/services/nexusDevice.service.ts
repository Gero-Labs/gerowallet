/**
 * Nexus device authentication service.
 *
 * Manages a stable per-install device ID + JWT cache for authenticating with the
 * Nexus backend (server-side tx building, providers, etc.). The device ID is a
 * random UUID generated on first launch and persisted in chrome.storage.local —
 * it has nothing to do with user wallet keys, so no signing prompt is ever shown.
 *
 * Auth flow (handled by nexus's existing /api/auth/device endpoints):
 *   1. Wallet generates a UUID once → stores it in chrome.storage.local
 *   2. POST /api/auth/device { deviceId } → returns { accessToken, refreshToken, expiresIn }
 *   3. Subsequent calls send Authorization: Bearer <accessToken>
 *   4. On 401 / near-expiry, POST /api/auth/device/refresh { refreshToken } → new tokens
 *   5. If refresh fails, fall back to a fresh /api/auth/device login
 */

import axios from 'axios';
import { debugLog } from '@/utils/debug';

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
// Fall back to the public Nexus URL when the env var isn't injected (e.g.
// production builds where `.env.production` doesn't define VITE_NEXUS_URL).
// Without a baseURL, axios resolves `/api/auth/device` against the extension's
// own origin, producing an `ERR_FILE_NOT_FOUND` instead of a real network call.
const NEXUS_AUTH_BASE = (typeof import.meta !== 'undefined'
  && import.meta.env
  && import.meta.env['VITE_NEXUS_URL']) || 'https://nexus.gerowallet.io';

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
  const stored = await chrome.storage.local.get(DEVICE_ID_KEY);
  const existing = stored?.[DEVICE_ID_KEY] as string | undefined;
  if (existing) return existing;

  const deviceId = crypto.randomUUID();
  await chrome.storage.local.set({ [DEVICE_ID_KEY]: deviceId });
  debugLog('[nexusAuth] Generated new device ID:', deviceId);
  return deviceId;
}

async function readCachedTokens(): Promise<CachedTokens | null> {
  const stored = await chrome.storage.local.get(TOKEN_KEY);
  return (stored?.[TOKEN_KEY] as CachedTokens | undefined) ?? null;
}

async function writeCachedTokens(tokens: CachedTokens): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: tokens });
}

async function clearCachedTokens(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_KEY);
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
 * Returns a valid access token for nexus, refreshing or re-logging in as needed.
 * Safe to call from request interceptors — it caches and only contacts the
 * server when the cached token is missing or near expiry.
 */
export async function getNexusAccessToken(): Promise<string> {
  const cached = await readCachedTokens();

  if (cached && cached.expiresAt > Date.now() + EXPIRY_BUFFER_MS) {
    return cached.accessToken;
  }

  if (cached?.refreshToken) {
    try {
      const refreshed = await refresh(cached.refreshToken);
      return refreshed.accessToken;
    } catch (err) {
      debugLog('[nexusAuth] Refresh failed, falling back to fresh login:', err);
      await clearCachedTokens();
    }
  }

  const fresh = await login();
  return fresh.accessToken;
}

/**
 * Force a fresh login (used by the API client's 401 handler).
 */
export async function reauthenticateNexus(): Promise<string> {
  await clearCachedTokens();
  const fresh = await login();
  return fresh.accessToken;
}
