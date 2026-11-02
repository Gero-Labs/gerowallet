import { CIP113_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import { NFT_MARKET_SIGN_REFUSAL_MESSAGE } from '@/chrome/nftMarket/marketAllowance';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';

/**
 * Asks the worker whether `txCbor` may be signed, before a signer that runs in a document
 * (Ledger, Keystone, Trezor over WebUSB) puts it on the device. The refusal index
 * (refusalForProgrammableInputs), Gero's own Send allowance and the market guard's allowance live
 * in the worker, which the page cannot read, so it asks. Throws the worker's refusal message on a
 * refusal (the market's when the worker says so, CIP113_SIGN_REFUSAL_MESSAGE otherwise: the page
 * never repeats any other text the answer carries), and `noAnswer` when the worker does not
 * answer: without an answer, nothing is signed.
 */
export async function assertCip113SignAllowed(txCbor: string, noAnswer: string): Promise<void> {
  const preflight = (await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.CIP113_SIGN_PREFLIGHT,
    data: { txCbor },
  })) as { data?: { success?: boolean; refused?: boolean; message?: string } };
  if (preflight?.data?.refused) {
    throw new Error(preflight.data.message === NFT_MARKET_SIGN_REFUSAL_MESSAGE ? NFT_MARKET_SIGN_REFUSAL_MESSAGE : CIP113_SIGN_REFUSAL_MESSAGE);
  }
  if (preflight?.data?.success !== true) throw new Error(noAnswer);
}
