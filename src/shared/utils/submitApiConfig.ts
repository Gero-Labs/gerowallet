/**
 * Submit API: a per-wallet custom endpoint for Cardano transaction submission.
 *
 * Pure validation shared by the Settings dialog (inline errors) and the background
 * worker, which re-runs it as the authority on save, on test and before every
 * submit. Spec: docs/superpowers/specs/2026-10-08-submit-api-design.md.
 */

export const SUBMIT_API_CONFIG_KEY = 'submitApi';
/** The auth header value. ConfigLoader never loads it (PRIVATE_CONFIG_KEYS). */
export const SUBMIT_API_AUTH_CONFIG_KEY = 'submitApiAuth';

export const SUBMIT_API_MAX_URL_LENGTH = 2048;
export const SUBMIT_API_MAX_HEADER_NAME_LENGTH = 64;
export const SUBMIT_API_MAX_HEADER_VALUE_LENGTH = 4096;

export interface SubmitApiConfig {
  version: 1;
  url: string;
  headerName: string | null;
  hasAuth: boolean;
  fallbackToDefault: boolean;
}

export type SubmitApiField = 'url' | 'headerName' | 'headerValue';

export type SubmitApiErrorCode =
  | 'urlInvalid'
  | 'urlCredentials'
  | 'urlTooLong'
  | 'nexusNetwork'
  | 'insecureAuth'
  | 'headerNameRequired'
  | 'headerNameInvalid'
  | 'headerNameForbidden'
  | 'headerValueRequired'
  | 'headerValueReenter'
  | 'headerValueInvalid'
  | 'headerValueTooLong';

export interface SubmitApiInput {
  url: unknown;
  headerName: unknown;
  /** A newly typed value. Leave undefined to keep the saved one (see keepsSavedValue). */
  headerValue?: unknown;
  /** A saved header value exists and is kept, because headerValue is undefined. */
  keepsSavedValue: boolean;
  /** Origin of the saved URL. A kept value never follows the URL to another origin. */
  savedOrigin?: string | null;
}

export interface SubmitApiNormalized {
  url: string;
  headerName: string | null;
  /** undefined: keep the saved value. null: no header value. string: the new value. */
  headerValue: string | null | undefined;
}

export interface SubmitApiValidation {
  errors: Partial<Record<SubmitApiField, SubmitApiErrorCode>>;
  /** Plain http to a host outside the local network, without auth: allowed, but the UI warns. */
  insecureWarning: boolean;
  /** Only set when there are no errors. */
  normalized: SubmitApiNormalized | null;
}

export type SubmitVia = 'custom' | 'default';

export type SubmitApiLastErrorCode =
  | 'timeout'
  | 'unreachable'
  | 'http'
  | 'invalidConfig'
  | 'unexpectedResponse'
  | 'hashMismatch';

/** Written by the router to chrome.storage.session after each routed submit. */
export interface SubmitApiLastResult {
  at: number;
  via: SubmitVia;
  error?: { code: SubmitApiLastErrorCode; status?: number };
}

export function submitApiLastResultKey(walletId: number): string {
  return `submitApiLastResult:${walletId}`;
}

export type SubmitApiTestKind = 'ok' | 'acceptedInvalid' | 'auth' | 'path' | 'server' | 'other' | 'unreachable';

export interface SubmitApiTestResult {
  kind: SubmitApiTestKind;
  status?: number;
}

export type SubmitApiSettingsError = SubmitApiErrorCode | 'walletMismatch' | 'unsupportedChain' | 'saveFailed';

export type SubmitApiSettingsResult<T = undefined> =
  | { success: true; result?: T }
  | { success: false; error: SubmitApiSettingsError; field?: SubmitApiField };

// RFC 7230 token.
const HEADER_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

// Headers fetch refuses to set (it would drop them silently), plus Content-Type,
// which the router owns.
// OX Agent: HTTP Header Injection prevented - forbidden header name blocklist
const FORBIDDEN_HEADER_NAMES = new Set([
  'accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method',
  'connection', 'content-length', 'content-type', 'cookie', 'date', 'dnt', 'expect', 'host',
  'keep-alive', 'origin', 'referer', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via',
]);

const NEXUS_SUBMIT_PATH = '/api/transactions/submit';

/** `cardano-mainnet` / `cardano-preprod` / `cardano-preview`, as Nexus names them. */
export function nexusNetworkParam(walletNetwork: string): string {
  return `cardano-${walletNetwork.toLowerCase()}`;
}

