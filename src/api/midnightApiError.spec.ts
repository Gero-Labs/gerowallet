import { describe, expect, it } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import i18n from '@/plugins/i18n';
import {
  MidnightApiError,
  isMidnightApiError,
  isMidnightServerSideFailure,
  midnightApiErrorFromResponse,
  midnightApiErrorKind,
  midnightNetworkDisplayName,
  midnightSendBlockOf,
  parseRetryAfter,
  toMidnightApiError,
} from './midnightApiError';

const answered = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
    status, data, statusText: '', headers: new AxiosHeaders(headers), config: {} as never,
  });

const envelope = (status: number, fields: Record<string, unknown>) =>
  ({ status, error: 'Server error', requestId: 'req-1', ...fields });

const UPGRADING = String(i18n.t('midnight.errors.networkUpgrading', { network: 'Midnight Preprod' }));
const LEDGER = String(i18n.t('midnight.errors.ledgerMismatch'));
const NO_ANSWER = String(i18n.t('midnight.errors.noAnswer'));

/** Nothing a user reads may be JSON or carry response headers. */
function expectReadable(error: MidnightApiError) {
  expect(error.message).not.toMatch(/^\s*[{["]/);
  expect(error.message).not.toMatch(/headers|requestId|content-type|retry-after/i);
  expect(error.message.trim().length).toBeGreaterThan(0);
}

describe('Midnight API errors: one row per server error code', () => {
  it('MIDNIGHT_NETWORK_UPGRADING with errorCode: the network upgrade sentence, naming the network', () => {
    const e = toMidnightApiError(answered(501, envelope(501, { errorCode: 'MIDNIGHT_NETWORK_UPGRADING', message: 'Midnight writes are paused' })), 'Preprod');
    expect(e.kind).toBe('networkUpgrading');
    expect(e.status).toBe(501);
    expect(e.errorCode).toBe('MIDNIGHT_NETWORK_UPGRADING');
    expect(e.message).toBe(UPGRADING);
    expect(e.message).toContain('Midnight Preprod');
    expectReadable(e);
  });

  it('a 501 without errorCode: the server\'s message', () => {
    const e = toMidnightApiError(answered(501, envelope(501, { message: 'Midnight writes are paused' })), 'Preprod');
    expect(e.kind).toBe('server');
    expect(e.message).toBe('Midnight writes are paused');
  });

  it('carries the 501 reason when the server sends one', () => {
    const e = toMidnightApiError(answered(501, envelope(501, { errorCode: 'MIDNIGHT_NETWORK_UPGRADING', message: 'm', reason: 'ledger upgrade' })), 'Mainnet');
    expect(e.reason).toBe('ledger upgrade');
    expect(e.serverMessage).toBe('m');
  });

  it('LEDGER_MISMATCH with errorCode', () => {
    const e = toMidnightApiError(answered(409, envelope(409, { errorCode: 'LEDGER_MISMATCH', message: 'The ledger changed' })), 'Mainnet');
    expect(e.kind).toBe('ledgerMismatch');
    expect(e.message).toBe(LEDGER);
    expectReadable(e);
  });

  it('LEDGER_MISMATCH without errorCode, by the message', () => {
    const e = toMidnightApiError(answered(500, envelope(500, { message: 'LEDGER_MISMATCH' })), 'Mainnet');
    expect(e.kind).toBe('ledgerMismatch');
    expect(e.message).toBe(LEDGER);
  });

  it('MIDNIGHT_PROVER_BUSY with errorCode: typed, with Retry-After, and the server\'s sentence', () => {
    const e = toMidnightApiError(answered(503, envelope(503, { errorCode: 'MIDNIGHT_PROVER_BUSY', message: 'Proving is busy' }), { 'Retry-After': '20' }), 'Mainnet');
    expect(e.kind).toBe('proverBusy');
    expect(e.retryAfter).toBe(20);
    expect(e.message).toBe('Proving is busy');
    expectReadable(e);
  });

  it('MIDNIGHT_PROVER_BUSY without errorCode: the server\'s message', () => {
    const e = toMidnightApiError(answered(503, envelope(503, { message: 'Proving is busy' })), 'Mainnet');
    expect(e.kind).toBe('server');
    expect(e.message).toBe('Proving is busy');
  });

  it('MIDNIGHT_RESET_PENDING is typed for the resync flow', () => {
    const e = toMidnightApiError(answered(503, envelope(503, { errorCode: 'MIDNIGHT_RESET_PENDING', message: 'Rebuilding' })), 'Mainnet');
    expect(e.kind).toBe('resetPending');
    expect(e.message).toBe('Rebuilding');
  });

  it('any other error with a message: the message', () => {
    const e = toMidnightApiError(answered(400, envelope(400, { errorCode: 'SOMETHING_ELSE', message: 'No NIGHT UTxOs available' })), 'Mainnet');
    expect(e.kind).toBe('server');
    expect(e.message).toBe('No NIGHT UTxOs available');
    expect(e.serverMessage).toBe('No NIGHT UTxOs available');
  });

  it('a short plain-text body is the message', () => {
    expect(toMidnightApiError(answered(400, 'Invalid transaction hex'), 'Mainnet').message).toBe('Invalid transaction hex');
    expect(toMidnightApiError(answered(400, 'LEDGER_MISMATCH'), 'Mainnet').kind).toBe('ledgerMismatch');
  });

  it.each([
    ['an HTML page from a proxy', answered(502, '<html><body>Bad gateway</body></html>')],
    ['an empty body', answered(500, '')],
    ['a body with no message', answered(500, { status: 500, requestId: 'r' })],
    ['a binary body', answered(500, new ArrayBuffer(4))],
    ['no response at all', new AxiosError('socket hang up', 'ERR_NETWORK')],
    ['a timeout', new AxiosError('timeout', 'ECONNABORTED')],
    ['something that is not an HTTP error', new Error('token fetch failed')],
  ])('no parseable body (%s): "Midnight didn\'t answer"', (_name, error) => {
    const e = toMidnightApiError(error, 'Mainnet');
    expect(e.kind).toBe('noAnswer');
    expect(e.message).toBe(NO_ANSWER);
    expectReadable(e);
  });

  it('never shows JSON or headers, even for a body that is JSON text', () => {
    const body = JSON.stringify(envelope(500, { message: 'Failed to build' }));
    const e = toMidnightApiError(answered(500, body, { 'X-Secret-Header': 'nope' }), 'Mainnet');
    expect(e.message).toBe('Failed to build');
    expect(e.message).not.toContain('X-Secret-Header');
  });

  it.each([
    ['no response', new AxiosError('socket hang up', 'ERR_NETWORK')],
    ['an HTML page', answered(500, '<html>oops</html>')],
  ])('on a submit route, no usable answer (%s) says the transaction may still go through', (_name, error) => {
    const e = toMidnightApiError(error, 'Mainnet', 'submit');
    expect(e.kind).toBe('noAnswer');
    expect(e.phase).toBe('submit');
    expect(e.message).toBe(String(i18n.t('midnight.errors.submitUnconfirmed')));
    expect(e.message).not.toContain('Nothing was sent');
  });

  it('on a build route, no usable answer says nothing was sent', () => {
    expect(toMidnightApiError(new AxiosError('down', 'ERR_NETWORK'), 'Mainnet').message).toBe(NO_ANSWER);
    expect(NO_ANSWER).toContain('Nothing was sent');
  });

  it('passes a typed error through unchanged', () => {
    const e = new MidnightApiError('ledgerMismatch', {}, 'Mainnet');
    expect(toMidnightApiError(e, 'Preprod')).toBe(e);
  });

  it('builds the same error from a non-200 success status', () => {
    const e = midnightApiErrorFromResponse(202, envelope(202, { errorCode: 'MIDNIGHT_NETWORK_UPGRADING', message: 'm' }), undefined, 'Preprod');
    expect(e.kind).toBe('networkUpgrading');
    expect(e.status).toBe(202);
  });
});

describe('Midnight API error helpers', () => {
  it.each([401, 403, 408, 429])('calls a %i answer server-side, so a dapp gets InternalError', (status) => {
    const e = toMidnightApiError(answered(status, envelope(status, { message: 'Try later' })), 'Mainnet');
    expect(e.kind).toBe('server');
    expect(isMidnightServerSideFailure(e)).toBe(true);
  });

  it('names the network the way the network list does', () => {
    expect(midnightNetworkDisplayName('Preprod')).toBe('Midnight Preprod');
    expect(midnightNetworkDisplayName('mainnet')).toBe('Midnight Mainnet');
    expect(midnightNetworkDisplayName('Midnight Stagenet')).toBe('Midnight Stagenet');
    expect(midnightNetworkDisplayName(undefined)).toBe('Midnight');
  });

  it('tells a paused network and an unsupported ledger apart from errors', () => {
    expect(midnightSendBlockOf(new MidnightApiError('networkUpgrading', {}, 'Preprod'))).toBe('networkUpgrading');
    expect(midnightSendBlockOf(Object.assign(new Error('update'), { name: 'MidnightBuiltTxRefusedError', code: 'MIDNIGHT_BUILT_TX_LEDGER_UNSUPPORTED' })))
      .toBe('updateRequired');
    expect(midnightSendBlockOf(Object.assign(new Error('x'), { name: 'MidnightBuiltTxRefusedError', code: 'MIDNIGHT_BUILT_TX_MISMATCH' }))).toBeNull();
    expect(midnightSendBlockOf(new MidnightApiError('ledgerMismatch', {}))).toBeNull();
    expect(midnightSendBlockOf('a string')).toBeNull();
  });

  it('reads Retry-After as seconds or as an HTTP date', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('30', now)).toBe(30);
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:45 GMT', now)).toBe(45);
    expect(parseRetryAfter('Wed, 31 Dec 2025 23:59:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(undefined, now)).toBeUndefined();
  });

  it('recognises the error by name, across module copies', () => {
    const e = new MidnightApiError('noAnswer', {});
    expect(isMidnightApiError(e)).toBe(true);
    expect(midnightApiErrorKind(e)).toBe('noAnswer');
    expect(isMidnightApiError(new Error('x'))).toBe(false);
    expect(midnightApiErrorKind('a string')).toBeUndefined();
  });

  it('calls a server-side state a server-side failure, and a bad request not one', () => {
    const fromStatus = (status: number, fields: Record<string, unknown>) => toMidnightApiError(answered(status, envelope(status, fields)), 'Mainnet');
    expect(isMidnightServerSideFailure(fromStatus(501, { errorCode: 'MIDNIGHT_NETWORK_UPGRADING', message: 'm' }))).toBe(true);
    expect(isMidnightServerSideFailure(fromStatus(501, { message: 'Not implemented' }))).toBe(true);
    expect(isMidnightServerSideFailure(fromStatus(409, { errorCode: 'LEDGER_MISMATCH', message: 'm' }))).toBe(true);
    expect(isMidnightServerSideFailure(fromStatus(500, { message: 'boom' }))).toBe(true);
    expect(isMidnightServerSideFailure(toMidnightApiError(new AxiosError('down', 'ERR_NETWORK')))).toBe(true);
    expect(isMidnightServerSideFailure(Object.assign(new Error('unconfirmed'), { name: 'MidnightSubmitUnconfirmedError' }))).toBe(true);
    expect(isMidnightServerSideFailure(fromStatus(400, { message: 'Invalid transaction hex' }))).toBe(false);
    expect(isMidnightServerSideFailure(fromStatus(404, { message: 'Not found' }))).toBe(false);
    expect(isMidnightServerSideFailure(new Error('This transaction is not proven'))).toBe(false);
  });
});
