/**
 * Typed errors for the Midnight write routes (build, submit, native DUST
 * registration).
 *
 * The server answers a failed request with a JSON envelope:
 *
 *   { status, error, errorCode, message, requestId }   (+ an optional `reason`)
 *
 * and sometimes a `Retry-After` header. {@link toMidnightApiError} reads that
 * envelope once and turns it into a {@link MidnightApiError} whose `message` is
 * a sentence a user can read, chosen by `errorCode`. Callers that show
 * `error.message` therefore never show JSON or response headers; callers that
 * need to branch read `kind`, `errorCode`, `status` and `retryAfter`.
 *
 * Request and response bodies are never copied into the error: a proving
 * request carries secret witness material.
 */
import i18n from '@/plugins/i18n';

export const MIDNIGHT_NETWORK_UPGRADING = 'MIDNIGHT_NETWORK_UPGRADING';
export const LEDGER_MISMATCH = 'LEDGER_MISMATCH';
export const MIDNIGHT_PROVER_BUSY = 'MIDNIGHT_PROVER_BUSY';
export const MIDNIGHT_RESET_PENDING = 'MIDNIGHT_RESET_PENDING';
/** The `reason` of a MIDNIGHT_NETWORK_UPGRADING 501 (and of the status read) that says this build must update. */
export const CLIENT_UPDATE_REQUIRED = 'CLIENT_UPDATE_REQUIRED';

/**
 * What the failure means for the wallet:
 * - `networkUpgrading`: writes on this network are paused for a network upgrade.
 * - `updateRequired`: writes on this network are closed to this build (a 501
 *   MIDNIGHT_NETWORK_UPGRADING with reason CLIENT_UPDATE_REQUIRED); a newer build may send.
 * - `ledgerMismatch`: the network's ledger changed under the transaction; a fresh build may work.
 * - `proverBusy`: the server's prover is at capacity (`retryAfter` says when to try again).
 * - `resetPending`: the server's view of the chain is being rebuilt.
 * - `server`: any other answer from the server; `message` is the server's sentence.
 * - `noAnswer`: no usable answer (network error, timeout, a body that is not the envelope).
 */
export type MidnightApiErrorKind =
  | 'networkUpgrading'
  | 'updateRequired'
  | 'ledgerMismatch'
  | 'proverBusy'
  | 'resetPending'
  | 'server'
  | 'noAnswer';

/**
 * Which kind of route failed. A build route that gets no usable answer sent
 * nothing; a submit route that gets none may have reached the network.
 */
export type MidnightApiPhase = 'build' | 'submit';

/** The fields of the server's error envelope the wallet uses. */
export interface MidnightErrorEnvelope {
  status?: number;
  errorCode?: string;
  /** Why the route is closed, when the server says (for example on a 501). */
  reason?: string;
  /** The server's own sentence. */
  message?: string;
  /** Seconds, from the `Retry-After` header. */
  retryAfter?: number;
}

export class MidnightApiError extends Error {
  readonly kind: MidnightApiErrorKind;
  readonly status?: number;
  readonly errorCode?: string;
  readonly reason?: string;
  /** The server's `message`, unmapped, for callers that classify by it. */
  readonly serverMessage?: string;
  readonly retryAfter?: number;
  /** The wallet network the request was for (`Mainnet`, `Preprod`, ...). */
  readonly network?: string;
  readonly phase: MidnightApiPhase;

  constructor(kind: MidnightApiErrorKind, envelope: MidnightErrorEnvelope, network?: string, phase: MidnightApiPhase = 'build') {
    super(readableMidnightError(kind, envelope, network, phase));
    this.name = 'MidnightApiError';
    this.phase = phase;
    this.kind = kind;
    this.status = envelope.status;
    this.errorCode = envelope.errorCode;
    this.reason = envelope.reason;
    this.serverMessage = envelope.message;
    this.retryAfter = envelope.retryAfter;
    this.network = network;
  }
}

/**
 * Matched by name, not `instanceof`: the dialogs reach the tx service through a
 * dynamic import, and a name check holds across that boundary.
 */
export function isMidnightApiError(error: unknown): error is MidnightApiError {
  return error instanceof Error && error.name === 'MidnightApiError' && typeof (error as { kind?: unknown }).kind === 'string';
}

