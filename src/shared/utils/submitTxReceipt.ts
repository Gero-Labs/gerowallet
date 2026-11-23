import { TX_SUBMIT_UNCONFIRMED_MESSAGE } from '@/chrome/config';

export class UnconfirmedTxSubmission extends Error {
  constructor() {
    super(TX_SUBMIT_UNCONFIRMED_MESSAGE);
  }
}

interface SubmitReply {
  error?: unknown;
  data?: { error?: unknown; txId?: unknown };
}

/** A lost message port can follow a successful broadcast. Only the worker can acknowledge it. */
export async function submittedTxId(reply: Promise<unknown>): Promise<string> {
  let received: SubmitReply | null | undefined;
  try {
    received = await reply as SubmitReply | null | undefined;
  } catch {
    throw new UnconfirmedTxSubmission();
  }
  if (received?.error) throw new UnconfirmedTxSubmission();
  const error = received?.data?.error;
  if (error) {
    if (typeof error !== 'string' || error.startsWith(TX_SUBMIT_UNCONFIRMED_MESSAGE)) throw new UnconfirmedTxSubmission();
    throw new Error(error);
  }
  const id = received?.data?.txId;
  if (typeof id !== 'string' || !id.trim()) throw new UnconfirmedTxSubmission();
  return id.trim();
}
