/**
 * Pending Midnight sends: rows the wallet inserted after a successful submit
 * (`status: 'pending'`) that the network has not confirmed yet.
 *
 * - Kept through a chain reset: the reset wipes history, so the pending rows
 *   are collected first and put back, marked `beforeReset`. A row that comes
 *   back confirmed in the rebuilt history replaces its pending copy (same hash
 *   and token), so it shows once, as confirmed.
 * - Not included: once the rebuild has ended ("Refreshing", midnightRefresh.ts),
 *   the background looks each kept row up on the indexer; only a row the lookup
 *   doesn't find is listed as "didn't go through" (`beforeReset.notFound`). A
 *   timer never decides that.
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
import { findOutcome, PENDING_TX_QUERY } from '@/api/midnightSubmitRecovery';

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
  return transactions.filter((tx) => tx.status === 'pending' && tx.beforeReset?.notFound === true);
}

export type PendingTxCheck = 'confirmed' | 'failed' | 'notFound';

/**
 * "Check again": ask the indexer for the row's transaction by its ledger hash.
 * A failed lookup is not an answer, so it reads as not found.
 */
export async function checkPendingTx(
  graphql: (query: string, variables: Record<string, unknown>) => Promise<unknown>,
  hash: string,
): Promise<PendingTxCheck> {
  try {
    const outcome = findOutcome(await graphql(PENDING_TX_QUERY, { hash: hash.replace(/^0x/i, '').toLowerCase() }));
    if (!outcome) return 'notFound';
    return outcome.status === 'FAILURE' ? 'failed' : 'confirmed';
  } catch {
    return 'notFound';
  }
}