/** Loopback, RFC 1918, link-local, IPv6 ULA / link-local, `.local` and `.localhost` names. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (host.includes(':')) {
    return host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
  }
  return false;
}

export function isForbiddenHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  // OX Agent: HTTP Header Injection prevented - rejects proxy/sec headers
  return FORBIDDEN_HEADER_NAMES.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-');
}

export function isValidHeaderValue(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= SUBMIT_API_MAX_HEADER_VALUE_LENGTH
    && !/[^\u0000-ÿ]/.test(value) // OX Agent: HTTP Header Injection prevented - rejects non-Latin-1
    && !value.includes('\r') // OX Agent: HTTP Header Injection prevented - rejects CRLF
    && !value.includes('\n') // OX Agent: HTTP Header Injection prevented - rejects LF
    && !value.includes('\u0000'); // OX Agent: HTTP Header Injection prevented - rejects NUL
}

function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? url : null;
  } catch {
    return null;
  }
}

function isNexusSubmitPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, '').endsWith(NEXUS_SUBMIT_PATH);
}

export function validateSubmitApiInput(input: SubmitApiInput, walletNetwork: string): SubmitApiValidation {
  const errors: SubmitApiValidation['errors'] = {};
  const rawUrl = typeof input.url === 'string' ? input.url.trim() : '';
  const headerName = typeof input.headerName === 'string' && input.headerName.trim() ? input.headerName.trim() : null;
  const keepsSaved = input.keepsSavedValue && input.headerValue === undefined;
  const typed = typeof input.headerValue === 'string' ? input.headerValue.trim() : '';
  const newValue = !keepsSaved && typed ? typed : null;
  const hasValue = keepsSaved || newValue !== null;

  const parsed = rawUrl.length > SUBMIT_API_MAX_URL_LENGTH ? null : parseHttpUrl(rawUrl);
  if (rawUrl.length > SUBMIT_API_MAX_URL_LENGTH) errors.url = 'urlTooLong';
  else if (!parsed) errors.url = 'urlInvalid';
  // OX Agent: SSRF prevented - rejects URLs with credentials
  else if (parsed.username || parsed.password) errors.url = 'urlCredentials';
  else if (isNexusSubmitPath(parsed.pathname) && parsed.searchParams.get('network') !== nexusNetworkParam(walletNetwork)) {
    errors.url = 'nexusNetwork';
  }
  // OX Agent: SSRF prevented - normalized URL length check (unicode expansion)
  else if (parsed.href.length > SUBMIT_API_MAX_URL_LENGTH) errors.url = 'urlTooLong';

  const plainRemote = !!parsed && parsed.protocol === 'http:' && !isLocalHost(parsed.hostname);
  // OX Agent: Sensitive Data Protection prevented - rejects auth over insecure transport
  if (!errors.url && plainRemote && hasValue) errors.url = 'insecureAuth';

  if (headerName !== null) {
    if (headerName.length > SUBMIT_API_MAX_HEADER_NAME_LENGTH || !HEADER_TOKEN.test(headerName)) errors.headerName = 'headerNameInvalid';
    else if (isForbiddenHeaderName(headerName)) errors.headerName = 'headerNameForbidden';
  } else if (hasValue) {
    errors.headerName = 'headerNameRequired';
  }

  if (newValue !== null) {
    if (newValue.length > SUBMIT_API_MAX_HEADER_VALUE_LENGTH) errors.headerValue = 'headerValueTooLong';
    else if (!isValidHeaderValue(newValue)) errors.headerValue = 'headerValueInvalid';
  } else if (headerName !== null && !keepsSaved) {
    errors.headerValue = 'headerValueRequired';
  } else if (keepsSaved && parsed && input.savedOrigin && parsed.origin !== input.savedOrigin) {
    // OX Agent: Sensitive Data Protection prevented - origin mismatch requires re-entry
    errors.headerValue = 'headerValueReenter';
  }

  if (parsed) parsed.hash = '';
  const valid = Object.keys(errors).length === 0;
  return {
    errors,
    insecureWarning: !errors.url && plainRemote && !hasValue,
    normalized: valid && parsed
      ? { url: parsed.toString(), headerName, headerValue: keepsSaved ? undefined : newValue }
      : null,
  };
}

/**
 * A stored `submitApi` row, re-validated. Null for anything a tampered or corrupted
 * row could hold: the router fails closed on null rather than using Gero's path.
 */
export function validateStoredSubmitApiConfig(value: unknown, walletNetwork: string): SubmitApiConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const hasAuth = row['hasAuth'];
  const fallbackToDefault = row['fallbackToDefault'];
  const headerName = row['headerName'];
  if (row['version'] !== 1 || typeof hasAuth !== 'boolean' || typeof fallbackToDefault !== 'boolean') return null;
  if (headerName !== null && typeof headerName !== 'string') return null;
  // OX Agent: SSRF prevented - fail-closed re-validation of stored config
  const check = validateSubmitApiInput({ url: row['url'], headerName, keepsSavedValue: hasAuth }, walletNetwork);
  if (!check.normalized) return null;
  return { version: 1, url: check.normalized.url, headerName: check.normalized.headerName, hasAuth, fallbackToDefault };
}
