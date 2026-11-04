import { CIP113_SIGN_REFUSAL_MESSAGE, MARKED_TO_FAIL_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';

/** The refusals the worker names (hardwareSignRefusal), each a fixed message friendlyTxError() localises. */
const KNOWN_REFUSALS: ReadonlySet<string> = new Set([CIP113_SIGN_REFUSAL_MESSAGE, MARKED_TO_FAIL_SIGN_REFUSAL_MESSAGE]);

/**
 * Asks the worker whether `txCbor` may be signed, before a signer that runs in a document
 * (Ledger, Keystone, Trezor over WebUSB) puts it on the device. The refusal index
 * (refusalForProgrammableInputs) and Gero's own Send allowance live in the worker, which
 * the page cannot read, so it asks; the worker also refuses a transaction marked to fail.
 * Throws the refusal the worker names (CIP113_SIGN_REFUSAL_MESSAGE when it names none it
 * knows), and `noAnswer` when the worker does not answer: without an answer, nothing is signed.
 */
export async function assertCip113SignAllowed(txCbor: string, noAnswer: string): Promise<void> {
  const preflight = (await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.CIP113_SIGN_PREFLIGHT,
    data: { txCbor },
  })) as { data?: { success?: boolean; refused?: boolean; message?: unknown } };
  if (preflight?.data?.refused) {
    const message = preflight.data.message;
    throw new Error(typeof message === 'string' && KNOWN_REFUSALS.has(message) ? message : CIP113_SIGN_REFUSAL_MESSAGE);
  }
  if (preflight?.data?.success !== true) throw new Error(noAnswer);
}
