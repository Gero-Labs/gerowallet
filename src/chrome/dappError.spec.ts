import { describe, it, expect } from 'vitest';
import { toDappError } from './dappError';
import { APIError, DataSignError } from './config';

// Chrome extension messaging JSON-serializes responses; this mirrors what a
// dApp actually receives on the other side of sendResponse/postMessage.
const overTheWire = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('toDappError', () => {
  it('documents the underlying bug: a raw Error serializes to an empty object', () => {
    // This is why Opera users saw `Uncaught {}` — message/stack are
    // non-enumerable, so JSON serialization strips everything.
    expect(overTheWire(new Error('side panel needs a user gesture'))).toEqual({});
  });

  it('converts an Error into a CIP-30 {code, info} shape that survives the wire', () => {
    const wired = overTheWire(toDappError(new Error('popup window failed to open')));
    expect(wired.code).toBe(APIError.InternalError.code);
    expect(wired.info).toBe('popup window failed to open');
  });

  it('falls back to the generic InternalError info for a message-less Error', () => {
    const wired = overTheWire(toDappError(new Error()));
    expect(wired).toEqual(APIError.InternalError);
  });

  it('passes intentional APIError shapes through untouched', () => {
    expect(toDappError(APIError.Refused)).toBe(APIError.Refused);
    expect(toDappError(DataSignError.ProofGeneration)).toBe(DataSignError.ProofGeneration);
  });

  it('passes Midnight connector error shapes through untouched', () => {
    const midnightError = {
      type: 'DAppConnectorAPIError',
      code: 'Rejected',
      reason: 'User closed the approval window',
      message: 'User closed the approval window',
    };
    expect(toDappError(midnightError)).toBe(midnightError);
  });

  it('passes string errors through untouched', () => {
    expect(toDappError('mini-gero port connection timeout')).toBe('mini-gero port connection timeout');
  });

  it('maps null/undefined to InternalError so dApps never reject with nothing', () => {
    expect(toDappError(null)).toEqual(APIError.InternalError);
    expect(toDappError(undefined)).toEqual(APIError.InternalError);
  });
});
