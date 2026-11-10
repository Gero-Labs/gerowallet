import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';
import { MidnightApiError } from './midnightApiError';
import {
  MidnightSubmitUnconfirmedError,
  SUBMITTED_TX_QUERY,
  isLostReply,
  recoverLostSubmit,
} from './midnightSubmitRecovery';

// Only `create` is replaced: AxiosError and isAxiosError stay real so the
// classification and the typed error see genuine axios errors.
const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  const instance = { post, interceptors: { request: { use: () => undefined }, response: { use: () => undefined } } };
  return { ...actual, default: { ...actual.default, create: () => instance } };
});
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/services/nexusDevice.service', () => ({ getNexusAccessToken: vi.fn(), reauthenticateNexus: vi.fn() }));

const { MidnightApi } = await import('./midnight-api');

const HASH = 'ab'.repeat(32);
const ID = 'cd'.repeat(32);
const REJECTED = 'The Midnight network rejected this transaction.';

const withCode = (code: string) => new AxiosError('boom', code);
const withStatus = (status: number, data: unknown = { message: 'x' }) =>
  new AxiosError('boom', 'ERR_BAD_RESPONSE', undefined, undefined, {
    status, data, statusText: '', headers: {}, config: {} as never,
  });

const regular = (status: string | null, hash = `0x${HASH.toUpperCase()}`) => ({
  __typename: 'RegularTransaction',
  hash,
  identifiers: [ID],
  transactionResult: status === null ? null : { status },
});
const reply = (...transactions: unknown[]) => ({ transactions });

/** A clock that only moves when the code under test sleeps, so no real timers are needed. */
function fakeClock() {
  let t = 1_000_000;
  const sleep = vi.fn(async (ms: number) => { t += ms; });
  return { now: () => t, sleep };
}

describe('isLostReply', () => {
  it.each(['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK'])('treats %s as a lost reply', (code) => {
    expect(isLostReply(withCode(code))).toBe(true);
  });

  it('treats an axios error with no response at all as a lost reply', () => {
    expect(isLostReply(new AxiosError('socket hang up'))).toBe(true);
  });

  it.each([502, 503, 504, 520, 522, 524])('treats HTTP %i as a lost reply', (status) => {
    expect(isLostReply(withStatus(status, null))).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 500])('treats HTTP %i with a body as a real failure', (status) => {
    expect(isLostReply(withStatus(status))).toBe(false);
  });

  it('never treats something that is not an axios error as a lost reply', () => {
    // E.g. the device token could not be fetched, so the request never left.
    expect(isLostReply(new Error('token'))).toBe(false);
    expect(isLostReply('Request timeout - please try again')).toBe(false);
    expect(isLostReply(null)).toBe(false);
    expect(isLostReply(undefined)).toBe(false);
  });
});

