/**
 * Submit router: the single place a Cardano transaction leaves the wallet.
 *
 * With no Submit API saved for the wallet, `defaultSubmit` (the caller's own 2.7.2
 * call, wrapped by an adapter below) runs untouched. With one saved, the signed
 * bytes go to the user's endpoint. Gero's path is used only when the user turned
 * fallback on and the endpoint itself failed. The feature flag is never read here:
 * a remote flip must not reroute a privacy user's transactions to Gero.
 * Spec: docs/superpowers/specs/2026-10-08-submit-api-design.md.
 */
import { Serialization } from '@cardano-sdk/core';
import {
  SUBMIT_API_ENDPOINT_PREFIX,
  SUBMIT_API_HASH_MISMATCH_MESSAGE,
  SUBMIT_API_INVALID_MESSAGE,
  TxSendError,
} from '@/chrome/config';
import { dappSubmitError, describeSubmitFailure, describeUnexpectedSubmitResponse } from '@/chrome/submitErrors';
import { readSubmitApi } from '@/chrome/submitApiStore';
import {
  isValidHeaderValue,
  submitApiLastResultKey,
  validateStoredSubmitApiConfig,
  type SubmitApiLastResult,
  type SubmitApiTestResult,
  type SubmitVia,
} from '@/shared/utils/submitApiConfig';
import { debugLog } from '@/utils/debug';

export type SubmitFailureReason = 'endpointPrefix' | 'hashMismatch' | 'unexpectedResponse' | 'outcomeUnknown' | 'invalidConfig';

export type SubmitOutcome =
  | { ok: true; via: SubmitVia; body: unknown }
  | { ok: false; via: SubmitVia; status?: number; body?: unknown; reason?: SubmitFailureReason };

export type SubmitFailure = Extract<SubmitOutcome, { ok: false }>;

export interface SubmitCardanoTxInput {
  /** Signed transaction, hex CBOR. */
  cbor: string;
  /** Null or undefined: no wallet context, so there is no setting to read. */
  walletId: number | null | undefined;
  /** The wallet's network, for the Nexus `?network=` guard. */
  network: string;
  /** The caller's existing submit call, wrapped by fromAxiosSubmit / fromFetchSubmit. */
  defaultSubmit: () => Promise<SubmitOutcome>;
}

const CUSTOM_SUBMIT_TIMEOUT_MS = 30_000;
const TEST_SUBMIT_TIMEOUT_MS = 10_000;
const INVALID_CBOR_BODY = 'Transaction is not valid hex CBOR';

/** Statuses that mean the endpoint is the problem, not the transaction. 400 is never one. */
const FALLBACK_STATUSES = new Set([401, 403, 404, 405, 408, 415, 425, 429]);

export function isFallbackEligibleStatus(status: number): boolean {
  return FALLBACK_STATUSES.has(status) || (status >= 500 && status < 600);
}

type EndpointResult =
  | { kind: 'accepted'; body: string }
  | { kind: 'http'; status: number; body: string }
  | { kind: 'transport'; timedOut: boolean };

type EndpointFailure = Exclude<EndpointResult, { kind: 'accepted' }>;

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function localTxId(cbor: string): string | null {
  try {
    return Serialization.Transaction.fromCbor(Serialization.TxCBOR(cbor)).getId();
  } catch {
    return null;
  }
}

