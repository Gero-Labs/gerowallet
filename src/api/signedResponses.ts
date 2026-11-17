/**
 * Checks Gero's response signatures on everything that calls gero-backend's signed paths.
 *
 * The mode is fixed at build time (`VITE_SIGNED_RESPONSES`) and never read from a
 * remote flag: feature flags are among the answers being protected, so a flag
 * that could turn verification off would let a forged flag turn it off.
 *
 *  - `off` (default): nothing is installed; every client behaves exactly as before.
 *  - `shadow`: every response is checked after it is handed on; a failure is only
 *    counted (`signedResponseReport()`) and noted in the debug log.
 *  - `enforce`: a response that fails the check never reaches the caller; the call
 *    rejects with `UnsignedResponseError`.
 *
 * Only paths gero-backend signs are checked (`SIGNED_PATH_PREFIXES`); the others pass
 * untouched whatever the mode. Each checked request carries a fresh random
 * `Gero-Request-Nonce`, which the signature must cover.
 *
 * Two ways in, so no caller can skip the check:
 *  - `installSignedResponses(instance)` on an axios client. The check needs the body
 *    exactly as received, before JSON parsing: a `transformResponse` step placed first
 *    keeps the raw text on the request config and passes it on unchanged.
 *  - `installSignedFetch(globalThis)` once per extension context, for code that calls
 *    `fetch` itself (the swap widget does). It checks every signed-path request,
 *    including those an axios client sends through `fetch` (in the worker, axios has no
 *    XMLHttpRequest): a header the caller set never exempts a request.
 */
