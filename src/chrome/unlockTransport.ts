import { Messaging } from './messaging';
import { MessageTypes } from '@/models/MessageTypes';

type UnlockRequest = {
  method: MessageTypes.UNLOCK | MessageTypes.VERIFY_PRE_LOGIN_UNLOCK;
  data: { walletId?: number; [key: string]: unknown };
};

// A cold worker answers only after its whole module has evaluated, which can take
// seconds on a loaded machine: ten probes of 2.5 s allow about 27 s before giving up.
const PROBE_TIMEOUT_MS = 2_500;
// The worker waits at most 15 s for startup before verifying credentials, so a
// reply this late is lost; report it instead of leaving the unlock UI spinning.
const UNLOCK_TIMEOUT_MS = 45_000;

/** Resolve to `fallback` if `promise` has not settled within `ms`. */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), ms); })])
    .finally(() => clearTimeout(timer));
}

/** Wake a restarting worker before sending credentials. Only the read-only probe
 * is retried: an unlock with a lost response must never be replayed. */
export async function sendUnlockAfterWake(request: UnlockRequest, stillCurrent: () => boolean): Promise<unknown> {
  const unavailable = { error: 'unlock-transport-unavailable' };
  if (!Number.isSafeInteger(request.data.walletId)) return unavailable;
  for (let attempt = 0; attempt < 10; attempt++) {
    if (!stillCurrent()) return unavailable;
    const probe = Messaging.sendToBackgroundFromOptions({ method: MessageTypes.BACKGROUND_READY, data: {} });
    const reply = await within(probe, PROBE_TIMEOUT_MS, undefined) as { data?: { ready?: boolean } } | undefined;
    if (reply?.data?.ready === true) {
      if (!stillCurrent()) return unavailable;
      return within(Messaging.sendToBackgroundFromOptions(request), UNLOCK_TIMEOUT_MS, { error: 'unlock-transport-timeout' });
    }
    if (attempt < 9) await new Promise(resolve => setTimeout(resolve, 200));
  }
  return unavailable;
}