describe('recoverLostSubmit', () => {
  const graphql = vi.fn();
  beforeEach(() => graphql.mockReset());

  const recover = (error: unknown, watch: { identifiers?: readonly string[] } | undefined = { identifiers: [ID] }, clock = fakeClock(), extra = {}) =>
    recoverLostSubmit(error, watch, { graphql, ...clock, ...extra });

  it.each([400, 401, 409, 500])('rethrows a real HTTP %i as a readable typed error, without polling', async (status) => {
    const error = withStatus(status);
    const thrown = await recover(error).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(MidnightApiError);
    expect(thrown).toMatchObject({ kind: 'server', status, message: 'x' });
    expect(graphql).not.toHaveBeenCalled();
  });

  it('rethrows a failure that never left the device as "nothing was sent", without polling', async () => {
    // For example the device token couldn't be fetched: the request never went out.
    const thrown = await recover(new Error('token')).catch((e: unknown) => e);
    expect(thrown).toMatchObject({ name: 'MidnightApiError', kind: 'noAnswer', phase: 'build', message: 'midnight.errors.noAnswer' });
    expect(graphql).not.toHaveBeenCalled();
  });

  it('names the network in the network upgrade sentence', async () => {
    const error = withStatus(501, { errorCode: 'MIDNIGHT_NETWORK_UPGRADING', message: 'paused' });
    const thrown = await recoverLostSubmit(error, { identifiers: [ID] }, { graphql, network: 'Preprod' }).catch((e: unknown) => e);
    expect(thrown).toMatchObject({ kind: 'networkUpgrading', status: 501 });
    expect((thrown as Error).message).toBe('midnight.errors.networkUpgrading');
    expect(graphql).not.toHaveBeenCalled();
  });

  it.each([
    ['a timeout code', () => withCode('ECONNABORTED')],
    ['no response', () => new AxiosError('socket hang up')],
    ['a 504', () => withStatus(504, null)],
    ['a 524', () => withStatus(524, null)],
  ])('looks the transaction up after %s', async (_name, makeError) => {
    graphql.mockResolvedValueOnce(reply(regular('SUCCESS')));
    await expect(recover(makeError())).resolves.toEqual({ txHash: HASH, ledgerTxHash: HASH, status: 'InBlock' });
  });

  it('queries the indexer by the first identifier', async () => {
    graphql.mockResolvedValueOnce(reply(regular('SUCCESS')));
    await recover(withCode('ECONNABORTED'), { identifiers: [ID, 'ee'.repeat(32)] });
    expect(graphql).toHaveBeenCalledTimes(1);
    expect(graphql).toHaveBeenCalledWith(SUBMITTED_TX_QUERY, { id: ID });
    expect(SUBMITTED_TX_QUERY).toContain('query GeroSubmittedTx($id: HexEncoded!)');
    expect(SUBMITTED_TX_QUERY).toContain('transactions(offset: {identifier: $id})');
    expect(SUBMITTED_TX_QUERY).toContain('... on RegularTransaction { identifiers transactionResult { status } }');
  });

  it('strips a 0x prefix and lowercases the hash it reports', async () => {
    graphql.mockResolvedValueOnce(reply(regular('SUCCESS', `0X${HASH.toUpperCase()}`)));
    const result = await recover(withCode('ECONNABORTED'));
    expect(result.txHash).toBe(HASH);
    expect(result.ledgerTxHash).toBe(HASH);
  });

  it('reports PARTIAL_SUCCESS as included', async () => {
    graphql.mockResolvedValueOnce(reply(regular('PARTIAL_SUCCESS', HASH)));
    await expect(recover(withCode('ECONNABORTED'))).resolves.toEqual({ txHash: HASH, ledgerTxHash: HASH, status: 'InBlock' });
  });

  it('reports a FAILURE result as a rejection by the network, not as unconfirmed', async () => {
    graphql.mockResolvedValueOnce(reply(regular('FAILURE')));
    const failure = recover(withCode('ECONNABORTED'));
    await expect(failure).rejects.toThrow(REJECTED);
    await expect(failure).rejects.not.toBeInstanceOf(MidnightSubmitUnconfirmedError);
  });

  it('keeps polling past system transactions and rows without a result', async () => {
    const clock = fakeClock();
    graphql
      .mockResolvedValueOnce(reply({ __typename: 'SystemTransaction', hash: `0x${'11'.repeat(32)}`, transactionResult: { status: 'FAILURE' } }))
      .mockResolvedValueOnce(reply(regular(null)))
      .mockResolvedValueOnce(reply())
      .mockResolvedValueOnce(reply(regular('SUCCESS')));
    await expect(recover(withCode('ECONNABORTED'), { identifiers: [ID] }, clock)).resolves.toMatchObject({ txHash: HASH });
    expect(graphql).toHaveBeenCalledTimes(4);
    expect(clock.sleep).toHaveBeenCalledTimes(3);
    expect(clock.sleep).toHaveBeenCalledWith(5_000);
  });

  it('swallows a failing poll and keeps going', async () => {
    graphql
      .mockRejectedValueOnce(new Error('GraphQL errors: []'))
      .mockRejectedValueOnce('Network error: offline')
      .mockResolvedValueOnce(reply(regular('SUCCESS')));
    await expect(recover(withCode('ECONNABORTED'))).resolves.toMatchObject({ txHash: HASH });
    expect(graphql).toHaveBeenCalledTimes(3);
  });

  it('gives up with MidnightSubmitUnconfirmedError once the 120 s window has passed', async () => {
    const clock = fakeClock();
    graphql.mockResolvedValue(reply());
    const outcome = recover(withCode('ECONNABORTED'), { identifiers: [ID] }, clock);
    await expect(outcome).rejects.toBeInstanceOf(MidnightSubmitUnconfirmedError);
    await expect(outcome).rejects.toMatchObject({
      name: 'MidnightSubmitUnconfirmedError',
      message: 'midnight.errors.submitUnconfirmed',
    });
    // One poll every 5 s from 0 s to 120 s inclusive.
    expect(graphql).toHaveBeenCalledTimes(25);
    expect(clock.sleep).toHaveBeenCalledTimes(24);
    expect(clock.sleep.mock.calls.every(([ms]) => ms === 5_000)).toBe(true);
  });

  it('is unconfirmed, not failed, when every poll errors for the whole window', async () => {
    // A fresh mock: a permanent rejection on the shared, reset one is reported as an unhandled rejection by vitest.
    const down = vi.fn().mockRejectedValue(new Error('indexer down'));
    await expect(recover(withCode('ERR_NETWORK'), undefined, fakeClock(), { graphql: down }))
      .rejects.toBeInstanceOf(MidnightSubmitUnconfirmedError);
    expect(down).toHaveBeenCalledTimes(25);
  });

  it('still polls once at the deadline, so a transaction landing in the last interval is found', async () => {
    graphql.mockResolvedValueOnce(reply()).mockResolvedValueOnce(reply()).mockResolvedValueOnce(reply(regular('SUCCESS')));
    const result = await recover(withCode('ECONNABORTED'), { identifiers: [ID] }, fakeClock(), { windowMs: 10_000 });
    expect(result.txHash).toBe(HASH);
  });

  it.each([
    ['no watch', undefined],
    ['a watch without identifiers', {}],
    ['an empty identifier list', { identifiers: [] }],
  ])('is unconfirmed straight away with %s and never polls', async (_name, watch) => {
    const clock = fakeClock();
    await expect(
      recoverLostSubmit(withCode('ECONNABORTED'), watch, { graphql, ...clock }),
    ).rejects.toBeInstanceOf(MidnightSubmitUnconfirmedError);
    expect(graphql).not.toHaveBeenCalled();
    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it('still rethrows a real failure when there are no identifiers', async () => {
    const error = withStatus(400);
    await expect(recoverLostSubmit(error, undefined, { graphql })).rejects.toMatchObject({ kind: 'server', status: 400, message: 'x' });
  });
});

describe('MidnightApi submit routes', () => {
  const request = { signedTxHex: 'aa', waitFor: 'InBlock' as const };
  const ok = { txHash: `0x${'12'.repeat(32)}`, status: 'InBlock' as const };
  const indexer = (...transactions: unknown[]) => ({ status: 200, data: { data: { transactions } } });
  const api = new MidnightApi('Preprod');

  const routes = [
    ['submitMidnightTx', 'tx/submit', (watch?: { identifiers?: readonly string[] }) => api.submitMidnightTx(request, watch)],
    ['proveAndSubmitMidnightTx', 'tx/prove-and-submit', (watch?: { identifiers?: readonly string[] }) => api.proveAndSubmitMidnightTx(request, watch)],
    ['submitProvenMidnightTx', 'tx/submit-proven', (watch?: { identifiers?: readonly string[] }) => api.submitProvenMidnightTx(request, watch)],
  ] as const;

  beforeEach(() => post.mockReset());

  describe.each(routes)('%s', (_name, subpath, call) => {
    it('allows the submit 110 s instead of the instance default', async () => {
      post.mockResolvedValueOnce({ status: 200, data: ok });
      await expect(call()).resolves.toEqual(ok);
      expect(post).toHaveBeenCalledTimes(1);
      const [url, body, config] = post.mock.calls[0];
      expect(url).toMatch(new RegExp(`/${subpath}$`));
      expect(body).toEqual(request);
      expect(config).toEqual({ timeout: 110000 });
    });

    it('rethrows a real failure as a readable typed error, without polling', async () => {
      post.mockRejectedValueOnce(withStatus(409));
      await expect(call({ identifiers: [ID] })).rejects.toMatchObject({ name: 'MidnightApiError', kind: 'server', status: 409, message: 'x' });
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('turns a 501 MIDNIGHT_NETWORK_UPGRADING into the network upgrade error, without polling', async () => {
      post.mockRejectedValueOnce(withStatus(501, { status: 501, errorCode: 'MIDNIGHT_NETWORK_UPGRADING', message: 'paused' }));
      await expect(call({ identifiers: [ID] })).rejects.toMatchObject({ kind: 'networkUpgrading', network: 'Preprod' });
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('turns LEDGER_MISMATCH into its own kind, by code or by message', async () => {
      post.mockRejectedValueOnce(withStatus(500, { message: 'LEDGER_MISMATCH' }));
      await expect(call({ identifiers: [ID] })).rejects.toMatchObject({ kind: 'ledgerMismatch' });
      post.mockRejectedValueOnce(withStatus(409, { errorCode: 'LEDGER_MISMATCH', message: 'changed' }));
      await expect(call({ identifiers: [ID] })).rejects.toMatchObject({ kind: 'ledgerMismatch' });
    });

    it('looks the transaction up through the indexer passthrough after a lost reply', async () => {
      post.mockRejectedValueOnce(withStatus(524, null)).mockResolvedValueOnce(indexer(regular('SUCCESS')));
      await expect(call({ identifiers: [ID] })).resolves.toEqual({ txHash: HASH, ledgerTxHash: HASH, status: 'InBlock' });
      expect(post).toHaveBeenCalledTimes(2);
      const [pollUrl, pollBody, ...pollRest] = post.mock.calls[1];
      expect(pollUrl).toMatch(/\/indexer\/graphql$/);
      expect(pollBody).toEqual({ query: SUBMITTED_TX_QUERY, variables: { id: ID } });
      expect(pollRest).toEqual([]);
    });

    it('is unconfirmed rather than failed after a lost reply with nothing to look up', async () => {
      post.mockRejectedValueOnce(withCode('ECONNABORTED'));
      await expect(call()).rejects.toBeInstanceOf(MidnightSubmitUnconfirmedError);
      expect(post).toHaveBeenCalledTimes(1);
    });
  });
});