import { AxiosHeaders, type AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import {
  REQUEST_NONCE_HEADER,
  UnsignedResponseError,
  failureReason,
  isRequestNonce,
  newRequestNonce,
  verifySignedResponse,
  type KeyResolver,
  type SignedExchange,
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
  '/api/nexus/api/realfi/',
  '/api/assets/handle',
  '/api/assets/info',
  '/api/pools',
  '/api/dreps',
  '/api/mpc/',
];

export function isSignedPath(path: string, prefixes: readonly string[] = SIGNED_PATH_PREFIXES): boolean {
  return prefixes.some((prefix) =>
    prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`),
  );
}

function pathOf(instance: AxiosInstance, config: InternalAxiosRequestConfig): string {
  try {
    return new URL(instance.getUri(config)).pathname;
  } catch {
    return '';
  }
}

const RAW_BODY = Symbol('geroRawResponseBody');
type ConfigWithRaw = InternalAxiosRequestConfig & { [RAW_BODY]?: unknown };

// The keys come from root-signed delegations (signingKeys.ts); until roots are pinned
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

function record(service: string, outcome: Outcome): void {
  const key = `${service}:${outcome}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function bodyBytes(value: unknown): Uint8Array | undefined {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return undefined;
}

/**
 * Verifies one exchange with the delegated keys (or `fixed`), fetching the approvals
 * again, at most every few minutes, when the answer names a key id not yet known.
 * Never throws.
 */
async function verifyExchange(
  service: SigningService,
  exchange: SignedExchange,
  nowSeconds: number,
  fixed: KeyResolver | undefined,
): Promise<SignedResponseResult> {
  try {
    const resolver = fixed ?? resolvers.get(service);
    if (resolver) return await verifySignedResponse(exchange, { keys: resolver, nowSeconds });
    const keys = signingKeys();
    const result = await verifySignedResponse(exchange, { keys: await keys.resolver(service), nowSeconds });
    if (failureReason(result) !== 'unknown-key') return result;
    return await verifySignedResponse(exchange, { keys: await keys.refetchForUnknownKey(service), nowSeconds });
  } catch {
    return { ok: false, reason: 'unknown-key' };
  }
}

/** Builds the exchange from an axios response and checks it. Never throws. */
export async function checkAxiosResponse(
  instance: AxiosInstance,
  response: AxiosResponse,
  keys: KeyResolver,
  nowSeconds: number,
): Promise<SignedResponseResult> {
  const exchange = axiosExchange(instance, response);
  if ('reason' in exchange) return exchange;
  return verifySignedResponse(exchange, { keys, nowSeconds });
}

function axiosExchange(
  instance: AxiosInstance,
  response: AxiosResponse,
): SignedExchange | { ok: false; reason: SignedResponseFailure } {
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
  const nonce = AxiosHeaders.from(config.headers as AxiosHeaders).get(REQUEST_NONCE_HEADER);
  const headers = AxiosHeaders.from(response.headers as AxiosHeaders);
  return {
    request: {
      method: (config.method ?? 'get').toUpperCase(),
      url,
      body: requestBody,
      nonce: typeof nonce === 'string' ? nonce : undefined,
    },
    response: {
      status: response.status,
      header: (name) => {
        const value = headers.get(name);
        return typeof value === 'string' ? value : undefined;
      },
      body: responseBody,
    },
  };
}

export interface InstallOptions {
  mode?: SignedResponseMode;
  keys?: KeyResolver;
  now?: () => number;
  /** Test seam: the nonce each checked request carries. */
  nonce?: () => string;
}

const defaultNow = () => Math.floor(Date.now() / 1000);

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
  const now = options.now ?? defaultNow;
  const nextNonce = options.nonce ?? newRequestNonce;

  const existing = instance.defaults.transformResponse;
  const rest = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing];
  instance.defaults.transformResponse = [
    function keepRawBody(this: ConfigWithRaw, data: unknown) {
      this[RAW_BODY] = data;
      return data;
    },
    ...rest,
  ];

  // Every checked request gets its own nonce; the signature must cover it.
  instance.interceptors.request.use((config) => {
    if (isSignedPath(pathOf(instance, config))) {
      const headers = AxiosHeaders.from(config.headers);
      headers.set(REQUEST_NONCE_HEADER, nextNonce());
      config.headers = headers;
    }
    return config;
  });

  const check = async (response: AxiosResponse): Promise<SignedResponseFailure | undefined> => {
    // A path gero-backend does not sign is never checked, in any mode.
    if (!isSignedPath(pathOf(instance, response.config))) return undefined;
    const exchange = axiosExchange(instance, response);
    const result = 'reason' in exchange ? exchange : await verifyExchange(service, exchange, now(), options.keys);
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

export interface SignedFetchOptions extends InstallOptions {
  /** The backend whose signed paths are checked. Defaults to `VITE_BACKEND_URL`'s origin. */
  backendUrl?: string | undefined;
}

/** Statuses whose responses carry no body (the Response constructor refuses one). */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * Wraps `target.fetch` so a direct `fetch` of one of gero-backend's signed paths is
 * checked like an axios call. Everything else is passed to the original untouched.
 * Install once per context (page or worker), before anything fetches.
 */
export function installSignedFetch(
  target: { fetch: typeof fetch },
  service: SigningService = 'gero-backend',
  options: SignedFetchOptions = {},
): void {
  const mode = options.mode ?? signedResponseMode();
  if (mode === 'off') return;
  let origin: string;
  try {
    origin = new URL('backendUrl' in options ? String(options.backendUrl) : import.meta.env['VITE_BACKEND_URL']).origin;
  } catch {
    return;
  }
  const now = options.now ?? defaultNow;
  const nextNonce = options.nonce ?? newRequestNonce;
  const original = target.fetch.bind(target);

  target.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let request: Request;
    try {
      request = new Request(input, init);
    } catch {
      return original(input, init);
    }
    const url = new URL(request.url);
    if (url.origin !== origin || !isSignedPath(url.pathname)) return original(input, init);

    // A checked axios client has already put its own nonce on the request (and checks
    // the answer itself too); keep it so both checks cover the same request. Anything
    // else gets a fresh one.
    const given = request.headers.get(REQUEST_NONCE_HEADER);
    const nonce = isRequestNonce(given) ? given : nextNonce();
    const sentBody = request.body ? new Uint8Array(await request.clone().arrayBuffer()) : undefined;
    const headers = new Headers(request.headers);
    headers.set(REQUEST_NONCE_HEADER, nonce);
    // The body goes as the bytes already read, so it is exactly what the check hashes.
    const response = await original(new Request(request, { headers, body: sentBody ?? null }));
    const received = new Uint8Array(await response.arrayBuffer());

    const result = await verifyExchange(
      service,
      {
        request: { method: request.method.toUpperCase(), url: request.url, body: sentBody, nonce },
        response: {
          status: response.status,
          header: (name) => response.headers.get(name) ?? undefined,
          body: received,
        },
      },
      now(),
      options.keys,
    );
    const reason = failureReason(result);
    record(`${service}/fetch`, reason ?? 'verified');
    if (reason) {
      debugLog('[signed-responses]', service, 'fetch', mode, request.method.toUpperCase(), reason);
      if (mode === 'enforce') throw new UnsignedResponseError(reason);
    }
    return new Response(NULL_BODY_STATUSES.has(response.status) ? null : received, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
