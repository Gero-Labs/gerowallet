/**
 * Display order for one LOADED page of governance actions.
 *
 * Scope first, because it is the honest limit: the list endpoint is
 * server-paginated and returns rows in ITS order, so nothing here can reorder
 * the chain — only the page in hand. The view says so out loud
 * (`governance.actionsOrderNote`) rather than letting "soonest first" read as a
 * claim about every open action there is.
 */
import { isOpen } from '@/shared/utils/govLifecycle';
import type { GovProposal } from '@/api/governance.types';

/**
 * Compare two nullable numbers, parking null LAST in either direction.
 *
 * Null here means "upstream did not tell us", and an unknown expiry must not
 * sort as though it were imminent (0) or eternal (Infinity) — both would be a
 * claim the data does not support. Returns 0 for two nulls so the sort's
 * stability leaves them in the order they arrived.
 */
function compareNullable(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
}

/**
 * Live actions first, soonest to expire at the top; concluded actions after,
 * newest first.
 *
 * "Live" is `isOpen(status)` — the same predicate the row, the stat strip and
 * the vote CTA use, so a row can never be quiet in one place and open in
 * another. "Newest" for a concluded action is its SUBMISSION (there is no
 * decision epoch in the list DTO), tie-broken on slot where upstream carries
 * one, since many actions share a submission epoch.
 *
 * `sort` is stable per spec, so equal rows keep the server's order rather than
 * shuffling between renders. The input array is not mutated.
 */
export function orderActions(actions: GovProposal[]): GovProposal[] {
  return [...actions].sort((a, b) => {
    const aOpen = isOpen(a.status);
    const bOpen = isOpen(b.status);
    if (aOpen !== bOpen) return aOpen ? -1 : 1;

    if (aOpen) return compareNullable(a.expiresEpoch, b.expiresEpoch, 1);

    const byEpoch = compareNullable(a.submittedEpoch, b.submittedEpoch, -1);
    return byEpoch !== 0 ? byEpoch : compareNullable(a.slot, b.slot, -1);
  });
}
