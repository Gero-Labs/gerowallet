/**
 * Pending Midnight sends: rows the wallet inserted after a successful submit
 * (`status: 'pending'`) that the network has not confirmed yet.
 *
 * - Kept through a chain reset: the reset wipes history, so the pending rows
 *   are collected first and put back, marked `beforeReset`. A row that comes
 *   back confirmed in the rebuilt history replaces its pending copy (same hash
 *   and token), so it shows once, as confirmed.
 * - Not included: once the rebuild has ended ("Refreshing", midnightRefresh.ts),
 *   the background looks each kept row up on the indexer. Only an answer that
 *   lists no such transaction, from an indexer whose latest block is past the
 *   send's time to live, lists it as "didn't go through" (`beforeReset.notFound`).
 *   A failed lookup, a transaction found without its result yet, or an indexer
 *   not that far yet is no answer: the row stays, and is looked up again later.
 *   A timer never decides that.
 * - Not confirmed: a row kept through a reset, or any pending row older than
 *   {@link PENDING_EXPIRY_MS}, reads "Not confirmed", with Check again (the same
 *   lookup) and Dismiss. Derived when shown; nothing ticks in the worker.
 *
 * Hashes: the submit routes return the extrinsic hash as `txHash` and, best
 * effort, the ledger hash as `ledgerTxHash`. Only the ledger hash is known to
 * the indexer and the history feed, so only a row keyed by it (`ledgerHash`)
 * can be looked up, confirmed by the feed, or listed as not included. A row
 * without one stays "Not confirmed" with Dismiss.
 */
import type { MidnightTransaction } from './midnightTypes';
import { PENDING_TX_QUERY } from '@/api/midnightSubmitRecovery';
import { blockTimeToMs } from './midnightDataFreshness';
import { normalizeMidnightTxHash } from './midnightTxHash';

/** A pending row older than this, with no confirmed match, reads "Not confirmed". */
export const PENDING_EXPIRY_MS = 30 * 60_000;

/** True for a pending row that reads "Not confirmed": kept through a reset, or past the time limit. */
export function isUnconfirmedPending(tx: MidnightTransaction, now: number): boolean {
  if (tx.status !== 'pending') return false;
  if (tx.beforeReset) return true;
  return tx.timestamp > 0 && now - tx.timestamp >= PENDING_EXPIRY_MS;
}

/** Whether the indexer can be asked about this row: a pending row keyed by its ledger hash. */
export function canLookUpPending(tx: MidnightTransaction): boolean {
  return tx.status === 'pending' && tx.ledgerHash === true;
}

/**
 * The pending rows to put back after a chain reset at `at`, marked as sent before
 * it. A row already kept through an earlier reset keeps its first mark.
 */
export function pendingRowsToKeep(transactions: readonly MidnightTransaction[], at: number, upgrade: boolean): MidnightTransaction[] {
  return transactions
    .filter((tx) => tx.status === 'pending')
    .map((tx) => (tx.beforeReset ? { ...tx } : { ...tx, beforeReset: { at, upgrade } }));
}

/** Kept rows the background should look up once the rebuild has ended. */
export function keptRowsToCheck(transactions: readonly MidnightTransaction[]): MidnightTransaction[] {
  return transactions.filter((tx) => !!tx.beforeReset && !tx.beforeReset.notFound && canLookUpPending(tx));
}

/** Kept rows the lookup didn't find after the rebuild: sent before the reset and never included. */
export function notIncludedAfterReset(transactions: readonly MidnightTransaction[]): MidnightTransaction[] {
  return transactions.filter((tx) => canLookUpPending(tx) && tx.beforeReset?.notFound === true);
}

/**
 * The time to live a send is built with: unshielded sends 5 minutes
 * (MidnightSendDialog, MidnightSendSheet), shielded ones 30 minutes (the
 * background's shielded build). Past it, the network can no longer include it.
 */
export const SEND_TTL_MS = { unshielded: 5 * 60_000, shielded: 30 * 60_000 } as const;

/** Slack on top of the time to live, for clock skew between this device and the chain. */
export const LOOKUP_MARGIN_MS = 2 * 60_000;

