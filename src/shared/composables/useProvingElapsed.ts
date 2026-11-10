/**
 * Elapsed time for the proving step of a Midnight send, for the send timeline
 * (dashboard dialog and side panel sheet).
 *
 * Proving has no progress signal, so the bars stay indeterminate; what the
 * user gets is a running counter ("6 s") on the node that is proving and, where
 * it helps, a hint about how long that kind of proving takes:
 * - Gero Cloud (proving inside the submit request): after 20 s, "Taking longer
 *   than usual. Keep this window open." It stays until the step ends.
 * - This device: "This can take up to a minute on this device."
 * - A local proof server or Arkhia: the counter only.
 * The counter starts when the step starts and stops when it ends, error included.
 */
import { computed, getCurrentScope, onScopeDispose, ref, watch, type ComputedRef } from 'vue';

/** Which timeline node is proving, and with what. */
export type ProvingStep =
  | { node: 'sync'; prover: 'device' | 'local' | 'zkpaas' }
  | { node: 'sign'; prover: 'device' }
  | { node: 'submit'; prover: 'cloud' };

/** After this long, Gero Cloud proving gets the "taking longer" hint. */
export const CLOUD_SLOW_AFTER_S = 20;

/**
 * The proving step for a send stage. `feeProving` is the DUST-fee proof a
 * public send makes on this device inside the `working` stage.
 */
export function provingStepOf(stage: string, feeProving: boolean): ProvingStep | null {
  switch (stage) {
    case 'provingDevice': return { node: 'sync', prover: 'device' };
    case 'provingLocal': return { node: 'sync', prover: 'local' };
    case 'provingZkpaas': return { node: 'sync', prover: 'zkpaas' };
    case 'provingCloud': return { node: 'submit', prover: 'cloud' };
    case 'working': return feeProving ? { node: 'sign', prover: 'device' } : null;
    default: return null;
  }
}

/** The detail line under a proving node: the counter, then the hint that applies. */
export function provingDetail(
  step: ProvingStep,
  seconds: number,
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  const elapsed = t('midnight.send.provingElapsed', { n: seconds });
  if (step.prover === 'device') return `${elapsed} · ${t('midnight.send.provingDeviceHint')}`;
  if (step.prover === 'cloud' && seconds >= CLOUD_SLOW_AFTER_S) return `${elapsed} · ${t('midnight.send.provingSlowHint')}`;
  return elapsed;
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
