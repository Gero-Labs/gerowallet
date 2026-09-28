// Push notifications — the signed REST client (background service worker).
//
// Handover B1 `notifyClient.ts`, CONTRACT.md §2, §3.6, §4. One `request()` does what
// every call needs: serialise the body ONCE and hash/sign/send those bytes, sign with
// the corrected clock (§3.6), and map the §2.5 error codes:
//   auth_clock_skew          store clockOffset, retry once
//   device_unknown           PUT /device (through the caller's hook), retry once; on DELETE it is success
//   auth_replay              re-sign with a fresh nonce, retry once
//   429 / 5xx / network      exponential backoff with full jitter (base 5 s, ×2, cap 1 h), never
//                            sooner than Retry-After, every retry freshly signed, three retries at most.
//                            A wait the worker cannot sit through (a P29 nonce fence: Retry-After up
//                            to 600 s) is handed to chrome.alarms through `scheduleRetry` and the call
//                            throws NotifyDeferred; the alarm re-runs the idempotent re-assertion.
//   426                      protocolUnsupported: stop calling until the extension is updated.
// Everything else is thrown as NotifyError for the caller (notifyRegistration) to decide.
//
// The fetch runs from the worker: host_permissions cover the host, so no CORS applies.

import { encodeBody, signHeaders, type NotifyMethod, type SigningIdentity } from './notifyAuth';
import type { NotifyStore } from './notifyStore';
import type {
  DeviceBody, DeviceView, NotifyConfig, NotifyErrorBody, WalletLinkBody, WalletLinkView, WalletPrefs, WalletPrefsWrite,
} from './notifyTypes';
import { NOTIFY_PROTOCOL } from './notifyTypes';

export const DEFAULT_NOTIFY_API_URL = 'https://sync.gerowallet.io/api/notify/v1';
export const CONFIG_CACHE_MS = 3_600_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 3_600_000;
const MAX_RETRIES = 3;
const EMPTY = new Uint8Array(0);

export class NotifyError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
    public readonly retryAfterMs?: number,
  ) {
    super(`notify ${status} ${code}`);
    this.name = 'NotifyError';
  }
}

/** The request was not sent again now: a retry is scheduled for `dueAt` (chrome.alarms). */
export class NotifyDeferred extends Error {
  constructor(public readonly code: string, public readonly dueAt: number) {
    super(`notify retry deferred until ${new Date(dueAt).toISOString()} (${code})`);
    this.name = 'NotifyDeferred';
  }
}

export interface NotifyClientDeps {
  baseUrl?: string;
  fetch: typeof fetch;
  identity: () => Promise<SigningIdentity>;
  store: NotifyStore;
  /** Schedule an idempotent re-assertion at `dueAt` (an alarm). */
  scheduleRetry: (dueAt: number, reason: string) => void | Promise<void>;
  /** On device_unknown: the current PUT /device body, so the client can register and retry once. */
  deviceBody?: () => Promise<DeviceBody | null>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Longest wait the worker sits through in-process; longer ones go to the alarm. */
  inlineWaitMaxMs?: number;
  log?: (message: string) => void;
}

