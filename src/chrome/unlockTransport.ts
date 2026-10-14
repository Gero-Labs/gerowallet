import { Messaging } from './messaging';
import { MessageTypes } from '@/models/MessageTypes';

type UnlockRequest = {
  method: MessageTypes.UNLOCK | MessageTypes.VERIFY_PRE_LOGIN_UNLOCK;
  data: { walletId?: number; [key: string]: unknown };
};

/** Wake a restarting worker before sending credentials. Only the read-only probe
 * is retried: an unlock with a lost response must never be replayed. */
export async function sendUnlockAfterWake(request: UnlockRequest, stillCurrent: () => boolean): Promise<unknown> {
  const unavailable = { error: 'unlock-transport-unavailable' };
  if (!Number.isSafeInteger(request.data.walletId)) return unavailable;
  for (let attempt = 0; attempt < 10; attempt++) {
    if (!stillCurrent()) return unavailable;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reply = await Promise.race([
      Messaging.sendToBackgroundFromOptions({ method: MessageTypes.BACKGROUND_READY, data: {} }),
      new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 500); }),
    ]).finally(() => clearTimeout(timer)) as { data?: { ready?: boolean } } | undefined;
    if (reply?.data?.ready === true) {
      if (!stillCurrent()) return unavailable;
      return Messaging.sendToBackgroundFromOptions(request);
    }
    if (attempt < 9) await new Promise(resolve => setTimeout(resolve, 200));
  }
  return unavailable;
}
