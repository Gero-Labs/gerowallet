/**
 * Recovery for a Midnight submit whose reply was lost.
 *
 * Server-side proving plus waiting for `InBlock` can outlast the edge in front
 * of Nexus (Cloudflare answers 524 after 100 s), and a dropped connection looks
 * the same to the wallet: no answer. The transaction may well have landed, so
 * reporting that as a failed send invites a double spend attempt. Instead the
 * caller passes the ledger identifiers it computed before submitting
 * (`Transaction.identifiers()`, identical before and after proving) and this
 * module asks the indexer whether the transaction arrived.
 */
import i18n from '@/plugins/i18n';
import { parseMidnightErrorEnvelope, toMidnightApiError } from './midnightApiError';
import type { SubmitMidnightTxResponse } from './midnight-api';

/** What a caller knows about the transaction it is submitting, enough to find it again. */
export interface MidnightSubmitWatch {
  /** Ledger transaction identifiers (hex) from `Transaction.identifiers()`. */
  identifiers?: readonly string[];
}

export const SUBMIT_POLL_INTERVAL_MS = 5_000;
export const SUBMIT_POLL_WINDOW_MS = 120_000;

/** The wallet gave up waiting, not the network: the transaction may still be included. */
export class MidnightSubmitUnconfirmedError extends Error {
  constructor() {
    super(String(i18n.t('midnight.errors.submitUnconfirmed')));
    this.name = 'MidnightSubmitUnconfirmedError';
  }
}

export const SUBMITTED_TX_QUERY = `query GeroSubmittedTx($id: HexEncoded!) {
  transactions(offset: {identifier: $id}) {
    __typename
    hash
    ... on RegularTransaction { identifiers transactionResult { status } }
  }
}`;

/**
 * The same lookup by the ledger hash a history row carries, for a pending row
 * the wallet checks again later (midnightPendingSends.ts): pending rows keep
 * the hash, not the identifiers. With the indexer's latest block, so "not
 * found" can be told apart from "not indexed that far yet".
 */
export const PENDING_TX_QUERY = `query GeroPendingTx($hash: HexEncoded!) {
  transactions(offset: {hash: $hash}) {
    __typename
    hash
    ... on RegularTransaction { transactionResult { status } }
  }
  block { height timestamp }
}`;

const LOST_REPLY_CODES: ReadonlySet<string> = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK']);
// Gateway and Cloudflare "the origin did not answer in time" statuses.
const LOST_REPLY_STATUSES: ReadonlySet<number> = new Set([502, 503, 504, 520, 522, 524]);

interface AxiosLikeError {
  isAxiosError: true;
  code?: string;
  response?: { status?: number; data?: unknown; headers?: unknown };
}

/**
 * True when the submit may have reached the node although no usable answer came
 * back. Anything the server actually answered (400, 401, 409, a 500 with a
 * body, ...) is a real failure. Non-axios errors (a token that could not be
 * fetched before the request left) are never a lost reply.
 *
 * A gateway status with the server's own envelope and an `errorCode` (for
 * example 503 MIDNIGHT_PROVER_BUSY) is an answer too: the server says what
 * happened, so there is nothing to look up. Only a body-less or HTML gateway
 * reply is a lost one.
 */
export function isLostReply(error: unknown): boolean {
  // Same test axios applies in `axios.isAxiosError`, without needing the module.
  if (typeof error !== 'object' || error === null || (error as { isAxiosError?: unknown }).isAxiosError !== true) {
    return false;
  }
  const { code, response } = error as AxiosLikeError;
  if (code && LOST_REPLY_CODES.has(code)) return true;
  if (!response) return true;
  if (typeof response.status !== 'number' || !LOST_REPLY_STATUSES.has(response.status)) return false;
  return !parseMidnightErrorEnvelope(response.status, response.data, response.headers)?.errorCode;
}

export interface SubmitRecoveryDeps {
  /** Indexer GraphQL passthrough (`MidnightApi.graphql`). */
  graphql: (query: string, variables: Record<string, unknown>) => Promise<unknown>;
  /** The wallet network (`Mainnet`, ...), named in the readable error. */
  network?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  intervalMs?: number;
  windowMs?: number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type IndexedOutcome = 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILURE';

/** The first regular transaction in the indexer reply that carries a result, if any. */
function findOutcome(data: unknown): { hash: string; status: IndexedOutcome } | undefined {
  const rows = (data as { transactions?: unknown } | null | undefined)?.transactions;
  if (!Array.isArray(rows)) return undefined;
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const { __typename, hash, transactionResult } = row as {
      __typename?: string;
      hash?: unknown;
      transactionResult?: { status?: unknown } | null;
    };
    if (__typename === 'SystemTransaction' || typeof hash !== 'string' || !transactionResult) continue;
    const status = transactionResult.status;
    if (status === 'SUCCESS' || status === 'PARTIAL_SUCCESS' || status === 'FAILURE') {
      return { hash: hash.replace(/^0x/i, '').toLowerCase(), status };
    }
  }
  return undefined;
}

/**
 * Poll the indexer for the transaction until it shows up or the window closes.
 * Resolves with a synthetic `InBlock` response when it landed, throws a plain
 * error when the network rejected it and `MidnightSubmitUnconfirmedError` when
 * it never appeared. A failed poll is not an answer, so it is ignored.
 */
export async function awaitSubmittedTx(
  identifier: string,
  deps: SubmitRecoveryDeps,
): Promise<SubmitMidnightTxResponse> {
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  const interval = deps.intervalMs ?? SUBMIT_POLL_INTERVAL_MS;
  const deadline = now() + (deps.windowMs ?? SUBMIT_POLL_WINDOW_MS);

  for (;;) {
    let outcome: ReturnType<typeof findOutcome>;
    try {
      outcome = findOutcome(await deps.graphql(SUBMITTED_TX_QUERY, { id: identifier }));
    } catch {
      outcome = undefined;
    }
    if (outcome?.status === 'FAILURE') throw new Error('The Midnight network rejected this transaction.');
    if (outcome) return { txHash: outcome.hash, ledgerTxHash: outcome.hash, status: 'InBlock' };
    const remaining = deadline - now();
    if (remaining <= 0) throw new MidnightSubmitUnconfirmedError();
    await sleep(Math.min(interval, remaining));
  }
}

/**
 * Called from a submit method's `catch`. A real failure is rethrown as a
 * readable {@link import('./midnightApiError').MidnightApiError}; a lost reply
 * becomes a lookup of the transaction.
 */
export async function recoverLostSubmit(
  error: unknown,
  watch: MidnightSubmitWatch | undefined,
  deps: SubmitRecoveryDeps,
): Promise<SubmitMidnightTxResponse> {
  // Only submits come here: an answer with no usable body may still have reached the network.
  if (!isLostReply(error)) throw toMidnightApiError(error, deps.network, 'submit');
  const identifier = watch?.identifiers?.[0];
  if (!identifier) throw new MidnightSubmitUnconfirmedError();
  return awaitSubmittedTx(identifier, deps);
}
