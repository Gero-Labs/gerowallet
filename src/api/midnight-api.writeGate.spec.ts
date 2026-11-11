import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  const instance = { get, interceptors: { request: { use: () => undefined }, response: { use: () => undefined } } };
  return { ...actual, default: { ...actual.default, create: () => instance } };
});
vi.mock('@/services/nexusDevice.service', () => ({ getNexusAccessToken: vi.fn(), reauthenticateNexus: vi.fn() }));

const { MidnightApi, isMidnightWriteRoute, midnightWriteOutcome, parseMidnightWriteStatus } = await import('./midnight-api');

const BASE = 'https://nexus.example/api/midnight/midnight-preprod';
const answered = (status: number, data: unknown = {}) =>
  new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
    status, data, statusText: '', headers: new AxiosHeaders(), config: {} as never,
  });

describe('which answers move the write gate', () => {
  it.each([
    'tx/build-unshielded', 'tx/submit', 'tx/prove-and-submit', 'tx/submit-proven',
    'dust/build-night-registration', 'dust/submit-night-registration',
  ])('%s is a write route', (path) => {
    expect(isMidnightWriteRoute(`${BASE}/${path}`)).toBe(true);
  });

  it.each(['status', 'indexer/graphql', 'dust/account-state/x', 'tx/submit-proven/extra'])('%s is not', (path) => {
    expect(isMidnightWriteRoute(`${BASE}/${path}`)).toBe(false);
  });

  it('a 501 MIDNIGHT_NETWORK_UPGRADING from a write route pauses; any success opens', () => {
    const upgrading = { errorCode: 'MIDNIGHT_NETWORK_UPGRADING', message: 'm' };
    expect(midnightWriteOutcome('Preprod', { url: `${BASE}/tx/submit`, status: 501, data: upgrading })).toBe('paused');
    expect(midnightWriteOutcome('Preprod', { url: `${BASE}/tx/build-unshielded`, status: 200, data: {} })).toBe('open');
  });

  it('anything else says nothing', () => {
    expect(midnightWriteOutcome('Preprod', { url: `${BASE}/tx/submit`, status: 501, data: { message: 'x' } })).toBeNull();
    expect(midnightWriteOutcome('Preprod', { url: `${BASE}/tx/submit`, status: 503, data: { errorCode: 'MIDNIGHT_PROVER_BUSY' } })).toBeNull();
    expect(midnightWriteOutcome('Preprod', { url: `${BASE}/status`, status: 501, data: { errorCode: 'MIDNIGHT_NETWORK_UPGRADING' } })).toBeNull();
    expect(midnightWriteOutcome('Preprod', { url: `${BASE}/indexer/graphql`, status: 200 })).toBeNull();
    expect(midnightWriteOutcome('Preprod', undefined)).toBeNull();
  });
});

describe('the status read', () => {
  const api = new MidnightApi('Preprod');
  beforeEach(() => get.mockReset());

  it('reads /status and only trusts a boolean writesOpen', async () => {
    get.mockResolvedValueOnce({ status: 200, data: { network: 'midnight-preprod', writesOpen: false, reason: 'NETWORK_UPGRADING', message: 'm' } });
    await expect(api.getWriteStatus()).resolves.toEqual({ kind: 'closed', reason: 'NETWORK_UPGRADING', message: 'm' });
    expect(get.mock.calls[0][0]).toMatch(/\/api\/midnight\/midnight-preprod\/status$/);
    get.mockResolvedValueOnce({ status: 200, data: { writesOpen: true } });
    await expect(api.getWriteStatus()).resolves.toEqual({ kind: 'open' });
    get.mockResolvedValueOnce({ status: 200, data: { writesOpen: 'no' } });
    await expect(api.getWriteStatus()).resolves.toEqual({ kind: 'unknown', unsupported: false });
  });

  it('a server without the route is unsupported; any other failure is unknown', async () => {
    get.mockRejectedValueOnce(answered(404));
    await expect(api.getWriteStatus()).resolves.toEqual({ kind: 'unknown', unsupported: true });
    get.mockRejectedValueOnce(answered(500));
    await expect(api.getWriteStatus()).resolves.toEqual({ kind: 'unknown', unsupported: false });
    get.mockRejectedValueOnce(new AxiosError('down', 'ERR_NETWORK'));
    await expect(api.getWriteStatus()).resolves.toEqual({ kind: 'unknown', unsupported: false });
  });

  it('parses bodies defensively', () => {
    expect(parseMidnightWriteStatus(null)).toEqual({ kind: 'unknown', unsupported: false });
    expect(parseMidnightWriteStatus({ writesOpen: false, reason: 7 })).toEqual({ kind: 'closed', reason: undefined, message: undefined });
  });
});
