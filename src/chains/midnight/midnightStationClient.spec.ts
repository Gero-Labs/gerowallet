// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Network } from '@/models/types';

const auth = vi.hoisted(() => ({ token: vi.fn(async () => 'token-1'), reauth: vi.fn(async () => 'token-2') }));
vi.mock('@/services/nexusDevice.service', () => ({ getNexusAccessToken: auth.token, reauthenticateNexus: auth.reauth }));
// Outside the extension the build version is unknown and no header is sent; a build has one.
vi.mock('./midnightClientVersion', () => ({ geroClientHeaders: () => ({ 'X-Gero-Client': 'extension/9.9.9' }) }));

import { fetchStationChallenge, issueStationVouchers, redeemStationVoucher, STATION_REDEEM_ATTEMPTS } from './midnightStationClient';

const NET = Network.PREPROD;
const STAKE = 'stake_test1uexample';
const CHALLENGE = 'ab'.repeat(32);
const KEY = 'QUJD';
const fetchMock = vi.fn();
const answer = (status: number, data: unknown) => ({ status, json: async () => data });
const eligible = {
  eligible: true, reason: null, allowance: 5, thresholdLovelace: '100000000',
  challenge: CHALLENGE, expiresAt: 1_763_800_000_000, keyId: '2026-11-22', publicKey: KEY,
};
const headersOf = (call: number) => fetchMock.mock.calls[call][1].headers as Record<string, string>;
const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body as string);
const codeOf = async (promise: Promise<unknown>) => promise.then(() => 'resolved', (error: { code?: string }) => error.code);

beforeEach(() => {
  fetchMock.mockReset();
  auth.token.mockClear();
  auth.reauth.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('station client: challenge', () => {
  it('posts the stake address with the device token and reads an eligible answer', async () => {
    fetchMock.mockResolvedValue(answer(200, eligible));
    const challenge = await fetchStationChallenge(NET, STAKE);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/midnight\/midnight-preprod\/sponsor\/challenge$/);
    expect(headersOf(0)['Authorization']).toBe('Bearer token-1');
    expect(bodyOf(0)).toEqual({ stakeAddress: STAKE });
    expect(challenge).toMatchObject({ eligible: true, allowance: 5, challenge: CHALLENGE, keyId: '2026-11-22', publicKey: KEY });
  });

  it('reads a not-eligible answer with its reason and threshold', async () => {
    fetchMock.mockResolvedValue(answer(200, { eligible: false, reason: 'BELOW_THRESHOLD', allowance: 5, thresholdLovelace: '100000000' }));
    expect(await fetchStationChallenge(NET, STAKE)).toMatchObject({ eligible: false, reason: 'BELOW_THRESHOLD', thresholdLovelace: '100000000' });
  });

  it.each([
    ['a missing challenge', { ...eligible, challenge: undefined }],
    ['a challenge that is not 64 hex', { ...eligible, challenge: 'xyz' }],
    ['an allowance of zero', { ...eligible, allowance: 0 }],
    ['an allowance over the batch limit', { ...eligible, allowance: 17 }],
    ['a key id that is not a day', { ...eligible, keyId: 'today' }],
    ['an unknown reason', { eligible: false, reason: 'BECAUSE', allowance: 5, thresholdLovelace: '1' }],
    ['a threshold that is not a number', { ...eligible, thresholdLovelace: '1e8' }],
    ['no body', null],
  ])('treats %s as unavailable', async (_name, data) => {
    fetchMock.mockResolvedValue(answer(200, data));
    expect(await codeOf(fetchStationChallenge(NET, STAKE))).toBe('STATION_UNAVAILABLE');
  });

  it('logs in again once on 401, and gives up as unavailable when the network fails', async () => {
    fetchMock.mockResolvedValueOnce(answer(401, {})).mockResolvedValueOnce(answer(200, eligible));
    await fetchStationChallenge(NET, STAKE);
    expect(auth.reauth).toHaveBeenCalledOnce();
    expect(headersOf(1)['Authorization']).toBe('Bearer token-2');
    fetchMock.mockReset().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await codeOf(fetchStationChallenge(NET, STAKE))).toBe('STATION_UNAVAILABLE');
  });
});

