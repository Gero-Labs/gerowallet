import { midnightTxRowKey } from '@/chains/midnight/midnightTxHash';

/**
 * The store's current object for a selected Midnight history row.
 *
 * Rows are replaced, not mutated: `midnightActions.applyTransaction` splices
 * a new object in under the same hash+token when gero-sync delivers the
 * confirmed entry for an optimistic pending row, and every store broadcast
 * rebuilds the array. A detail pane holding the object that was clicked would
 * keep rendering the dead pending row after the list had moved on, so the
 * pane re-resolves its selection through this on every list change.
 *
 * Returns the very same object when nothing changed (so callers can skip a
 * re-render), the replacement when the row was swapped, and `null` when the
 * row is gone (sync-cache reset, wallet switch) — a pane should then show
 * nothing rather than something that no longer exists.
 */
export function liveMidnightRow<T extends { hash: string; token: string }>(
  selected: T,
  transactions: readonly T[],
): T | null {
  const key = midnightTxRowKey(selected);
  return transactions.find((tx) => midnightTxRowKey(tx) === key) ?? null;
}
