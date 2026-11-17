/**
 * A submit the server answered with 503 MIDNIGHT_PROVER_BUSY.
 *
 * That answer means nothing was proved or submitted, so the same signed
 * transaction can be sent again. The wallet counts down from `Retry-After`
 * and resubmits the same bytes automatically, at most twice; then the user
 * chooses Try again (the same bytes, no password) or Cancel. It stops when the
 * transaction's time-to-live is near.
 *
 * The signed bytes live only in the `submit` closure the caller passes: in
 * memory, for as long as this function runs. Success, Cancel and expiry all
 * return or throw, which drops them.
 */
import i18n from '@/plugins/i18n';
import { isMidnightApiError } from '@/api/midnightApiError';

/** Automatic resubmits before the user is asked. */
export const MAX_AUTO_RESUBMITS = 2;
/** Wait when the server sent no usable `Retry-After`. */
export const DEFAULT_BUSY_WAIT_S = 10;
/** A longer `Retry-After` is capped: the user can always choose to wait again. */
export const MAX_BUSY_WAIT_S = 60;
/** Stop resubmitting when the time-to-live is this close. */
export const TTL_MARGIN_MS = 30_000;

/** The transaction's time-to-live ran out while Gero Cloud was busy. Nothing was sent. */
export class MidnightTxExpiredError extends Error {
  constructor() {
    super(String(i18n.t('midnight.busy.expired')));
    this.name = 'MidnightTxExpiredError';
  }
}

/** The user chose Cancel while Gero Cloud was busy (or the send stopped being current). Nothing was sent. */
export class MidnightBusyCancelledError extends Error {
  constructor() {
    super('Cancelled while Gero Cloud was busy');
    this.name = 'MidnightBusyCancelledError';
  }
}

export interface MidnightBusyHandlers {
  /** Seconds left before the next automatic resubmit; null when the countdown ends. */
  onCountdown?: (secondsLeft: number | null) => void;
  /** After the automatic resubmits: resolve 'retry' to resubmit the same bytes, 'cancel' to stop. */
  onStillBusy?: () => Promise<'retry' | 'cancel'>;
  /** Aborted when the send stops (Cancel, the view closing): ends a countdown at once and clears its timer. */
  signal?: AbortSignal;
}

export interface BusyRetryOptions extends MidnightBusyHandlers {
  /** The transaction's time-to-live, epoch ms, when known. */
  ttlMs?: number;
  /** False once the send is no longer the one on screen: stop quietly. */
  isCurrent?: () => boolean;
  /** A countdown starts: the send is waiting for Gero Cloud, not proving. */
  onWait?: () => void;
  /** The same bytes go out again (after a countdown or Try again). */
  onAttempt?: () => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

/** Resolves after `ms`, or at once when `signal` aborts; either way no timer is left behind. */
function realSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

function busyWaitSeconds(error: unknown): number {
  const retryAfter = isMidnightApiError(error) ? error.retryAfter : undefined;
  if (typeof retryAfter !== 'number' || !Number.isFinite(retryAfter) || retryAfter <= 0) return DEFAULT_BUSY_WAIT_S;
  return Math.min(MAX_BUSY_WAIT_S, Math.ceil(retryAfter));
}

const isProverBusy = (error: unknown): boolean => isMidnightApiError(error) && error.kind === 'proverBusy';

export async function submitWithBusyRetry<R>(submit: () => Promise<R>, options: BusyRetryOptions = {}): Promise<R> {
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? Date.now;
  const current = () => !options.signal?.aborted && (options.isCurrent ?? (() => true))();
  const expiredBy = (at: number) => typeof options.ttlMs === 'number' && at >= options.ttlMs - TTL_MARGIN_MS;
  let automatic = 0;

  for (;;) {
    try {
      return await submit();
    } catch (error) {
      if (!isProverBusy(error)) throw error;
      if (!current()) throw new MidnightBusyCancelledError();

      if (automatic < MAX_AUTO_RESUBMITS) {
        const wait = busyWaitSeconds(error);
        if (expiredBy(now() + wait * 1000)) throw new MidnightTxExpiredError();
        options.onWait?.();
        try {
          for (let left = wait; left > 0; left--) {
            options.onCountdown?.(left);
            await sleep(1000, options.signal);
            if (!current()) throw new MidnightBusyCancelledError();
          }
        } finally {
          options.onCountdown?.(null);
        }
        automatic++;
        options.onAttempt?.();
        continue;
      }

      // The automatic resubmits are used up: the user decides.
      if (!options.onStillBusy) throw error;
      options.onWait?.();
      const choice = await options.onStillBusy();
      if (choice !== 'retry' || !current()) throw new MidnightBusyCancelledError();
      if (expiredBy(now())) throw new MidnightTxExpiredError();
      // Try again: the same bytes now, and the automatic resubmits again after that.
      automatic = 0;
      options.onAttempt?.();
    }
  }
}

/** Matched by name: the dialogs reach the tx service through a dynamic import. */
export function isMidnightBusyCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'MidnightBusyCancelledError';
}
