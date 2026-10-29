import { CIP113_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';

/**
 * Asks the worker whether `txCbor` may be signed, before a signer that runs in a document
 * (Ledger, Keystone, Trezor over WebUSB) puts it on the device. The refusal index
 * (refusalForProgrammableInputs) and Gero's own Send allowance live in the worker, which
 * the page cannot read, so it asks. Throws CIP113_SIGN_REFUSAL_MESSAGE on a refusal, and
 * `noAnswer` when the worker does not answer: without an answer, nothing is signed.
 */
export async function assertCip113SignAllowed(txCbor: string, noAnswer: string): Promise<void> {
  const preflight = (await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.CIP113_SIGN_PREFLIGHT,
    data: { txCbor },
  })) as { data?: { success?: boolean; refused?: boolean } };
  if (preflight?.data?.refused) throw new Error(CIP113_SIGN_REFUSAL_MESSAGE);
  if (preflight?.data?.success !== true) throw new Error(noAnswer);
}
