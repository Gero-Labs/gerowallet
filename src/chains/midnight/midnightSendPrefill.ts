/**
 * "Send again" (midnightPendingSends.ts): hand a send that never went through
 * to the Send screen, filled in. The screen takes it when it opens and waits
 * for the user; nothing is sent from here.
 */
import { reactive } from 'vue';

export interface MidnightSendPrefill {
  recipient: string;
  /** Base units of `token`. */
  amount: bigint;
  /** `NIGHT` or a 64-hex token colour. */
  token: string;
  shielded: boolean;
}

const state = reactive({ prefill: null as MidnightSendPrefill | null });

/** Fill the next Send screen that opens with this send. */
export function requestMidnightSendAgain(prefill: MidnightSendPrefill): void {
  state.prefill = { ...prefill };
}

/** The send to fill in, once: a Send screen calls this when it opens. */
export function takeMidnightSendPrefill(): MidnightSendPrefill | null {
  const prefill = state.prefill;
  state.prefill = null;
  return prefill;
}
