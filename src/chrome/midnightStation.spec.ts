// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RSABSSA } from '@cloudflare/blindrsa-ts';
import { Network } from '@/models/types';
import { resetPrivateStoreForTest } from '@/utils/privateStore';
import { MidnightStationError } from '@/chains/midnight/midnightStationConfig';
import { countFreeVouchers, utcDay } from '@/chains/midnight/midnightStationVouchers';
import {
  ensureStationVouchers, forgetSealedForStationForTests, midnightStationStatus, redeemSealedWithStation,
  rememberSealedForStation, type StationDeps,
} from './midnightStation';

vi.mock('@/services/nexusDevice.service', () => ({ getNexusAccessToken: vi.fn(), reauthenticateNexus: vi.fn() }));

const suite = RSABSSA.SHA384.PSS.Randomized();
const NET = Network.PREPROD;
const STAKE = 'stake_test1uexample';
const NOW = Date.now();
const TODAY = utcDay(NOW);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const raw = (text: string) => Uint8Array.from(Buffer.from(text, 'base64'));
const paid = { txHash: '0xaa', ledgerTxHash: '22'.repeat(32), status: 'InBlock' as const };

let serverKey: CryptoKey;
let publicKey: string;
beforeAll(async () => {
  const pair = await suite.generateKey({ publicExponent: Uint8Array.from([1, 0, 1]), modulusLength: 2048 });
  serverKey = pair.privateKey;
  publicKey = b64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)));
});

const challenge = () => ({
  eligible: true, allowance: 3, thresholdLovelace: '100000000', challenge: 'ab'.repeat(32),
  expiresAt: NOW + 60_000, keyId: TODAY, publicKey,
});
const client = {
  fetchStationChallenge: vi.fn(),
  issueStationVouchers: vi.fn(),
  redeemStationVoucher: vi.fn(),
};
const deps: StationDeps = { now: () => NOW, client };
const sign = vi.fn(async (subject: string) => ({ coseSign1: 'aa', coseKey: 'bb', stakeAddress: STAKE, subject }));

beforeEach(async () => {
  vi.clearAllMocks();
  resetPrivateStoreForTest();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('gero-private-store');
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  client.fetchStationChallenge.mockImplementation(async () => challenge());
  client.issueStationVouchers.mockImplementation(async (_network: string, request: { blinded: string[] }) =>
    Promise.all(request.blinded.map(async item => b64(await suite.blindSign(serverKey, raw(item))))));
  client.redeemStationVoucher.mockResolvedValue(paid);
});

describe('fee station status', () => {
  it('is off for a network outside the build list, without calling the server', async () => {
    expect(await midnightStationStatus(Network.MAINNET, STAKE, deps)).toEqual({ available: false, remaining: 0, reason: 'STATION_OFF' });
    expect(client.fetchStationChallenge).not.toHaveBeenCalled();
  });

  it('needs the Cardano twin stake address', async () => {
    expect(await midnightStationStatus(NET, undefined, deps)).toEqual({ available: false, remaining: 0, reason: 'NO_TWIN' });
  });

  it('asks the server only while no voucher is held', async () => {
    expect(await midnightStationStatus(NET, STAKE, deps)).toEqual({ available: true, remaining: 0, allowance: 3, thresholdLovelace: '100000000' });
    await ensureStationVouchers(NET, STAKE, sign, deps);
    client.fetchStationChallenge.mockClear();
    expect(await midnightStationStatus(NET, STAKE, deps)).toEqual({ available: true, remaining: 3 });
    expect(client.fetchStationChallenge).not.toHaveBeenCalled();
  });

  it('says why a stake account is not eligible, and reads a failure as unavailable', async () => {
    client.fetchStationChallenge.mockResolvedValue({ ...challenge(), eligible: false, reason: 'NOT_DELEGATED' });
    expect(await midnightStationStatus(NET, STAKE, deps)).toMatchObject({ available: false, reason: 'NOT_DELEGATED', thresholdLovelace: '100000000' });
    client.fetchStationChallenge.mockRejectedValue(new MidnightStationError('STATION_UNAVAILABLE'));
    expect(await midnightStationStatus(NET, STAKE, deps)).toEqual({ available: false, remaining: 0, reason: 'STATION_UNAVAILABLE' });
  });
});

