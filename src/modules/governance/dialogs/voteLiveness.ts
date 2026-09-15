import governanceApi from '@/api/governance-api';
import { isOpen } from '@/shared/utils/govLifecycle';
import type { GovProposal } from '@/api/governance.types';

/**
 * Pre-sign liveness check for (batch) voting.
 *
 * A multi-vote transaction is ALL-OR-NOTHING: if any selected action expired
 * or was ratified between selection and submission, the whole transaction
 * fails and every vote in it is lost. So immediately before building, every
 * selected action is re-fetched and any that is no longer `active` is dropped
 * — with a reason the dialog can show the user — and only then is the
 * transaction built from the survivors.
 */

export interface DroppedAction {
  action: GovProposal;
  /**
   * i18n key for why this action was dropped:
   *  - `governance.actionDroppedNotOpen` — still on chain, but its status is
   *    no longer active ({@link DroppedAction.status} carries the new one).
   *  - `governance.actionDroppedGone` — the re-fetch 404'd.
   */
  reasonKey: 'governance.actionDroppedNotOpen' | 'governance.actionDroppedGone';
  /** The status the re-fetch reported, present for `actionDroppedNotOpen`. */
  status?: string;
}

export interface LivenessResult {
  /** The selected actions confirmed still open — the only ones to build votes for. */
  open: GovProposal[];
  dropped: DroppedAction[];
}

/**
 * Re-fetch each selected action and split the selection into still-open and
 * dropped.
 *
 * REJECTS when any re-fetch fails outright (network/server error, not a 404):
 * an action whose liveness cannot be verified must not ride into an
 * all-or-nothing transaction, and silently treating "unknown" as "open" would
 * put the whole batch at risk.
 */
export async function checkActionsStillOpen(
  actions: GovProposal[],
  network: string,
): Promise<LivenessResult> {
  const fresh = await Promise.all(
    actions.map(action => governanceApi.getProposal(`${action.txHash}#${action.index}`, network)),
  );

  const open: GovProposal[] = [];
  const dropped: DroppedAction[] = [];

  actions.forEach((action, i) => {
    const latest = fresh[i];
    if (!latest) {
      dropped.push({ action, reasonKey: 'governance.actionDroppedGone' });
      return;
    }
    if (!isOpen(latest.status)) {
      dropped.push({ action, reasonKey: 'governance.actionDroppedNotOpen', status: String(latest.status) });
      return;
    }
    open.push(action);
  });

  return { open, dropped };
}