export interface NotifyClient {
  getConfig(opts?: { force?: boolean }): Promise<NotifyConfig>;
  getDevice(): Promise<DeviceView>;
  putDevice(body: DeviceBody): Promise<DeviceView>;
  deleteDevice(): Promise<void>;
  putWallet(walletTag: string, body: WalletLinkBody): Promise<WalletLinkView>;
  deleteWallet(walletTag: string): Promise<void>;
  getPrefs(walletTag: string): Promise<WalletPrefs>;
  putPrefs(walletTag: string, body: WalletPrefsWrite): Promise<WalletPrefs>;
  /** Current clock correction (serverTime − localNow), for tests and diagnostics. */
  clockOffsetMs(): Promise<number>;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

export function createNotifyClient(deps: NotifyClientDeps): NotifyClient {
  const baseUrl = (deps.baseUrl || DEFAULT_NOTIFY_API_URL).replace(/\/+$/, '');
  const apiPath = new URL(baseUrl).pathname.replace(/\/+$/, '');
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  const inlineWaitMaxMs = deps.inlineWaitMaxMs ?? 30_000;
  const log = deps.log ?? (() => undefined);

  async function applyServerTime(serverTime: unknown): Promise<void> {
    if (typeof serverTime !== 'number' || !Number.isFinite(serverTime)) return;
    await deps.store.updateDevice({ clockOffsetMs: Math.round(serverTime - now()) });
  }

  /** Full jitter: a uniform wait in [0, min(cap, base·2^attempt)], never below Retry-After. */
  function backoffMs(attempt: number, retryAfterMs: number | undefined): number {
    const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
    return Math.max(retryAfterMs ?? 0, Math.floor(random() * ceiling));
  }

  async function request<T>(method: NotifyMethod, path: string, body?: unknown): Promise<T> {
    const bytes = body === undefined ? EMPTY : encodeBody(body);
    const url = baseUrl + path;
    const signedPath = apiPath + path;
    let skewRetried = false;
    let replayRetried = false;
    let deviceRetried = false;
    let retries = 0;
    for (;;) {
      const identity = await deps.identity();
      const { clockOffsetMs } = await deps.store.getDevice();
      const headers: Record<string, string> = { ...signHeaders(identity, method, signedPath, bytes, now() + clockOffsetMs) };
      if (bytes.length) headers['Content-Type'] = 'application/json';
      let res: Response;
      try {
        res = await deps.fetch(url, { method, headers, body: bytes.length ? (bytes as unknown as BodyInit) : undefined });
      } catch (e) {
        log(`notify ${method} ${path}: network error ${String(e)}`);
        if (retries >= MAX_RETRIES) throw new NotifyError(0, 'network', { message: String(e) });
        await waitOrDefer(backoffMs(retries++, undefined), 'network');
        continue;
      }
      const text = await res.text();
      let json: unknown = null;
      if (text) { try { json = JSON.parse(text); } catch { json = null; } }
      if (res.ok) {
        if (json && typeof json === 'object') await applyServerTime((json as { serverTime?: unknown }).serverTime);
        return json as T;
      }
      const code = (json as NotifyErrorBody | null)?.error?.code || `http_${res.status}`;
      const details = (json as NotifyErrorBody | null)?.error?.details;
      const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
      if (code === 'auth_clock_skew' && !skewRetried) {
        skewRetried = true;
        await applyServerTime(details?.['serverTime']);
        continue;
      }
      if (code === 'auth_replay' && !replayRetried) { replayRetried = true; continue; }
      if (code === 'device_unknown') {
        if (method === 'DELETE') return null as T; // already gone: success (§4.4, §8.5)
        if (!deviceRetried && deps.deviceBody && path !== '/device') {
          deviceRetried = true;
          const deviceBody = await deps.deviceBody();
          if (deviceBody) {
            await request<DeviceView>('PUT', '/device', deviceBody);
            continue;
          }
        }
      }
      if (code === 'client_protocol_unsupported' || res.status === 426) {
        await deps.store.updateDevice({ protocolUnsupported: true });
        throw new NotifyError(res.status, 'client_protocol_unsupported', details);
      }
      if (RETRYABLE_STATUSES.has(res.status)) {
        if (retries >= MAX_RETRIES) throw new NotifyError(res.status, code, details, retryAfterMs);
        log(`notify ${method} ${path}: ${res.status} ${code}, retry ${retries + 1}/${MAX_RETRIES}` + (retryAfterMs ? ` after ${retryAfterMs} ms` : ''));
        await waitOrDefer(backoffMs(retries++, retryAfterMs), code);
        continue;
      }
      throw new NotifyError(res.status, code, details, retryAfterMs);
    }
  }

  async function waitOrDefer(waitMs: number, reason: string): Promise<void> {
    if (waitMs <= inlineWaitMaxMs) { await sleep(waitMs); return; }
    const dueAt = now() + waitMs;
    const prior = await deps.store.getRetry();
    await deps.store.setRetry({ dueAt, attempt: (prior?.attempt ?? 0) + 1, reason });
    await deps.scheduleRetry(dueAt, reason);
    throw new NotifyDeferred(reason, dueAt);
  }

  return {
    async getConfig(opts = {}) {
      const cached = await deps.store.getConfigCache();
      if (!opts.force && cached && now() - cached.fetchedAt < CONFIG_CACHE_MS) return cached.config;
      const res = await deps.fetch(`${baseUrl}/config`, { method: 'GET' });
      if (!res.ok) throw new NotifyError(res.status, 'config_unavailable');
      const config = (await res.json()) as NotifyConfig;
      await applyServerTime(config.serverTime);
      await deps.store.setConfigCache({ config, fetchedAt: now() });
      if (config.minClientProtocol > NOTIFY_PROTOCOL) await deps.store.updateDevice({ protocolUnsupported: true });
      return config;
    },
    getDevice: () => request<DeviceView>('GET', '/device'),
    putDevice: (body) => request<DeviceView>('PUT', '/device', body),
    deleteDevice: async () => { await request<null>('DELETE', '/device'); },
    putWallet: (walletTag, body) => request<WalletLinkView>('PUT', `/device/wallets/${walletTag}`, body),
    deleteWallet: async (walletTag) => { await request<null>('DELETE', `/device/wallets/${walletTag}`); },
    getPrefs: (walletTag) => request<WalletPrefs>('GET', `/device/wallets/${walletTag}/prefs`),
    putPrefs: (walletTag, body) => request<WalletPrefs>('PUT', `/device/wallets/${walletTag}/prefs`, body),
    clockOffsetMs: async () => (await deps.store.getDevice()).clockOffsetMs,
  };
}