describe('issuing a batch', () => {
  it('signs the challenge subject, sends only blinded messages, stores the day\'s vouchers', async () => {
    await ensureStationVouchers(NET, STAKE, sign, deps);
    expect(sign).toHaveBeenCalledWith(`gero-station/v1|ISSUE|midnight-preprod|${TODAY}|${'ab'.repeat(32)}|${STAKE}`);
    const request = client.issueStationVouchers.mock.calls[0][1];
    expect(request).toMatchObject({ stakeAddress: STAKE, keyId: TODAY, challenge: 'ab'.repeat(32), coseSign1: 'aa', coseKey: 'bb' });
    expect(request.blinded).toHaveLength(3);
    expect(await countFreeVouchers(NET, STAKE, NOW)).toBe(3);
  });

  it('does nothing while a voucher is held: no challenge, no signature', async () => {
    await ensureStationVouchers(NET, STAKE, sign, deps);
    vi.clearAllMocks();
    await ensureStationVouchers(NET, STAKE, sign, deps);
    expect(client.fetchStationChallenge).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it('stops before signing when the account is not eligible, the key is stale or the challenge has expired', async () => {
    client.fetchStationChallenge.mockResolvedValue({ ...challenge(), eligible: false, reason: 'BELOW_THRESHOLD' });
    await expect(ensureStationVouchers(NET, STAKE, sign, deps)).rejects.toMatchObject({ code: 'BELOW_THRESHOLD' });
    client.fetchStationChallenge.mockResolvedValue({ ...challenge(), keyId: '2020-01-01' });
    await expect(ensureStationVouchers(NET, STAKE, sign, deps)).rejects.toMatchObject({ code: 'STATION_UNAVAILABLE' });
    client.fetchStationChallenge.mockResolvedValue({ ...challenge(), expiresAt: NOW - 1 });
    await expect(ensureStationVouchers(NET, STAKE, sign, deps)).rejects.toMatchObject({ code: 'STATION_UNAVAILABLE' });
    expect(sign).not.toHaveBeenCalled();
  });

  it('refuses a proof for another stake address, and vouchers that do not verify', async () => {
    sign.mockResolvedValueOnce({ coseSign1: 'aa', coseKey: 'bb', stakeAddress: 'stake_test1uother', subject: '' });
    await expect(ensureStationVouchers(NET, STAKE, sign, deps)).rejects.toMatchObject({ code: 'NO_TWIN' });
    expect(client.issueStationVouchers).not.toHaveBeenCalled();
    client.issueStationVouchers.mockResolvedValue(['AAAA', 'AAAA', 'AAAA']);
    await expect(ensureStationVouchers(NET, STAKE, sign, deps)).rejects.toMatchObject({ code: 'STATION_UNAVAILABLE' });
    expect(await countFreeVouchers(NET, STAKE, NOW)).toBe(0);
  });
});

describe('redeeming', () => {
  const TTL = NOW + 300_000;
  beforeEach(async () => {
    forgetSealedForStationForTests();
    await ensureStationVouchers(NET, STAKE, sign, deps);
    // What the SEAL handler does once it has sealed a transaction for this wallet.
    rememberSealedForStation(NET, STAKE, ['id-1'], NOW);
  });

  it('spends one voucher for the transaction and reports how many are left', async () => {
    const result = await redeemSealedWithStation(NET, STAKE, 'c0ffee', ['id-1'], TTL, deps);
    expect(result).toEqual({ ...paid, remaining: 2 });
    expect(client.redeemStationVoucher.mock.calls[0][1]).toMatchObject({ keyId: TODAY, signedTxHex: 'c0ffee' });
  });

  it('a spent or invalid voucher is dropped and the next one is tried', async () => {
    client.redeemStationVoucher.mockRejectedValueOnce(new MidnightStationError('VOUCHER_SPENT'));
    const result = await redeemSealedWithStation(NET, STAKE, 'c0ffee', ['id-1'], TTL, deps);
    expect(result.remaining).toBe(1);
    expect(client.redeemStationVoucher).toHaveBeenCalledTimes(2);
    expect(client.redeemStationVoucher.mock.calls[1][1].message).not.toBe(client.redeemStationVoucher.mock.calls[0][1].message);
  });

  it('a refusal gives the voucher back', async () => {
    client.redeemStationVoucher.mockRejectedValue(new MidnightStationError('STATION_BUSY'));
    await expect(redeemSealedWithStation(NET, STAKE, 'c0ffee', ['id-1'], TTL, deps)).rejects.toMatchObject({ code: 'STATION_BUSY' });
    expect(await countFreeVouchers(NET, STAKE, NOW)).toBe(3);
  });

  it('a lost answer keeps the voucher held for that transaction, and a repeat reuses it', async () => {
    client.redeemStationVoucher.mockRejectedValueOnce(new MidnightStationError('STATION_NO_ANSWER'));
    await expect(redeemSealedWithStation(NET, STAKE, 'c0ffee', ['id-1'], TTL, deps)).rejects.toMatchObject({ code: 'STATION_NO_ANSWER' });
    expect(await countFreeVouchers(NET, STAKE, NOW)).toBe(2);
    await redeemSealedWithStation(NET, STAKE, 'c0ffee', ['id-1'], TTL, deps);
    expect(client.redeemStationVoucher.mock.calls[1][1].message).toBe(client.redeemStationVoucher.mock.calls[0][1].message);
  });

  it('needs an identifier and a voucher', async () => {
    await expect(redeemSealedWithStation(NET, STAKE, 'c0ffee', [], TTL, deps)).rejects.toMatchObject({ code: 'TX_NOT_ELIGIBLE' });
    rememberSealedForStation(NET, 'stake_test1uother', ['id-2'], NOW);
    await expect(redeemSealedWithStation(NET, 'stake_test1uother', 'c0ffee', ['id-2'], TTL, deps)).rejects.toMatchObject({ code: 'STATION_NO_VOUCHER' });
  });

  it('spends a voucher only on a transaction this worker sealed for this wallet, and not long after', async () => {
    // Never sealed here.
    await expect(redeemSealedWithStation(NET, STAKE, 'c0ffee', ['id-9'], TTL, deps)).rejects.toMatchObject({ code: 'SEAL_UNKNOWN' });
    // Sealed here, for another wallet's stake address.
    await expect(redeemSealedWithStation(NET, 'stake_test1uother', 'c0ffee', ['id-1'], TTL, deps)).rejects.toMatchObject({ code: 'SEAL_UNKNOWN' });
    // Sealed here, too long ago.
    const later: StationDeps = { ...deps, now: () => NOW + 10 * 60_000 };
    await expect(redeemSealedWithStation(NET, STAKE, 'c0ffee', ['id-1'], TTL, later)).rejects.toMatchObject({ code: 'SEAL_UNKNOWN' });
    expect(client.redeemStationVoucher).not.toHaveBeenCalled();
    expect(await countFreeVouchers(NET, STAKE, NOW)).toBe(3);
  });

  it('forgets a sealed transaction once it is paid: the same bytes are not redeemed twice', async () => {
    await redeemSealedWithStation(NET, STAKE, 'c0ffee', ['id-1'], TTL, deps);
    await expect(redeemSealedWithStation(NET, STAKE, 'c0ffee', ['id-1'], TTL, deps)).rejects.toMatchObject({ code: 'SEAL_UNKNOWN' });
    expect(client.redeemStationVoucher).toHaveBeenCalledOnce();
  });
});
