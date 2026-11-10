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
import { provingStepOf, useProvingElapsed, type ProvingStep } from '@/shared/composables/useProvingElapsed';

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
  provingDevice: 3,
  provingLocal: 3,
  provingZkpaas: 3,
  submitting: 4,
  provingCloud: 4,
  done: 5,
};

export interface SendTimelineLabels {
  authorize: string;
  build: string;
  sync: string;
  sign: string;
  submit: string;
  provingDevice: string;
  provingLocal: string;
  provingZkpaas: string;
  /** The submit node while Gero Cloud proves inside the submit request. */
  provingCloud: string;
}

/**
 * @param stage       the live send stage
 * @param labels      already-translated node labels (the caller owns i18n, so
 *                    the sync label can name the sponsor wallet)
 * @param provingDetailFor the line under the proving node: elapsed time and hint
 *                    (useProvingElapsed.ts `provingDetail`, translated by the caller)
 */
export function useMidnightSendTimeline(
  stage: ComputedRef<MidnightSendStage | 'idle'>,
  labels: ComputedRef<SendTimelineLabels>,
  provingDetailFor?: (step: ProvingStep, seconds: number) => string,
): ComputedRef<TimelineNode[]> {
  const elapsed = useProvingElapsed(() => provingStepOf(
    stage.value, stage.value === 'working' && midnightStore.sendProgress?.phase === 'proving'));
  const elapsedDetail = (node: ProvingStep['node']): string | undefined => {
    const step = elapsed.step.value;
    const seconds = elapsed.seconds.value;
    return step?.node === node && seconds != null && provingDetailFor ? provingDetailFor(step, seconds) : undefined;
  };
  return computed<TimelineNode[]>(() => {
    const s = stage.value;
    const rank = STAGE_RANK[s] ?? 0;
    const prog = midnightStore.sendProgress;
    const pct = prog && prog.phase === 'syncingDust' ? prog.percent : null;
    // A public send proving its DUST fee on this device: after signing, inside
    // the same BG call. The sign node carries it, with an indeterminate bar.
    const feeProving = s === 'working' && prog?.phase === 'proving';
    // Within the single BG `working` stage: sync is active until the ledger
    // replay hits 100%, then signing takes over until the call resolves.
    const syncDone = feeProving || (pct != null && pct >= 100);
    const syncActive = s === 'working' && !syncDone;
    const signActive = s === 'working' && syncDone;
    // Wallet-side shielded sends are one opaque proving call with no percent
    // signal, so that node gets an indeterminate bar rather than a fake number.
    const provingActive = s === 'provingDevice' || s === 'provingLocal' || s === 'provingZkpaas';
    const provingLabel = s === 'provingZkpaas' ? labels.value.provingZkpaas
      : s === 'provingDevice' ? labels.value.provingDevice : labels.value.provingLocal;

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
        detail: syncActive ? prog?.detail : elapsedDetail('sync'),
      },
      {
        key: 'sign',
        label: feeProving ? labels.value.provingDevice : labels.value.sign,
        state: rank > 3 ? 'done' : signActive ? 'active' : 'pending',
        showBar: feeProving || undefined,
        percent: feeProving ? null : undefined,
        detail: elapsedDetail('sign'),
      },
      {
        key: 'submit',
        label: s === 'provingCloud' ? labels.value.provingCloud : labels.value.submit,
        state: s === 'submitting' || s === 'provingCloud' ? 'active' : s === 'done' ? 'done' : 'pending',
        // Gero Cloud proving has no progress signal: an indeterminate bar, never a percentage.
        showBar: s === 'provingCloud' || undefined,
        percent: s === 'provingCloud' ? null : undefined,
        detail: elapsedDetail('submit'),
      },
    ];
  });
}
