/**
 * When to throw away a saved DUST sync checkpoint.
 *
 * THE BUG THIS EXISTS FOR. The dust sync writes a checkpoint of its progress so
 * the next send resumes instead of replaying the whole ledger. But a checkpoint
 * written before the wallet's DUST registration reached Midnight contains no
 * dust account at all. Resuming from it produces a wallet that looks perfectly
 * healthy — fully synced, no errors — and simply has nothing to spend. Worse,
 * the sync path re-saves that same empty state on every attempt, so the wallet
 * can never recover on its own.
 *
 * Seen on mainnet: a wallet with a funded, fully charged DUST battery failed
 * four sends in a row from a resumed checkpoint, then succeeded immediately
 * once no checkpoint existed and the ledger was bootstrapped fresh.
 *
 * So: on a fee failure that means "no DUST", discard the checkpoint if that is
 * where this attempt started. The next send bootstraps and works.
 *
 * Split out of the send path purely so it can be tested — reproducing the real
 * condition needs a registration that relays partway through a session.
 */

/**
 * Whether a fee-balancing failure means "no spendable DUST" rather than
 * something else (a timeout, a WASM fault, a malformed transaction).
 *
 * The SDK reports this as an Insufficient Funds error rather than a typed one,
 * and our own timeout copy says the same thing in prose, so both shapes are
 * matched. Matching too broadly is cheap here: the only consequence is
 * discarding a checkpoint that the next send rebuilds.
 */
export function isInsufficientDust(error: unknown): boolean {
  const text = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  return text.includes('insufficient')
    || text.includes('could not balance dust')
    || text.includes('no spendable dust');
}

/**
 * Whether to discard the saved checkpoint after a fee failure.
 *
 * Only when the attempt actually resumed from a LOCAL checkpoint. A cold start
 * or a bootstrap snapshot has no stale local state to blame, and discarding
 * would just force a needless full replay on the next send.
 */
export function shouldDiscardCheckpoint(
  error: unknown,
  restoredFromLocalCheckpoint: boolean,
): boolean {
  return restoredFromLocalCheckpoint && isInsufficientDust(error);
}
