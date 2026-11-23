/**
 * Elapsed time for the proving step of a Midnight send, for the send timeline
 * (dashboard dialog and side panel sheet).
 *
 * Proving has no progress signal, so the bars stay indeterminate; what the
 * user gets is a running counter ("6 s", beside the node's label) on the node
 * that is proving and, where it helps, a hint on its own line about how long
 * that kind of proving takes:
 * - Gero Cloud (proving inside the submit request): after 20 s, "Taking longer
 *   than usual." It stays until the step ends. Where the surface does not
 *   already say to keep it open, the hint says so too.
 * - This device: "This can take up to a minute on this device.", or the
 *   number of processor threads when the multi-threaded prover is in use.
 * - Gero Prover (the desktop helper): which processor is proving, when known
 *   ("Graphics processor · Apple M3 Pro").
 * - A local proof server or Arkhia: the counter only.
 * The counter starts when the step starts and stops when it ends, error included.
 */
import { computed, getCurrentScope, onScopeDispose, ref, watch, type ComputedRef } from 'vue';

/** Which timeline node is proving, and with what. */
export type ProvingStep =
  | { node: 'sign'; prover: 'device' | 'helper' | 'local' | 'zkpaas' }
  | { node: 'submit'; prover: 'cloud' };

/** After this long, Gero Cloud proving gets the "taking longer" hint. */
export const CLOUD_SLOW_AFTER_S = 20;

/**
 * The proving step for a send stage. A wallet-side proof comes after the DUST
 * sync and signing, so it is on the sign node. `feeProving` is the background's
 * own report that it is proving while the send is still `working`, read as
 * this device.
 */
export function provingStepOf(stage: string, feeProving: boolean): ProvingStep | null {
  switch (stage) {
    case 'provingDevice': return { node: 'sign', prover: 'device' };
    case 'provingHelper': return { node: 'sign', prover: 'helper' };
    case 'provingLocal': return { node: 'sign', prover: 'local' };
    case 'provingZkpaas': return { node: 'sign', prover: 'zkpaas' };
    case 'provingCloud': return { node: 'submit', prover: 'cloud' };
    case 'working': return feeProving ? { node: 'sign', prover: 'device' } : null;
    default: return null;
  }
}

/** What a proving node shows: the counter (beside the label) and, when one applies, a hint (its own line). */
export interface ProvingDetail {
  elapsed: string;
  hint?: string;
}

export function provingDetail(
  step: ProvingStep,
  seconds: number,
  t: (key: string, params?: Record<string, unknown>) => string,
  /** The surface already tells the user to keep it open, so the slow hint need not. */
  options: {
    keepOpenShown?: boolean;
    /** Gero Prover: the processor it is proving on, already translated. */
    helperProcessor?: string;
    /** The browser prover on several threads ("8 processor threads"), already translated. */
    deviceThreads?: string;
  } = {},
): ProvingDetail {
  const elapsed = t('midnight.send.provingElapsed', { n: seconds });
  // On several threads the minute-long warning no longer holds: say what it is using.
  if (step.prover === 'device') return { elapsed, hint: options.deviceThreads ?? t('midnight.send.provingDeviceHint') };
  if (step.prover === 'helper') return options.helperProcessor ? { elapsed, hint: options.helperProcessor } : { elapsed };
  if (step.prover === 'cloud' && seconds >= CLOUD_SLOW_AFTER_S) {
    return { elapsed, hint: t(options.keepOpenShown ? 'midnight.send.provingSlowHintShort' : 'midnight.send.provingSlowHint') };
  }
  return { elapsed };
}

export interface ProvingElapsed {
  /** The node that is proving now, or null. */
  readonly step: ComputedRef<ProvingStep | null>;
  /** Whole seconds since the current proving step started, or null when none is. */
  readonly seconds: ComputedRef<number | null>;
}

export function useProvingElapsed(stepSource: () => ProvingStep | null): ProvingElapsed {
  const step = computed(stepSource);
  const startedAt = ref<number | null>(null);
  const now = ref(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  watch(
    () => (step.value ? `${step.value.node}:${step.value.prover}` : null),
    (key) => {
      stop();
      if (!key) {
        startedAt.value = null;
        return;
      }
      startedAt.value = Date.now();
      now.value = startedAt.value;
      timer = setInterval(() => { now.value = Date.now(); }, 1_000);
    },
    { immediate: true },
  );
  if (getCurrentScope()) onScopeDispose(stop);

  return {
    step,
    seconds: computed(() => (startedAt.value == null ? null : Math.max(0, Math.floor((now.value - startedAt.value) / 1000)))),
  };
}
