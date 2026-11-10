import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

// Only `create` is replaced, so the routes see genuine axios errors.
const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  const instance = { post, interceptors: { request: { use: () => undefined }, response: { use: () => undefined } } };
  return { ...actual, default: { ...actual.default, create: () => instance } };
});
vi.mock('@/services/nexusDevice.service', () => ({ getNexusAccessToken: vi.fn(), reauthenticateNexus: vi.fn() }));

const { MidnightApi } = await import('./midnight-api');
const i18n = (await import('@/plugins/i18n')).default;

const answered = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
    status, data, statusText: '', headers: new AxiosHeaders(headers), config: {} as never,
  });

const api = new MidnightApi('Preprod');
const routes = [
  ['buildUnshieldedTx', 'build', () => api.buildUnshieldedTx({ fromAddress: 'a', publicKeyHex: 'b', addressHex: 'c', outputs: [], ttlMs: 1 })],
  ['buildShieldSwapUnshieldedTx', 'build', () => api.buildShieldSwapUnshieldedTx({ fromAddress: 'a', publicKeyHex: 'b', addressHex: 'c', amount: '1', ttlMs: 1 })],
  ['buildNightDustRegistrationTx', 'build', () => api.buildNightDustRegistrationTx({ fromAddress: 'a', publicKeyHex: 'b', addressHex: 'c', dustReceiverAddressBech32: 'd', ttlMs: 1 })],
  // No lost-reply recovery on this submit, so an answer without a body leaves the outcome open.
  ['submitNightDustRegistrationTx', 'submit', () => api.submitNightDustRegistrationTx({ unprovenTxHex: 'aa', signatureHex: 'bb' })],
] as const;

beforeEach(() => post.mockReset());

describe.each(routes)('MidnightApi.%s errors', (_name, phase, call) => {
  it('a 501 MIDNIGHT_NETWORK_UPGRADING is the network upgrade sentence, not JSON', async () => {
    post.mockRejectedValueOnce(answered(501, { status: 501, error: 'Not Implemented', errorCode: 'MIDNIGHT_NETWORK_UPGRADING', message: 'paused', requestId: 'r' }));
    const thrown = await call().catch((e: unknown) => e) as Error & { kind?: string };
    expect(thrown.name).toBe('MidnightApiError');
    expect(thrown.kind).toBe('networkUpgrading');
    expect(thrown.message).toBe(String(i18n.t('midnight.errors.networkUpgrading', { network: 'Midnight Preprod' })));
    expect(thrown.message).not.toContain('{');
  });

  it('an HTML error page is no answer: nothing sent on a build, maybe sent on a submit', async () => {
    post.mockRejectedValueOnce(answered(502, '<html>bad gateway</html>', { 'Content-Type': 'text/html' }));
    const thrown = await call().catch((e: unknown) => e) as Error & { kind?: string };
    expect(thrown.kind).toBe('noAnswer');
    expect(thrown.message).toBe(String(i18n.t(phase === 'submit' ? 'midnight.errors.submitUnconfirmed' : 'midnight.errors.noAnswer')));
  });

  it('another answer shows the server\'s message only', async () => {
    post.mockRejectedValueOnce(answered(400, { status: 400, error: 'Bad Request', message: 'No NIGHT UTxOs available', requestId: 'r' }, { 'X-Trace': 't' }));
    const thrown = await call().catch((e: unknown) => e) as Error;
    expect(thrown.message).toBe('No NIGHT UTxOs available');
  });

  it('a 2xx that is not 200 is typed too', async () => {
    post.mockResolvedValueOnce({ status: 202, data: { errorCode: 'LEDGER_MISMATCH', message: 'changed' } });
    await expect(call()).rejects.toMatchObject({ name: 'MidnightApiError', kind: 'ledgerMismatch', status: 202 });
  });
});