/**
 * True when a failed DApp request is down to the server or the network, not to
 * the request: a paused network, a changed ledger, a busy prover, a pending
 * reset, no answer, a 5xx, or a submit whose reply was lost. The connector
 * answers these with `InternalError`; anything else stays `InvalidRequest`.
 */
const SERVER_SIDE_4XX: ReadonlySet<number> = new Set([401, 403, 408, 429]);

export function isMidnightServerSideFailure(error: unknown): boolean {
  if (error instanceof Error && error.name === 'MidnightSubmitUnconfirmedError') return true;
  if (!isMidnightApiError(error)) return false;
  if (error.kind !== 'server') return true;
  // Auth, a timeout and rate limiting are the server's state, not the dapp's request.
  if (typeof error.status === 'number' && SERVER_SIDE_4XX.has(error.status)) return true;
  return typeof error.status !== 'number' || error.status >= 500;
}

/**
 * A send refused for a state the user can't fix from the send screen. Not an
 * error: the screen shows it as a note and disables its CTA.
 * - `networkUpgrading`: the server answered MIDNIGHT_NETWORK_UPGRADING.
 * - `updateRequired`: the server closed sends to this build (reason
 *   CLIENT_UPDATE_REQUIRED), or the pre-sign guard read the built transaction as
 *   a newer ledger than this build signs for (MidnightBuiltTxRefusedError, code
 *   MIDNIGHT_BUILT_TX_LEDGER_UNSUPPORTED).
 */
export type MidnightSendBlock = 'networkUpgrading' | 'updateRequired';

export function midnightSendBlockOf(error: unknown): MidnightSendBlock | null {
  const kind = midnightApiErrorKind(error);
  if (kind === 'networkUpgrading') return 'networkUpgrading';
  if (kind === 'updateRequired') return 'updateRequired';
  if (error instanceof Error && error.name === 'MidnightBuiltTxRefusedError'
    && (error as { code?: unknown }).code === 'MIDNIGHT_BUILT_TX_LEDGER_UNSUPPORTED') return 'updateRequired';
  return null;
}

