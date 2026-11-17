import { afterEach, describe, expect, it, vi } from 'vitest';
import { APIError, METHOD, MIDNIGHT_METHOD, MidnightErrorCode, SENDER, TARGET } from './config';
import { Messaging, toPageError } from './messaging';
import { midnightConnectorError, toMidnightConnectorError } from './midnightConnectorError';

/**
 * A Midnight connector rejection reaches the page over `window.postMessage`,
 * which drops an Error's own fields, so the background sends a plain
 * `{type, code, reason, message}`. Dapps printing that showed
 * `Error: [object Object]` (Dominion, 2026-10-25). The page bridge must hand
 * them a spec APIError: a real Error that still carries type, code and reason.
 */

const BACKGROUND_REJECTION = {
  type: 'DAppConnectorAPIError',
  code: MidnightErrorCode.Rejected,
  reason: 'No proof server is reachable',
  message: 'No proof server is reachable',
};

describe('toMidnightConnectorError', () => {
  it('turns the background shape into an Error carrying type, code and reason', () => {
    const err = toMidnightConnectorError(BACKGROUND_REJECTION);
    expect(err).toBeInstanceOf(Error);
    expect(err.type).toBe('DAppConnectorAPIError');
    expect(err.code).toBe('Rejected');
    expect(err.reason).toBe('No proof server is reachable');
    expect(err.message).toBe('No proof server is reachable');
    expect(String(err)).toBe('Error: No proof server is reachable');
  });

  it('prefers reason over message, and falls back to message, then the code', () => {
    expect(toMidnightConnectorError({ ...BACKGROUND_REJECTION, reason: 'r', message: 'm' }).message).toBe('r');
    const noReason = toMidnightConnectorError({ type: 'DAppConnectorAPIError', code: 'InvalidRequest', message: 'm' });
    expect(noReason.message).toBe('m');
    expect(noReason.reason).toBe('m');
    expect(toMidnightConnectorError({ type: 'DAppConnectorAPIError', code: 'Disconnected' }).message).toBe('Disconnected');
  });

  it('maps a CIP-30 shaped refusal to InternalError with its readable text', () => {
    const err = toMidnightConnectorError(APIError.Refused);
    expect(err).toBeInstanceOf(Error);
    expect(err.type).toBe('DAppConnectorAPIError');
    expect(err.code).toBe(MidnightErrorCode.InternalError);
    expect(err.reason).toBe(APIError.Refused.info);
  });

  it('maps an unknown Midnight code to InternalError, keeping the reason', () => {
    const err = toMidnightConnectorError({ type: 'DAppConnectorAPIError', code: 'Bogus', reason: 'why' });
    expect(err.code).toBe(MidnightErrorCode.InternalError);
    expect(err.reason).toBe('why');
  });

  it('wraps a bare string and a plain Error', () => {
    const fromString = toMidnightConnectorError('Could not establish connection');
    expect(fromString).toBeInstanceOf(Error);
    expect(fromString.code).toBe(MidnightErrorCode.InternalError);
    expect(fromString.message).toBe('Could not establish connection');

    const fromError = toMidnightConnectorError(new Error('boom'));
    expect(fromError.code).toBe(MidnightErrorCode.InternalError);
    expect(fromError.message).toBe('boom');
  });

  it('returns an existing APIError untouched', () => {
    const original = midnightConnectorError(MidnightErrorCode.Rejected, 'declined');
    expect(toMidnightConnectorError(original)).toBe(original);
  });

  it('never yields an empty message', () => {
    for (const raw of [true, {}, '', null, new Error('')]) {
      const err = toMidnightConnectorError(raw);
      expect(err.message).toBe('Unknown wallet error');
      expect(String(err)).not.toContain('[object Object]');
    }
  });
});

describe('toPageError', () => {
  it('converts only for Midnight connector methods', () => {
    for (const method of Object.values(MIDNIGHT_METHOD)) {
      expect(toPageError(method, BACKGROUND_REJECTION)).toBeInstanceOf(Error);
    }
  });

  it('leaves the CIP-30 {code, info} object unchanged', () => {
    expect(toPageError(METHOD.signTx, APIError.Refused)).toBe(APIError.Refused);
  });
});

describe('Messaging.sendToContent rejections', () => {
  afterEach(() => vi.restoreAllMocks());

  /** Answer every request the page posts with `error`, as the content script would. */
  function replyWithError(error: unknown) {
    vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
      const { id } = message as { id: string };
      queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', {
        data: { id, error, target: TARGET, sender: SENDER.extension },
      })));
    });
  }

  it('rejects a Midnight method with a readable APIError', async () => {
    replyWithError(BACKGROUND_REJECTION);
    const err = await Messaging.sendToContent({ method: MIDNIGHT_METHOD.getProvingProvider, data: {} })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ type: 'DAppConnectorAPIError', code: 'Rejected', reason: 'No proof server is reachable' });
    expect(String(err)).toBe('Error: No proof server is reachable');
  });

  it('rejects a CIP-30 method with the unchanged {code, info} object', async () => {
    replyWithError(APIError.Refused);
    const err = await Messaging.sendToContent({ method: METHOD.signTx, data: {} }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(Error);
    expect(err).toEqual(APIError.Refused);
  });
});