describe('station client: issue', () => {
  const request = { stakeAddress: STAKE, keyId: '2026-11-22', challenge: CHALLENGE, coseSign1: 'aa', coseKey: 'bb', blinded: ['QUJD', 'REVG'] };

  it('returns the blind signatures in order', async () => {
    fetchMock.mockResolvedValue(answer(200, { keyId: '2026-11-22', blindSignatures: ['MTIz', 'NDU2'] }));
    expect(await issueStationVouchers(NET, request)).toEqual(['MTIz', 'NDU2']);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/sponsor\/vouchers$/);
    expect(bodyOf(0)).toEqual(request);
  });

  it('throws the server refusal by its code, without logging in again', async () => {
    fetchMock.mockResolvedValue(answer(403, { code: 'ALREADY_ISSUED' }));
    expect(await codeOf(issueStationVouchers(NET, request))).toBe('ALREADY_ISSUED');
    expect(auth.reauth).not.toHaveBeenCalled();
  });

  it.each([
    ['a different count', { keyId: '2026-11-22', blindSignatures: ['MTIz'] }],
    ['another key', { keyId: '2026-11-23', blindSignatures: ['MTIz', 'NDU2'] }],
    ['a signature that is not base64', { keyId: '2026-11-22', blindSignatures: ['MTIz', '***'] }],
  ])('treats %s as unavailable', async (_name, data) => {
    fetchMock.mockResolvedValue(answer(200, data));
    expect(await codeOf(issueStationVouchers(NET, request))).toBe('STATION_UNAVAILABLE');
  });
});

describe('station client: redeem', () => {
  const request = { keyId: '2026-11-22', message: 'QUJD', signature: 'REVG', signedTxHex: 'c0ffee' };
  const paid = { txHash: `0x${'11'.repeat(32)}`, ledgerTxHash: '22'.repeat(32), status: 'InBlock', blockHeight: 7 };

  it('carries NO device token, no cookies and no referrer', async () => {
    fetchMock.mockResolvedValue(answer(200, paid));
    expect(await redeemStationVoucher(NET, request)).toEqual(paid);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/sponsor\/submit$/);
    expect(headersOf(0)['Authorization']).toBeUndefined();
    expect(Object.keys(headersOf(0)).sort()).toEqual(['Content-Type', 'X-Gero-Client']);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    expect(auth.token).not.toHaveBeenCalled();
    expect(bodyOf(0)).toEqual(request);
  });

  it('throws a refusal by its code and does not repeat it', async () => {
    fetchMock.mockResolvedValue(answer(409, { code: 'VOUCHER_SPENT' }));
    expect(await codeOf(redeemStationVoucher(NET, request))).toBe('VOUCHER_SPENT');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('repeats the same bytes when no answer comes, then reports a lost answer', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(answer(502, 'bad gateway')).mockResolvedValueOnce(answer(200, paid));
    const sent = redeemStationVoucher(NET, request);
    await vi.runAllTimersAsync();
    expect(await sent).toEqual(paid);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(bodyOf(1)).toEqual(bodyOf(0));

    fetchMock.mockReset().mockRejectedValue(new TypeError('Failed to fetch'));
    const lost = codeOf(redeemStationVoucher(NET, request));
    await vi.runAllTimersAsync();
    expect(await lost).toBe('STATION_NO_ANSWER');
    expect(fetchMock).toHaveBeenCalledTimes(STATION_REDEEM_ATTEMPTS);
  });

  it('a paid answer it cannot read is a lost answer, never a refusal', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(answer(200, { txHash: '0x11', status: 'InBlock' }));
    const lost = codeOf(redeemStationVoucher(NET, request));
    await vi.runAllTimersAsync();
    expect(await lost).toBe('STATION_NO_ANSWER');
  });
});
