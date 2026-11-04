/**
 * Checks Gero's response signatures on an axios client.
 *
 * The mode is fixed at build time (`VITE_SIGNED_RESPONSES`) and never read from a
 * remote flag: feature flags are among the answers being protected, so a flag
 * that could turn verification off would let a forged flag turn it off.
 *
 *  - `off` (default): nothing is installed; the client behaves exactly as before.
 *  - `shadow`: every response is checked after it is handed on; a failure is only
 *    counted (`signedResponseReport()`) and noted in the debug log.
 *  - `enforce`: a response that fails the check never reaches the caller; the call
 *    rejects with `UnsignedResponseError`.
 *
 * Only paths gero-backend signs are checked (`SIGNED_PATH_PREFIXES`); the others pass
 * untouched whatever the mode.
 *
 * The check needs the body exactly as received, before JSON parsing. A
 * `transformResponse` step placed first keeps the raw text on the request config
 * and passes it on unchanged, so parsing stays what it was.
 */
import { AxiosHeaders, type AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import {
  UnsignedResponseError,
  failureReason,
  verifySignedResponse,
  type KeyResolver,
  type SignedResponseFailure,
  type SignedResponseResult,
} from '@/shared/utils/signedResponse';
import type { SigningService } from '@/shared/utils/signedResponseRoots';
import { debugLog } from '@/utils/debug';
import { signingKeys } from './signingKeys';

export type SignedResponseMode = 'off' | 'shadow' | 'enforce';

export function signedResponseMode(value: unknown = import.meta.env['VITE_SIGNED_RESPONSES']): SignedResponseMode {
  return value === 'shadow' || value === 'enforce' ? value : 'off';
}

/**
 * The request paths gero-backend signs, the same list as its
 * `config.response-signing.path-prefixes` default. Only these are checked; every other path
 * passes untouched in every mode, so an enforcing build never refuses an answer the server was
 * never asked to sign. A prefix ending in `/` covers everything below it; any other prefix covers
 * that exact path and the paths below it (`/api/pools` covers `/api/pools/{id}`, not
 * `/api/poolsfoo`), as on the server.
 *
 * Compatibility: a path joins this list only after gero-backend signs it in production, and the
 * server never stops signing a path an enforcing release checks. The shared vectors pin the list
 * (`signedPathPrefixes`), so the wallet and gero-backend cannot drift apart unnoticed.
 */
export const SIGNED_PATH_PREFIXES: readonly string[] = [
  '/api/nexus/api/tx/',
  '/api/nexus/api/collateral/',
  '/api/nexus/api/aggregator/',
  '/api/assets/handle',
  '/api/pools',
  '/api/dreps',
  '/api/mpc/',
];

export function isSignedPath(path: string, prefixes: readonly string[] = SIGNED_PATH_PREFIXES): boolean {
  return prefixes.some((prefix) =>
    prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`),
  );
}

function requestPath(instance: AxiosInstance, response: AxiosResponse): string {
  try {
    return new URL(instance.getUri(response.config)).pathname;
  } catch {
    return '';
  }
}

const RAW_BODY = Symbol('geroRawResponseBody');
type ConfigWithRaw = InternalAxiosRequestConfig & { [RAW_BODY]?: unknown };

// The keys come from root-signed delegations (signingKeys.ts); until a root is pinned
// none resolve, so a check can only fail. `setSignedResponseKeys` overrides one service.
const resolvers = new Map<SigningService, KeyResolver>();

export function setSignedResponseKeys(service: SigningService, resolver: KeyResolver): void {
  resolvers.set(service, resolver);
}

type Outcome = 'verified' | SignedResponseFailure;
const counts = new Map<string, number>();

/** Counts per service and outcome since the context started. No URLs, bodies or addresses. */
export function signedResponseReport(): Record<string, number> {
  return Object.fromEntries(counts);
}

function record(service: SigningService, outcome: Outcome): void {
  const key = `${service}:${outcome}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function bodyBytes(value: unknown): Uint8Array | undefined {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return undefined;
}

/** Builds the exchange from an axios response and checks it. Never throws. */
export async function checkAxiosResponse(
  instance: AxiosInstance,
  response: AxiosResponse,
  keys: KeyResolver,
  nowSeconds: number,
): Promise<SignedResponseResult> {
  const config = response.config as ConfigWithRaw;
  const sent = config.data;
  const requestBody = sent === undefined || sent === null ? undefined : bodyBytes(sent);
  if (sent !== undefined && sent !== null && !requestBody) return { ok: false, reason: 'unverifiable-request' };
  const responseBody = bodyBytes(config[RAW_BODY]);
  if (!responseBody) return { ok: false, reason: 'unverifiable-response' };

  let url: string;
  try {
    url = instance.getUri(config);
  } catch {
    return { ok: false, reason: 'unverifiable-request' };
  }
  const headers = AxiosHeaders.from(response.headers as AxiosHeaders);
  return verifySignedResponse(
    {
      request: { method: (config.method ?? 'get').toUpperCase(), url, body: requestBody },
      response: {
        status: response.status,
        header: (name) => {
          const value = headers.get(name);
          return typeof value === 'string' ? value : undefined;
        },
        body: responseBody,
      },
    },
    { keys, nowSeconds },
  );
}

export interface InstallOptions {
  mode?: SignedResponseMode;
  keys?: KeyResolver;
  now?: () => number;
}

/**
 * Installs the check on `instance`. Call it right after `axios.create`, before any
 * other response interceptor, so the check sees the response first.
 */
export function installSignedResponses(
  instance: AxiosInstance,
  service: SigningService,
  options: InstallOptions = {},
): void {
  const mode = options.mode ?? signedResponseMode();
  if (mode === 'off') return;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));

  const existing = instance.defaults.transformResponse;
  const rest = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing];
  instance.defaults.transformResponse = [
    function keepRawBody(this: ConfigWithRaw, data: unknown) {
      this[RAW_BODY] = data;
      return data;
    },
    ...rest,
  ];

  const verify = async (response: AxiosResponse): Promise<SignedResponseResult> => {
    const fixed = options.keys ?? resolvers.get(service);
    if (fixed) return checkAxiosResponse(instance, response, fixed, now());
    const keys = signingKeys();
    const result = await checkAxiosResponse(instance, response, await keys.resolver(service), now());
    // A key approved since the last fetch: fetch again (rate-limited) and check once more.
    if (failureReason(result) !== 'unknown-key') return result;
    return checkAxiosResponse(instance, response, await keys.refetchForUnknownKey(service), now());
  };

  const check = async (response: AxiosResponse): Promise<SignedResponseFailure | undefined> => {
    // A path gero-backend does not sign is never checked, in any mode.
    if (!isSignedPath(requestPath(instance, response))) return undefined;
    let result: SignedResponseResult;
    try {
      result = await verify(response);
    } catch {
      result = { ok: false, reason: 'unknown-key' };
    }
    const reason = failureReason(result);
    record(service, reason ?? 'verified');
    if (reason) debugLog('[signed-responses]', service, mode, (response.config.method ?? 'get').toUpperCase(), reason);
    return reason;
  };

  instance.interceptors.response.use(
    async (response) => {
      if (mode === 'shadow') {
        void check(response);
        return response;
      }
      const reason = await check(response);
      if (reason) throw new UnsignedResponseError(reason);
      return response;
    },
    async (error: unknown) => {
      const response = (error as { response?: AxiosResponse } | undefined)?.response;
      if (response) {
        if (mode === 'shadow') void check(response);
        else {
          const reason = await check(response);
          if (reason) throw new UnsignedResponseError(reason);
        }
      }
      throw error;
    },
  );
}
