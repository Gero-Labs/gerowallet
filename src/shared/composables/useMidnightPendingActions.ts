/**
 * The actions on a pending Midnight send that never confirmed
 * (midnightPendingSends.ts): Check again, Dismiss and Send again. Check again
 * and Dismiss run in the background, which owns the history.
 */
import { computed, getCurrentScope, onScopeDispose, reactive, ref, type ComputedRef, type Ref } from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import type { MidnightTransaction } from '@/chains/midnight/midnightTypes';
import { notIncludedAfterReset, type PendingTxCheck } from '@/chains/midnight/midnightPendingSends';
import { midnightStore } from '@/stores/midnightStore';
import { useTranslation } from '@/shared/composables/useTranslation';
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
    if (rowState[key]?.checking) return 'waiting';
    rowState[key] = { checking: true, outcome: null };
    // No answer from the background is no answer from the indexer either.
    let outcome: PendingTxCheck = 'unknown';
    try {
      const reply = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.CHECK_MIDNIGHT_PENDING_TX,
        data: { hash: tx.hash, token: tx.token },
      }) as BgReply;
      outcome = reply?.data?.success ? reply.data.result?.outcome ?? 'unknown' : 'unknown';
    } catch {
      outcome = 'unknown';
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

/**
 * The sends kept through a reset that the lookup didn't find, newest first, and
 * the sentence that lists them: singular or plural, and "network upgrade" (with
 * "No funds moved", which the lookup supports there) only when the server gave
 * that as the reset's cause. The card shows it; the notice slot says it when
 * the card appears (MidnightNoticeSlot.vue). Empty when there are none.
 */
export function useNotIncludedSends(): { sends: ComputedRef<MidnightTransaction[]>; sentence: ComputedRef<string> } {
  const { tc } = useTranslation();
  const sends = computed(() => notIncludedAfterReset(midnightStore.transactions ?? [])
    .sort((a, b) => b.timestamp - a.timestamp));
  const sentence = computed(() => {
    const n = sends.value.length;
    if (!n) return '';
    return sends.value.every((tx) => tx.beforeReset?.upgrade)
      ? tc('midnight.pending.notIncludedUpgrade', n)
      : tc('midnight.pending.notIncluded', n);
  });
  return { sends, sentence };
}
