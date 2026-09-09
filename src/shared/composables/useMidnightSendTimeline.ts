/**
 * The five-node timeline of a Midnight send, shared by the options-page dialog
 * and the side-panel sheet.
 *
 * Lifted out of `MidnightSendDialog.vue`, which owned the only copy, so the
 * panel can show the same progress instead of collapsing the whole send into
 * one line of text. Both surfaces read the same stage rank and the same
 * `midnightStore.sendProgress`, so they can never disagree about where a send
 * has got to.
 */
import { computed, type ComputedRef } from 'vue';
import { midnightStore } from '@/stores/midnightStore';
import type { MidnightSendStage } from '@/services/midnight-tx.service';

export interface TimelineNode {
  key: string;
  label: string;
  state: 'pending' | 'active' | 'done';
  /** Node carries a progress bar (the DUST-ledger sync, or opaque proving). */
  showBar?: boolean;
  /**
   * 0-100 while a real percentage is known, `null` for an indeterminate bar,
   * `undefined` for no bar. Never a fabricated number.
   */
  percent?: number | null;
  detail?: string;
}

/** Ordering used to decide which nodes are already behind the current stage. */
export const STAGE_RANK: Record<string, number> = {
  idle: 0,
  authorizing: 1,
  building: 2,
  working: 3,
  provingLocal: 3,
  provingZkpaas: 3,
  submitting: 4,
  done: 5,
};

export interface SendTimelineLabels {
  authorize: string;
  build: string;
  sync: string;
  sign: string;
  submit: string;
  provingLocal: string;
  provingZkpaas: string;
}

/**
 * @param stage       the live send stage
 * @param labels      already-translated node labels (the caller owns i18n, so
 *                    the sync label can name the sponsor wallet)
 */
export function useMidnightSendTimeline(
  stage: ComputedRef<MidnightSendStage | 'idle'>,
  labels: ComputedRef<SendTimelineLabels>,
): ComputedRef<TimelineNode[]> {
  return computed<TimelineNode[]>(() => {
    const s = stage.value;
    const rank = STAGE_RANK[s] ?? 0;
    const prog = midnightStore.sendProgress;
    const pct = prog && prog.phase === 'syncingDust' ? prog.percent : null;
    // Within the single BG `working` stage: sync is active until the ledger
    // replay hits 100%, then signing takes over until the call resolves.
    const syncDone = pct != null && pct >= 100;
    const syncActive = s === 'working' && !syncDone;
    const signActive = s === 'working' && syncDone;
    // Wallet-side shielded sends are one opaque proving call with no percent
    // signal, so that node gets an indeterminate bar rather than a fake number.
    const provingActive = s === 'provingLocal' || s === 'provingZkpaas';
    const provingLabel = s === 'provingZkpaas' ? labels.value.provingZkpaas : labels.value.provingLocal;

    return [
      {
        key: 'authorize',
        label: labels.value.authorize,
        state: s === 'authorizing' ? 'active' : rank > 1 ? 'done' : 'pending',
      },
      {
        key: 'build',
        label: labels.value.build,
        state: s === 'building' ? 'active' : rank > 2 ? 'done' : 'pending',
      },
      {
        key: 'sync',
        label: provingActive ? provingLabel : labels.value.sync,
        state: rank > 3 || signActive ? 'done' : (syncActive || provingActive) ? 'active' : 'pending',
        showBar: true,
        percent: provingActive ? null : (syncActive ? pct : undefined),
        detail: syncActive ? prog?.detail : undefined,
      },
      {
        key: 'sign',
        label: labels.value.sign,
        state: rank > 3 ? 'done' : signActive ? 'active' : 'pending',
      },
      {
        key: 'submit',
        label: labels.value.submit,
        state: s === 'submitting' ? 'active' : s === 'done' ? 'done' : 'pending',
      },
    ];
  });
}