/** A JSON-quoted or bare 64-hex hash, lowercased. Null for anything else. */
function parseSubmittedTxHash(body: string): string | null {
  const trimmed = body.trim().replace(/^"|"$/g, '');
  return /^[0-9a-fA-F]{64}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function redact(text: string, secret: string | null): string {
  // OX Agent: Sensitive Data Protection prevented - an endpoint that echoes the key cannot leak it into messages
  return secret ? text.split(secret).join('***') : text;
}

async function postToEndpoint(
  url: string,
  headerName: string | null,
  headerValue: string | null,
  body: Uint8Array<ArrayBuffer>,
  timeoutMs: number,
): Promise<EndpointResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/cbor' };
  if (headerName && headerValue) headers[headerName] = headerValue;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      // OX Agent: Sensitive Data Protection prevented - fetch keeps custom auth headers across a cross-origin redirect, so none is followed
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { kind: 'transport', timedOut: (error as { name?: unknown } | null)?.name === 'TimeoutError' };
  }
  const text = redact(await response.text().catch(() => ''), headerValue);
  return response.ok ? { kind: 'accepted', body: text } : { kind: 'http', status: response.status, body: text };
}

function lastError(result: EndpointFailure): NonNullable<SubmitApiLastResult['error']> {
  if (result.kind === 'transport') return { code: result.timedOut ? 'timeout' : 'unreachable' };
  return { code: 'http', status: result.status };
}

async function recordLastResult(walletId: number, result: Omit<SubmitApiLastResult, 'at'>): Promise<void> {
  try {
    await chrome.storage.session.set({ [submitApiLastResultKey(walletId)]: { ...result, at: Date.now() } });
  } catch {
    // The Settings status line is the only reader; a failed write must not fail the submit.
  }
}

async function acceptCustom(walletId: number, cbor: string, body: string): Promise<SubmitOutcome> {
  const hash = parseSubmittedTxHash(body);
  if (!hash) {
    await recordLastResult(walletId, { via: 'custom', error: { code: 'unexpectedResponse' } });
    return { ok: false, via: 'custom', body, reason: 'unexpectedResponse' };
  }
  if (hash !== localTxId(cbor)) {
    await recordLastResult(walletId, { via: 'custom', error: { code: 'hashMismatch' } });
    return { ok: false, via: 'custom', reason: 'hashMismatch' };
  }
  await recordLastResult(walletId, { via: 'custom' });
  return { ok: true, via: 'custom', body: hash };
}

export async function submitCardanoTx(input: SubmitCardanoTxInput): Promise<SubmitOutcome> {
  const { cbor, walletId, network, defaultSubmit } = input;
  if (walletId === null || walletId === undefined) return defaultSubmit();

  const stored = await readSubmitApi(walletId);
  if (stored.config === null) return defaultSubmit();

  // OX Agent: SSRF prevented - the stored URL is re-validated (validateStoredSubmitApiConfig) before any request
  const config = validateStoredSubmitApiConfig(stored.config, network);
  const auth = config?.hasAuth && isValidHeaderValue(stored.auth) ? stored.auth : null;
  if (!config || (config.hasAuth && auth === null)) {
    await recordLastResult(walletId, { via: 'custom', error: { code: 'invalidConfig' } });
    return { ok: false, via: 'custom', reason: 'invalidConfig' };
  }

  const bytes = hexToBytes(cbor);
  if (!bytes) return { ok: false, via: 'custom', status: 400, body: INVALID_CBOR_BODY };

  // OX Agent: Log Injection prevented - only the parsed origin is logged (URL parsing strips CR/LF), never path, query or header
  debugLog(`Submit API: submitting via ${new URL(config.url).origin}`);
  const result = await postToEndpoint(config.url, config.headerName, auth, bytes, CUSTOM_SUBMIT_TIMEOUT_MS);
  if (result.kind === 'accepted') return acceptCustom(walletId, cbor, result.body);

  const eligible = result.kind === 'transport' || isFallbackEligibleStatus(result.status);
  if (!config.fallbackToDefault || !eligible) {
    await recordLastResult(walletId, { via: 'custom', error: lastError(result) });
    return result.kind === 'transport'
      ? { ok: false, via: 'custom', reason: 'endpointPrefix' }
      : { ok: false, via: 'custom', status: result.status, body: result.body, reason: 'endpointPrefix' };
  }

  await recordLastResult(walletId, { via: 'default', error: lastError(result) });
  const fallback = await defaultSubmit();
  if (fallback.ok === false && result.kind === 'transport' && result.timedOut && fallback.status === 400) {
    // The endpoint may have accepted the tx before timing out, in which case Gero's
    // node now sees spent inputs. That 400 does not mean the tx was rejected.
    return { ok: false, via: 'default', reason: 'outcomeUnknown' };
  }
  return fallback;
}

