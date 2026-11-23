import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageTypes } from '@/models/MessageTypes';

const mocks = vi.hoisted(() => ({
  send: vi.fn(), build: vi.fn(), keys: vi.fn(), writesOpen: vi.fn(),
}));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: mocks.send } }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ buildUnshieldedTx: mocks.build }) }));
vi.mock('@/chains/midnight/midnightWriteStatus', () => ({ assertMidnightWritesOpen: mocks.writesOpen }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => `t:${key}` } }));
vi.mock('./midnight-tx.service', () => ({
  getWalletKeys: mocks.keys,
  backgroundError: (error: string | undefined, fallback: string) => new Error(error || fallback),
}));

import { getMidnightStationStatus, sendUnshieldedViaStation } from './midnightStationSend.service';

const request = { fromAddress: 'mn_addr_preprod1sender', outputs: [{ address: 'mn_addr_preprod1to', amount: '5', token: 'NIGHT' }], ttlMs: 1_900_000_000_000 };
const credentials = { password: 'pw' };
const reply = (data: unknown) => ({ data });
const methods = () => mocks.send.mock.calls.map(call => call[0].method);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writesOpen.mockResolvedValue(undefined);
  mocks.keys.mockResolvedValue({ publicKeyHex: 'aa', addressHex: 'bb' });
  mocks.build.mockResolvedValue({ unprovenTxHex: 'c0de', txHash: 'x' });
  mocks.send.mockImplementation(async ({ method }: { method: string }) => {
    if (method === MessageTypes.MIDNIGHT_STATION_SEAL) return reply({ success: true, sealedTxHex: 'beef', txIdentifiers: ['id-1'] });
    if (method === MessageTypes.MIDNIGHT_STATION_REDEEM) {
      return reply({ success: true, txHash: '0xaa', ledgerTxHash: '22'.repeat(32), status: 'InBlock', blockHeight: 9, remaining: 4 });
    }
    return reply({ success: true, available: true, remaining: 2, allowance: 5, thresholdLovelace: '100000000' });
  });
});

describe('fee station status for a page', () => {
  it('passes on counts and a known reason, and nothing else', async () => {
    expect(await getMidnightStationStatus()).toEqual({ available: true, remaining: 2, allowance: 5, reason: undefined, thresholdLovelace: '100000000' });
    mocks.send.mockResolvedValue(reply({ success: true, available: false, remaining: 0, reason: 'NOT_DELEGATED', voucher: 'secret' }));
    expect(await getMidnightStationStatus()).toEqual({ available: false, remaining: 0, allowance: undefined, reason: 'NOT_DELEGATED', thresholdLovelace: undefined });
  });

  it('reads any failure as unavailable', async () => {
    mocks.send.mockResolvedValue(reply({ success: false, error: 'boom' }));
    expect(await getMidnightStationStatus()).toEqual({ available: false, remaining: 0, reason: 'STATION_UNAVAILABLE' });
    mocks.send.mockRejectedValue(new Error('port closed'));
    expect(await getMidnightStationStatus()).toEqual({ available: false, remaining: 0, reason: 'STATION_UNAVAILABLE' });
  });
});

describe('a station-paid send', () => {
  it('builds with Nexus, seals in the worker, redeems, and reports each stage', async () => {
    const stages: string[] = [];
    const result = await sendUnshieldedViaStation('Preprod', request, credentials, stage => stages.push(stage));
    expect(stages).toEqual(['authorizing', 'building', 'working', 'submitting', 'done']);
    expect(mocks.build).toHaveBeenCalledWith({ ...request, publicKeyHex: 'aa', addressHex: 'bb' });
    expect(methods()).toEqual([MessageTypes.MIDNIGHT_STATION_SEAL, MessageTypes.MIDNIGHT_STATION_REDEEM]);
    expect(mocks.send.mock.calls[0][0].data).toEqual({
      unprovenTxHex: 'c0de', intendedOutputs: request.outputs, password: 'pw', prfSecret: undefined,
    });
    // The redeem carries no credential.
    expect(mocks.send.mock.calls[1][0].data).toEqual({ sealedTxHex: 'beef', ttlMs: request.ttlMs });
    expect(result).toEqual({ txHash: '0xaa', ledgerTxHash: '22'.repeat(32), status: 'InBlock', blockHeight: 9, stationRemaining: 4 });
  });

  it('a station refusal while sealing is said in the user\'s language and nothing is redeemed', async () => {
    mocks.send.mockResolvedValueOnce(reply({ success: false, error: 'BELOW_THRESHOLD' }));
    await expect(sendUnshieldedViaStation('Preprod', request, credentials)).rejects.toMatchObject({
      code: 'BELOW_THRESHOLD', message: 't:midnight.station.error.notEligible',
    });
    expect(methods()).toEqual([MessageTypes.MIDNIGHT_STATION_SEAL]);
  });

  it('a refusal at redeem keeps its code; another failure there keeps its own text', async () => {
    mocks.send.mockImplementation(async ({ method }: { method: string }) => (method === MessageTypes.MIDNIGHT_STATION_SEAL
      ? reply({ success: true, sealedTxHex: 'beef', txIdentifiers: ['id-1'] })
      : reply({ success: false, error: 'STATION_NO_ANSWER' })));
    await expect(sendUnshieldedViaStation('Preprod', request, credentials)).rejects.toMatchObject({
      code: 'STATION_NO_ANSWER', message: 't:midnight.station.error.noAnswer',
    });
    mocks.send.mockImplementation(async ({ method }: { method: string }) => (method === MessageTypes.MIDNIGHT_STATION_SEAL
      ? reply({ success: true, sealedTxHex: 'beef', txIdentifiers: ['id-1'] })
      : reply({ success: false, error: 'No Midnight wallet logged in' })));
    await expect(sendUnshieldedViaStation('Preprod', request, credentials)).rejects.toThrow('No Midnight wallet logged in');
  });

  it('stops when the approval goes stale, before each step that follows it', async () => {
    let fresh = true;
    mocks.build.mockImplementation(async () => { fresh = false; return { unprovenTxHex: 'c0de', txHash: 'x' }; });
    await expect(sendUnshieldedViaStation('Preprod', request, credentials, undefined, () => fresh)).rejects.toMatchObject({ name: 'StaleApprovalError' });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('does not start on a network whose writes are paused', async () => {
    mocks.writesOpen.mockRejectedValue(new Error('paused'));
    await expect(sendUnshieldedViaStation('Preprod', request, credentials)).rejects.toThrow('paused');
    expect(mocks.keys).not.toHaveBeenCalled();
  });
});
