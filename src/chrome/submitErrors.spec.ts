import { describe, it, expect } from 'vitest';
import { describeSubmitFailure, dappSubmitError, submitFailureDetail } from './submitErrors';
import { APIError, TX_SUBMIT_UNAVAILABLE_MESSAGE, TxSendError } from '@/chrome/config';
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
    expect(message.startsWith(TX_SUBMIT_UNAVAILABLE_MESSAGE)).toBe(true);
    expect(message).toContain('502');
    expect(message).not.toContain(APIError.InvalidRequest.info);
  });

  it('treats a request that never got a response as the same outage', () => {
    expect(describeSubmitFailure(undefined, undefined).startsWith(TX_SUBMIT_UNAVAILABLE_MESSAGE)).toBe(true);
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
    const error = dappSubmitError(502, GATEWAY_BODY) as { code: number; message: string };
    expect(error.code).toBe(TxSendError.Failure.code);
    expect(error.message).toContain(TX_SUBMIT_UNAVAILABLE_MESSAGE);
  });

  it('passes the node reason through on a rejection', () => {
    const error = dappSubmitError(400, REJECTION_BODY) as { code: number; message: string };
    expect(error.code).toBe(TxSendError.Failure.code);
    expect(error.message).toBe(REJECTION_BODY);
  });

  it('keeps the established mapping for 500, 429 and 425', () => {
    expect(dappSubmitError(500, '')).toBe(APIError.InternalError);
    expect(dappSubmitError(429, '')).toBe(TxSendError.Refused);
    expect(dappSubmitError(425, '')).toBe(ERROR.fullMempool);
  });
});