/** "Midnight Preprod" for the wallet network `Preprod`: the name the network list shows. */
export function midnightNetworkDisplayName(network: string | undefined | null): string {
  const name = (network ?? '').trim();
  if (!name) return 'Midnight';
  return /^midnight\b/i.test(name) ? name : `Midnight ${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** The kind of a Midnight API failure, or undefined for any other error. */
export function midnightApiErrorKind(error: unknown): MidnightApiErrorKind | undefined {
  return isMidnightApiError(error) ? error.kind : undefined;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Seconds from a `Retry-After` value: delta-seconds or an HTTP date. */
export function parseRetryAfter(value: unknown, now: number = Date.now()): number | undefined {
  const raw = typeof value === 'number' ? String(value) : text(value);
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

function header(headers: unknown, name: string): unknown {
  if (!headers || typeof headers !== 'object') return undefined;
  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === 'function') {
    try {
      const value = (getter as (n: string) => unknown).call(headers, name);
      if (value !== undefined && value !== null) return value;
    } catch { /* fall through to the plain lookup */ }
  }
  const record = headers as Record<string, unknown>;
  return record[name] ?? record[name.toLowerCase()];
}

/** A plain-text body is a message only when it is short and not a page of HTML. */
function plainTextMessage(body: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed || trimmed.startsWith('<') || trimmed.length > 500) return undefined;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return undefined;
  return trimmed;
}

/**
 * Read the server's envelope from a response. Returns undefined when the body is
 * not one (no body, HTML from a proxy, a binary payload).
 */
export function parseMidnightErrorEnvelope(status: number | undefined, data: unknown, headers?: unknown): MidnightErrorEnvelope | undefined {
  let body: unknown = data;
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (trimmed.startsWith('{')) {
      try { body = JSON.parse(trimmed); } catch { body = undefined; }
    } else {
      const message = plainTextMessage(trimmed);
      if (!message) return undefined;
      return { status, message, retryAfter: parseRetryAfter(header(headers, 'retry-after')) };
    }
  }
  if (!isRecord(body)) return undefined;
  const errorCode = text(body['errorCode']);
  const message = text(body['message']) ?? text(body['error']);
  const reason = text(body['reason']);
  if (!errorCode && !message && !reason) return undefined;
  const bodyStatus = typeof body['status'] === 'number' ? body['status'] : undefined;
  return {
    status: status ?? bodyStatus,
    errorCode,
    reason,
    message,
    retryAfter: parseRetryAfter(header(headers, 'retry-after')),
  };
}

/** The kind an envelope maps to. `LEDGER_MISMATCH` is also read from `message` until the server sends the code. */
export function midnightErrorKindOf(envelope: MidnightErrorEnvelope): MidnightApiErrorKind {
  switch (envelope.errorCode) {
    case MIDNIGHT_NETWORK_UPGRADING: return envelope.reason === CLIENT_UPDATE_REQUIRED ? 'updateRequired' : 'networkUpgrading';
    case LEDGER_MISMATCH: return 'ledgerMismatch';
    case MIDNIGHT_PROVER_BUSY: return 'proverBusy';
    case MIDNIGHT_RESET_PENDING: return 'resetPending';
    default: break;
  }
  if (envelope.message && /^LEDGER_MISMATCH\b/.test(envelope.message)) return 'ledgerMismatch';
  return envelope.message || envelope.reason ? 'server' : 'noAnswer';
}

/** The sentence a user sees for a failure of this kind. */
export function readableMidnightError(
  kind: MidnightApiErrorKind,
  envelope: MidnightErrorEnvelope,
  network?: string,
  phase: MidnightApiPhase = 'build',
): string {
  switch (kind) {
    case 'networkUpgrading':
      return String(i18n.t('midnight.errors.networkUpgrading', { network: midnightNetworkDisplayName(network) }));
    case 'updateRequired':
      return String(i18n.t('midnight.errors.updateRequired'));
    case 'ledgerMismatch':
      return String(i18n.t('midnight.errors.ledgerMismatch'));
    case 'noAnswer':
      // A submit with no usable answer may still have reached the network.
      return String(i18n.t(phase === 'submit' ? 'midnight.errors.submitUnconfirmed' : 'midnight.errors.noAnswer'));
    default:
      // Prover busy and a pending reset are handled by their own flows; until a
      // flow catches them, the server's sentence is the best thing to show.
      return envelope.message ?? envelope.reason ?? String(i18n.t('midnight.errors.noAnswer'));
  }
}

interface AxiosLike {
  isAxiosError: true;
  response?: { status?: number; data?: unknown; headers?: unknown };
}

const isAxiosLike = (error: unknown): error is AxiosLike =>
  !!error && typeof error === 'object' && (error as { isAxiosError?: unknown }).isAxiosError === true;

/**
 * A server answer (status, body, headers) as a typed error. Used for a 2xx that
 * is not the expected 200 as well as for an axios error's response.
 */
export function midnightApiErrorFromResponse(
  status: number | undefined,
  data: unknown,
  headers: unknown,
  network?: string,
  phase: MidnightApiPhase = 'build',
): MidnightApiError {
  const envelope = parseMidnightErrorEnvelope(status, data, headers);
  if (!envelope) return new MidnightApiError('noAnswer', { status, retryAfter: parseRetryAfter(header(headers, 'retry-after')) }, network, phase);
  return new MidnightApiError(midnightErrorKindOf(envelope), envelope, network, phase);
}

/**
 * Any failure of a Midnight API call as a {@link MidnightApiError}. An error that
 * already is one passes through. A request that got no answer is `noAnswer`.
 * Anything that is not an HTTP error (the device token couldn't be fetched, the
 * URL couldn't be built) failed before the request left the device, so it uses
 * the build-phase copy, "Nothing was sent", even on a submit route.
 */
export function toMidnightApiError(error: unknown, network?: string, phase: MidnightApiPhase = 'build'): MidnightApiError {
  if (isMidnightApiError(error)) return error;
  if (isAxiosLike(error)) {
    if (error.response) {
      const { status, data, headers } = error.response;
      return midnightApiErrorFromResponse(status, data, headers, network, phase);
    }
    return new MidnightApiError('noAnswer', {}, network, phase);
  }
  return new MidnightApiError('noAnswer', {}, network, 'build');
}
