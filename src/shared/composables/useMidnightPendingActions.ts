/**
 * The actions on a pending Midnight send that never confirmed
 * (midnightPendingSends.ts): Check again, Dismiss and Send again. Check again
 * and Dismiss run in the background, which owns the history.
 */
import { getCurrentScope, onScopeDispose, reactive, ref, type Ref } from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import type { MidnightTransaction } from '@/chains/midnight/midnightTypes';
import type { PendingTxCheck } from '@/chains/midnight/midnightPendingSends';
import { requestMidnightSendAgain } from '@/chains/midnight/midnightSendPrefill';
import { midnightTxRowKey } from '@/chains/midnight/midnightTxHash';

type BgReply = { data?: { success?: boolean; result?: { outcome?: PendingTxCheck } } };

/**
 * One clock for every pending row on screen ("Not confirmed" is derived from a
 * row's age): a single 30 s interval while any row uses it, none otherwise.
 */
const sharedNow = ref(Date.now());
let clockUsers = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;

export function usePendingClock(): Ref<number> {
  clockUsers += 1;
  sharedNow.value = Date.now();
  if (!clockTimer) clockTimer = setInterval(() => { sharedNow.value = Date.now(); }, 30_000);
  if (getCurrentScope()) {
    onScopeDispose(() => {
      clockUsers = Math.max(0, clockUsers - 1);
      if (clockUsers === 0 && clockTimer) {
        clearInterval(clockTimer);
        clockTimer = null;
      }
    });
  }
  return sharedNow;
}

/** Whether a row has something to say about its last Check again (shown even once it is no longer pending). */
export function hasPendingOutcome(tx: MidnightTransaction): boolean {
  return !!rowState[midnightTxRowKey(tx)]?.outcome;
}

/** Per row: a Check again in flight, and what the last one found. */
const rowState = reactive<Record<string, { checking: boolean; outcome: PendingTxCheck | null }>>({});

export function useMidnightPendingActions() {
  const stateOf = (tx: MidnightTransaction) => rowState[midnightTxRowKey(tx)] ?? { checking: false, outcome: null };

  async function checkAgain(tx: MidnightTransaction): Promise<PendingTxCheck> {
    const key = midnightTxRowKey(tx);
    if (rowState[key]?.checking) return 'notFound';
    rowState[key] = { checking: true, outcome: null };
    let outcome: PendingTxCheck = 'notFound';
    try {
      const reply = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.CHECK_MIDNIGHT_PENDING_TX,
        data: { hash: tx.hash, token: tx.token },
      }) as BgReply;
      outcome = reply?.data?.success ? reply.data.result?.outcome ?? 'notFound' : 'notFound';
    } catch {
      outcome = 'notFound';
    }
    rowState[key] = { checking: false, outcome };
    return outcome;
  }

  async function dismiss(tx: MidnightTransaction): Promise<void> {
    try {
      await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.DISMISS_MIDNIGHT_PENDING_TX,
        data: { hash: tx.hash, token: tx.token },
      });
    } catch { /* the row stays; the user can dismiss it again */ }
    delete rowState[midnightTxRowKey(tx)];
  }

  /** Fill Send with this row's recipient, amount and token; `open` shows the Send screen. */
  function sendAgain(tx: MidnightTransaction, open: () => void): void {
    requestMidnightSendAgain({ recipient: tx.counterparty, amount: tx.amount, token: tx.token, shielded: tx.isShielded });
    open();
  }

  return { stateOf, checkAgain, dismiss, sendAgain };
}