/** Wraps an axios-style call (resolves the value, throws `{ response: { status, data } }`). */
export function fromAxiosSubmit(run: () => Promise<unknown>): () => Promise<SubmitOutcome> {
  return async () => {
    try {
      return { ok: true, via: 'default', body: await run() };
    } catch (error) {
      const response = (error as { response?: { status?: number; data?: unknown } } | null)?.response;
      return { ok: false, via: 'default', status: response?.status, body: response?.data };
    }
  };
}

/** Wraps a fetch call. A network error propagates exactly as it did before the router. */
export function fromFetchSubmit(run: () => Promise<Response>): () => Promise<SubmitOutcome> {
  return async () => {
    const response = await run();
    if (!response.ok) {
      return { ok: false, via: 'default', status: response.status, body: await response.text().catch(() => '') };
    }
    return { ok: true, via: 'default', body: await response.text() };
  };
}

/** The user-facing reason, English (the background has no i18n; friendlyTxError localizes). */
export function describeRoutedFailure(failure: SubmitFailure): string {
  switch (failure.reason) {
    case 'invalidConfig':
      return SUBMIT_API_INVALID_MESSAGE;
    case 'hashMismatch':
      return SUBMIT_API_HASH_MISMATCH_MESSAGE;
    case 'unexpectedResponse':
      return SUBMIT_API_ENDPOINT_PREFIX + describeUnexpectedSubmitResponse(failure.body);
    case 'outcomeUnknown':
      return describeSubmitFailure(undefined, undefined);
    case 'endpointPrefix':
      return SUBMIT_API_ENDPOINT_PREFIX + describeSubmitFailure(failure.status, failure.body);
    default:
      return describeSubmitFailure(failure.status, failure.body);
  }
}

/** CIP-30 error object. Default-path failures keep dappSubmitError's exact shape. */
export function dappRoutedError(failure: SubmitFailure): unknown {
  if (failure.reason === undefined) return dappSubmitError(failure.status, failure.body);
  const info = describeRoutedFailure(failure);
  return { ...TxSendError.Failure, info, message: info };
}

const ROUTED_SUBMIT_FAILURE = 'submitRoutedFailure';

/** An Error for WalletBg's catch to rethrow as-is (it already carries the final message). */
export function routedSubmitError(failure: SubmitFailure): Error {
  const error = new Error(describeRoutedFailure(failure));
  (error as Error & Record<string, unknown>)[ROUTED_SUBMIT_FAILURE] = true;
  return error;
}

export function isRoutedSubmitError(error: unknown): boolean {
  return Boolean((error as Record<string, unknown> | null)?.[ROUTED_SUBMIT_FAILURE]);
}

/** Settings "Test": posts one 0x00 byte. A real submit API answers 400 to it. */
export async function probeSubmitEndpoint(
  url: string,
  headerName: string | null,
  headerValue: string | null,
): Promise<SubmitApiTestResult> {
  const result = await postToEndpoint(url, headerName, headerValue, new Uint8Array([0]), TEST_SUBMIT_TIMEOUT_MS);
  if (result.kind === 'transport') return { kind: 'unreachable' };
  if (result.kind === 'accepted') return { kind: 'acceptedInvalid' };
  const { status } = result;
  if (status === 400) return { kind: 'ok', status };
  if (status === 401 || status === 403) return { kind: 'auth', status };
  if (status === 404 || status === 405) return { kind: 'path', status };
  if (status >= 500) return { kind: 'server', status };
  return { kind: 'other', status };
}
