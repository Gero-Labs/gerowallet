import { describe, it, expect } from 'vitest';
import {
  describeSubmitFailure,
  dappSubmitError,
  describeUnexpectedSubmitResponse,
  isUnexpectedSubmitResponseError,
  submitFailureDetail,
  unexpectedSubmitResponseError,
} from './submitErrors';
import { APIError, TX_SUBMIT_UNCONFIRMED_MESSAGE, TxSendError } from '@/chrome/config';
import { ERROR } from '@/models/types';

/** What the backend actually returned for the mainnet withdrawal ticket of 2026-09-21. */
const GATEWAY_BODY = 'Unparseable Ogmios response: Something went wrong';
/** What it returns now that Ogmios can decode the node's rejection. */
const REJECTION_BODY = 'Ogmios rejected tx: Invalid transaction; the withdrawal amount does not match the reward balance.';

describe('submitFailureDetail', () => {
  it('reads a plain-text body', () => {
    expect(submitFailureDetail(REJECTION_BODY)).toBe(REJECTION_BODY);
  });

  it('reads the message out of a JSON envelope', () => {
    expect(submitFailureDetail({ status: 400, message: REJECTION_BODY })).toBe(REJECTION_BODY);
  });

  it('returns empty for a body with nothing quotable', () => {
    expect(submitFailureDetail(undefined)).toBe('');
    expect(submitFailureDetail('   ')).toBe('');
  });
});

describe('describeSubmitFailure', () => {
  // Regression: a 502 used to fall through to APIError.InvalidRequest, so a backend
  // outage was reported to the user as "Inputs do not conform to this spec".
  it('reports a 502 as our outage, not as a bad transaction', () => {
    const message = describeSubmitFailure(502, GATEWAY_BODY);
    expect(message.startsWith(TX_SUBMIT_UNCONFIRMED_MESSAGE)).toBe(true);
    expect(message).toContain('502');
    expect(message).not.toContain(APIError.InvalidRequest.info);
  });

  it('treats a request that never got a response as the same unknown outcome', () => {
    expect(describeSubmitFailure(undefined, undefined).startsWith(TX_SUBMIT_UNCONFIRMED_MESSAGE)).toBe(true);
  });

  // A node can accept a transaction and then lose its response to a timeout, reset or
  // gateway failure. Telling the user it was not sent invites a second send of a
  // payment that is already on chain (PR #1129 review, reproduced with ECONNRESET).
  it('never claims the transaction was not sent', () => {
    for (const status of [undefined, 502, 503, 504]) {
      const message = describeSubmitFailure(status, '').toLowerCase();
      expect(message).not.toContain('was not sent');
      expect(message).toContain('may still have reached the network');
    }
  });

  it('keeps the node reason on a rejection', () => {
    expect(describeSubmitFailure(400, REJECTION_BODY)).toContain(REJECTION_BODY);
  });

  it('keeps the existing mempool and rate-limit messages', () => {
    expect(describeSubmitFailure(425, '')).toBe(ERROR.fullMempool);
    expect(describeSubmitFailure(429, '')).toBe(TxSendError.Refused.info);
  });
});

describe('dappSubmitError', () => {
  it('no longer blames the dApp transaction for a gateway failure', () => {
    const error = dappSubmitError(502, GATEWAY_BODY) as { code: number; info: string; message: string };
    expect(error.code).toBe(TxSendError.Failure.code);
    expect(error.info).toContain(TX_SUBMIT_UNCONFIRMED_MESSAGE);
    expect(error.message).toBe(error.info);
  });

  // CIP-30 defines TxSendError as {code, info}, so a conforming dApp renders `info`.
  // Leaving the reason only in `message` meant it never reached the user.
  it('puts the node reason in the CIP-30 info field', () => {
    const error = dappSubmitError(400, REJECTION_BODY) as { code: number; info: string; message: string };
    expect(error.code).toBe(TxSendError.Failure.code);
    expect(error.info).toBe(REJECTION_BODY);
    expect(error.info).not.toBe(TxSendError.Failure.info);
    expect(error.message).toBe(REJECTION_BODY);
  });

  it('survives JSON serialization with the reason intact', () => {
    const error = JSON.parse(JSON.stringify(dappSubmitError(400, REJECTION_BODY))) as { info: string };
    expect(error.info).toBe(REJECTION_BODY);
  });

  it('keeps the established mapping for 500, 429 and 425', () => {
    expect(dappSubmitError(500, '')).toBe(APIError.InternalError);
    expect(dappSubmitError(429, '')).toBe(TxSendError.Refused);
    expect(dappSubmitError(425, '')).toBe(ERROR.fullMempool);
  });
});

describe('unexpected 200 body', () => {
  // A 200 whose body is not a tx id is NOT an outage: the endpoint answered. Saying
  // "try again in a moment" there would be a guess, and it threw away what was said
  // (PR #1129 review).
  it('keeps what the endpoint actually returned', () => {
    const message = describeUnexpectedSubmitResponse('maintenance in progress');
    expect(message).toContain('maintenance in progress');
    expect(message).not.toContain(TX_SUBMIT_UNCONFIRMED_MESSAGE);
  });

  it('still says something when the body is empty', () => {
    expect(describeUnexpectedSubmitResponse('')).toContain(TxSendError.Failure.info);
  });

  it('tags its error so a shared catch can rethrow it untouched', () => {
    expect(isUnexpectedSubmitResponseError(unexpectedSubmitResponseError('nope'))).toBe(true);
    expect(isUnexpectedSubmitResponseError(new Error('nope'))).toBe(false);
    expect(isUnexpectedSubmitResponseError(undefined)).toBe(false);
  });
});