/**
 * The chain time after which "not found" means not included: the row's time
 * (recorded after the submit, so later than the build that set the time to
 * live) plus the time to live and a margin.
 */
export function pendingLookupDeadline(tx: Pick<MidnightTransaction, 'timestamp' | 'isShielded'>): number {
  return Math.max(0, tx.timestamp) + (tx.isShielded ? SEND_TTL_MS.shielded : SEND_TTL_MS.unshielded) + LOOKUP_MARGIN_MS;
}

/** Lookups with no verdict retried in one session, before the next session start or rebuild end tries again. */
export const LOOKUP_MAX_RETRIES = 6;
const LOOKUP_RETRY_MIN_MS = 30_000;
const LOOKUP_RETRY_MAX_MS = 10 * 60_000;

/**
 * When to look kept rows up again after a lookup that gave no verdict, or null
 * to stop for this session: a backoff from 30 s, and when it was only too
 * early, not before 30 s past the earliest row's deadline (the indexer's
 * latest block trails this clock). At most 10 minutes.
 */
export function keptRowsRetryDelay(
  rows: ReadonlyArray<Pick<MidnightTransaction, 'timestamp' | 'isShielded'>>,
  attempts: number,
  lookupFailed: boolean,
  now: number,
): number | null {
  if (attempts >= LOOKUP_MAX_RETRIES || !rows.length) return null;
  const backoff = LOOKUP_RETRY_MIN_MS * 2 ** attempts;
  const untilDeadline = lookupFailed ? 0 : Math.min(...rows.map(pendingLookupDeadline)) - now + LOOKUP_RETRY_MIN_MS;
  return Math.min(LOOKUP_RETRY_MAX_MS, Math.max(backoff, untilDeadline));
}

/**
 * What a lookup of a pending row found:
 * - `confirmed` / `failed`: the transaction is on chain, with its result;
 * - `notFound`: the indexer answered, lists no such transaction, and its latest
 *   block is past the row's time to live: it was never included;
 * - `waiting`: no verdict yet: found without its result, or not found by an
 *   indexer that hasn't reached the time to live;
 * - `unknown`: the lookup failed (network, server or an answer it can't read).
 */
export type PendingTxCheck = 'confirmed' | 'failed' | 'notFound' | 'waiting' | 'unknown';

type LookupRow = { __typename?: unknown; hash?: unknown; transactionResult?: { status?: unknown } | null };

/** Read the indexer's answer for `tx` (the PENDING_TX_QUERY reply). */
export function readPendingLookup(data: unknown, tx: Pick<MidnightTransaction, 'hash' | 'timestamp' | 'isShielded'>): PendingTxCheck {
  const reply = data as { transactions?: unknown; block?: { timestamp?: unknown } | null } | null | undefined;
  if (!reply || !Array.isArray(reply.transactions)) return 'unknown';
  const want = normalizeMidnightTxHash(tx.hash);
  const match = (reply.transactions as unknown[]).find((row): row is LookupRow => typeof row === 'object' && row !== null
    && typeof (row as LookupRow).hash === 'string' && normalizeMidnightTxHash((row as LookupRow).hash as string) === want);
  if (match) {
    const status = match.transactionResult?.status;
    if (status === 'FAILURE') return 'failed';
    if (status === 'SUCCESS' || status === 'PARTIAL_SUCCESS') return 'confirmed';
    // On chain, its result not indexed yet: the history feed settles it.
    return 'waiting';
  }
  const tipTime = blockTimeToMs(reply.block?.timestamp);
  return tipTime > pendingLookupDeadline(tx) ? 'notFound' : 'waiting';
}

/**
 * Ask the indexer for a pending row's transaction by its ledger hash. A failed
 * lookup is no answer: `unknown`, never `notFound`.
 */
export async function checkPendingTx(
  graphql: (query: string, variables: Record<string, unknown>) => Promise<unknown>,
  tx: Pick<MidnightTransaction, 'hash' | 'timestamp' | 'isShielded'>,
): Promise<PendingTxCheck> {
  let data: unknown;
  try {
    data = await graphql(PENDING_TX_QUERY, { hash: tx.hash.replace(/^0x/i, '').toLowerCase() });
  } catch {
    return 'unknown';
  }
  return readPendingLookup(data, tx);
}
