import type { SweepProgress, SweepStop } from '@/shared/composables/useTransactionSigning';

/**
 * What the progress panel shows for a sweep, derived from the signer's hooks alone:
 * `onProgress` while it signs and sends, `onInterrupted` once it stopped. Pure, so the
 * mapping is testable without a DOM; the component only renders it.
 */

export type SweepMarkState = 'done' | 'active' | 'pending' | 'error';

/** An i18n key with its parameters, resolved by the component's `t()`, or `tc()` when `choice` picks a plural form. */
export interface SweepText {
  key: string;
  params?: Record<string, number | string>;
  choice?: number;
}

export interface SweepChecklistRow {
  id: 'sign' | 'merges' | 'payment';
  state: SweepMarkState;
  label: SweepText;
  detail: SweepText;
}

export interface SweepStopView {
  title: SweepText;
  body: SweepText;
  /** The friendly reason the signer reported, shown behind a disclosure. */
  reason: string;
  tryAgain: SweepText;
}

export interface SweepProgressView {
  total: number;
  /** Transactions before the payment. */
  merges: number;
  /** Null once the sweep stopped: the stop banner carries the headline then. */
  title: SweepText | null;
  count: SweepText | null;
  /** One entry per transaction, in submission order. */
  segments: SweepMarkState[];
  rows: SweepChecklistRow[];
  caption: SweepText | null;
  stop: SweepStopView | null;
}

const text = (key: string, params?: Record<string, number | string>): SweepText => (params ? { key, params } : { key });
const plural = (key: string, choice: number, params: Record<string, number | string>): SweepText => ({ key, params, choice });

function runningView(progress: SweepProgress): SweepProgressView {
  const { phase, step, total } = progress;
  const merges = total - 1;
  const signing = phase === 'signing';
  const sending = phase === 'sending';
  const waiting = phase === 'waiting';
  const sent = signing ? 0 : sending ? step - 1 : merges;

  const segments: SweepMarkState[] = Array.from({ length: total }, (_, index) => {
    if (signing) return 'pending';
    if (waiting) return index < merges ? 'done' : 'active';
    if (index < step - 1) return 'done';
    return index === step - 1 ? 'active' : 'pending';
  });

  const mergesRow: SweepChecklistRow = signing
    ? { id: 'merges', state: 'pending', label: text('send.sweepMergesStepLive'), detail: text('send.sweepNotSentYet') }
    : sending && step <= merges
      ? { id: 'merges', state: 'active', label: text('send.sweepMergesStepLive'), detail: text('send.sweepMergesSentCount', { sent: step - 1, merges }) }
      : { id: 'merges', state: 'done', label: text('send.sweepMergesStepLive'), detail: text('send.sweepMergesSentCount', { sent: merges, merges }) };

  const paymentRow: SweepChecklistRow = signing
    ? { id: 'payment', state: 'pending', label: text('send.sweepPaymentLabel'), detail: text('send.sweepNotSentYet') }
    : waiting
      ? { id: 'payment', state: 'active', label: text('send.sweepPaymentLabel'), detail: text('send.sweepPaymentWaiting') }
      : step <= merges
        ? { id: 'payment', state: 'pending', label: text('send.sweepPaymentLabel'), detail: text('send.sweepPaymentAfterMerges') }
        : { id: 'payment', state: 'active', label: text('send.sweepPaymentLabel'), detail: text('send.sweepPaymentGoingOut') };

  return {
    total,
    merges,
    title: signing ? text('send.sweepSigning', { step, total })
      : sending ? text('send.sweepSending', { step, total })
        : text('send.sweepWaiting'),
    count: signing ? text('send.sweepNothingSent') : text('send.sweepSentCount', { sent, total }),
    segments,
    rows: [
      signing
        ? { id: 'sign', state: 'active', label: text('send.sweepSignStep'), detail: text('send.sweepSignedCount', { signed: step - 1, total }) }
        : { id: 'sign', state: 'done', label: text('send.sweepSignStep'), detail: text('send.sweepSignedCount', { signed: total, total }) },
      mergesRow,
      paymentRow,
    ],
    caption: signing ? text('send.sweepSigningNote') : sending ? text('send.sweepKeepOpen') : text('send.sweepWaitingNote'),
    stop: null,
  };
}

function stoppedView(stop: SweepStop): SweepProgressView {
  const { step, total, mergesSent } = stop;
  const merges = total - 1;
  const stoppedAtMerge = step <= merges;
  return {
    total,
    merges,
    title: null,
    count: null,
    segments: Array.from({ length: total }, (_, index) => {
      if (index < mergesSent) return 'done';
      return index === step - 1 ? 'error' : 'pending';
    }),
    rows: [
      { id: 'sign', state: 'done', label: text('send.sweepSignStep'), detail: text('send.sweepSignedCount', { signed: total, total }) },
      stoppedAtMerge
        ? { id: 'merges', state: 'error', label: text('send.sweepMergesStepLive'), detail: text('send.sweepMergesStopped', { sent: mergesSent, merges }) }
        : { id: 'merges', state: 'done', label: text('send.sweepMergesStepLive'), detail: text('send.sweepMergesSentCount', { sent: merges, merges }) },
      { id: 'payment', state: stoppedAtMerge ? 'pending' : 'error', label: text('send.sweepPaymentLabel'), detail: text('send.sweepPaymentNotSent') },
    ],
    caption: null,
    stop: {
      title: text('send.sweepStoppedTitle', { step, total }),
      body: plural('send.sweepStoppedBody', merges, { sent: mergesSent, merges }),
      reason: stop.reason,
      tryAgain: text('send.sweepTryAgainNote', { step }),
    },
  };
}

/** A running sweep wins over a stop still on screen; nothing to show when neither is set. */
export function sweepProgressView(progress: SweepProgress | null, stop: SweepStop | null): SweepProgressView | null {
  if (progress) return runningView(progress);
  if (stop) return stoppedView(stop);
  return null;
}
