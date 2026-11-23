import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { Blockchain, Network } from '@/models/types';
import networks from '@/utils/networks';
import { checkHolderAnswers } from './holderAnswers';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('axios', () => ({ default: { create: vi.fn(() => ({ get, post })) } }));

const stake = 'stake_test1example';
const hash = 'aa'.repeat(32);
const reg = 'bb'.repeat(32);
const action = { txHash: hash, index: 1 };
const proposal = { proposal_tx_hash: hash, proposal_index: 1, block_time: 100, expiration: 12,
  ratified_epoch: null, enacted_epoch: null, dropped_epoch: null, expired_epoch: null };
const tip = { abs_slot: 4_751_990, epoch_slot: 431_990, epoch_no: 10, block_time: 1_798_000_000 };
const change = (action_type: string, block_time: number, tx_hash = reg) => ({ action_type, block_time, tx_hash });
const read = (network = Network.PREPROD) => checkHolderAnswers(stake, network, [action]);
const account = (updates: ReturnType<typeof change>[]) => [{ stake_address: stake, updates }];
function replies(proposals = [proposal], accounts = account([change('registration', 90)]), chainTip = tip) {
  get.mockImplementation(async (url: string) => ({ data: url === '/tip' ? [chainTip] : proposals }));
  post.mockResolvedValue({ data: accounts });
}
function mockSlotTiming(slotTiming?: { slotLengthMs: number; slotsPerEpoch: number }) {
  const preprod = networks.resolveNetwork(Blockchain.CARDANO, Network.PREPROD);
  vi.spyOn(networks, 'resolveNetwork').mockReturnValueOnce({
    ...preprod, networkParams: { ...preprod.networkParams, slotTiming },
  });
}
beforeEach(() => { vi.clearAllMocks(); replies(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('holder answer eligibility at review', () => {
  it.each([
    [Network.MAINNET, 'https://api.koios.rest/api/v1'],
    [Network.PREPROD, 'https://preprod.koios.rest/api/v1'],
  ])('accepts a continuously registered key and caps validity at the next epoch on %s', async (network, baseURL) => {
    const result = await read(network);
    expect(result).toEqual({ blocked: [], slot: tip.abs_slot, invalidHereafter: tip.abs_slot + 10,
      expiresAt: (tip.block_time + 10) * 1000 });
    expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({ baseURL }));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('uses one hour from the block timestamp when the next epoch is more than an hour away', async () => {
    get.mockImplementation(async (url: string) => ({ data: url === '/tip' ? [{ ...tip, epoch_slot: 50 }] : [proposal] }));
    expect(await read()).toMatchObject({ invalidHereafter: tip.abs_slot + 3600, expiresAt: (tip.block_time + 3600) * 1000 });
  });

  it.each([
    { slotLengthMs: 2_000, slotsPerEpoch: 100, epochSlot: 98, expectedSlots: 2, expectedMs: 4_000 },
    { slotLengthMs: 7_000, slotsPerEpoch: 10_000, epochSlot: 1, expectedSlots: 514, expectedMs: 3_598_000 },
    { slotLengthMs: 500, slotsPerEpoch: 10_000, epochSlot: 1, expectedSlots: 3_600, expectedMs: 1_800_000 },
  ])('uses the configured $slotLengthMs ms slots for both ledger and review expiry', async config => {
    mockSlotTiming({ slotLengthMs: config.slotLengthMs, slotsPerEpoch: config.slotsPerEpoch });
    replies(undefined, undefined, { ...tip, epoch_slot: config.epochSlot });
    expect(await read()).toMatchObject({ invalidHereafter: tip.abs_slot + config.expectedSlots,
      expiresAt: tip.block_time * 1_000 + config.expectedMs });
  });

  it.each([undefined, { slotLengthMs: 0, slotsPerEpoch: 432_000 }])('refuses missing or invalid timing', async timing => {
    mockSlotTiming(timing);
    await expect(read()).rejects.toThrow('Invalid network slot timing');
    expect(axios.create).not.toHaveBeenCalled();
  });

  it.each([
    [],
    [change('delegation_pool', 90)],
    [change('registration', 101)],
    [change('registration', 80), change('deregistration', 95)],
    [change('registration', 101), change('deregistration', 100), change('registration', 90)],
  ])('requires uninterrupted registration before submission', async (...updates) => {
    replies([proposal], account(updates));
    expect((await read()).blocked[0].reason).toBe('governance.holderRegistration');
  });

  it('orders earlier transactions in the proposal block and rejects registration in the proposal transaction itself', async () => {
    const cert = (type: string, index: number) => ({ type, index, info: { stake_address: stake } });
    const updates = account([change('registration', 100), change('deregistration', 100)]);
    const latestTx = { tx_hash: reg, tx_block_index: 3,
      certificates: [cert('stake_registration', 1), cert('stake_deregistration', 0)] };
    post.mockResolvedValueOnce({ data: updates }).mockResolvedValueOnce({ data: [
      latestTx, { tx_hash: hash, tx_block_index: 4, certificates: [] },
    ] });
    expect((await read()).blocked).toEqual([]);
    post.mockResolvedValueOnce({ data: account([change('registration', 100, hash)]) })
      .mockResolvedValueOnce({ data: [{ ...latestTx, tx_hash: hash }] });
    expect((await read()).blocked[0].reason).toBe('governance.holderRegistration');
  });

  it('keeps ratified actions open through their ratification epoch, limited by expiry and removal', async () => {
    replies([{ ...proposal, ratified_epoch: 10 }]);
    expect((await read()).blocked).toEqual([]);
    for (const p of [{ ratified_epoch: 9 }, { expiration: 10 }, { enacted_epoch: 10 }, { dropped_epoch: 10 }, { expired_epoch: 10 }]) {
      replies([{ ...proposal, ...p }]);
      expect((await read()).blocked[0].reason).toBe('governance.holderClosed');
    }
  });

  it('rejects a key re-registered after the proposal in its block, regardless of response order', async () => {
    const deregister = 'cc'.repeat(32);
    post.mockResolvedValueOnce({ data: account([
      change('registration', 100, reg), change('deregistration', 100, deregister), change('registration', 70),
    ]) }).mockResolvedValueOnce({ data: [
      { tx_hash: reg, tx_block_index: 4, certificates: [{ type: 'stake_registration', index: 0, info: { stake_address: stake } }] },
      { tx_hash: hash, tx_block_index: 3, certificates: [] },
      { tx_hash: deregister, tx_block_index: 2, certificates: [] },
    ] });
    expect((await read()).blocked).toEqual([{ id: `${hash}#1`, reason: 'governance.holderRegistration' }]);
  });

  it('names the closed action in a mixed batch', async () => {
    const second = { ...action, index: 2 };
    const result = await checkHolderAnswers(stake, 'Preprod', [action, second]);
    expect(result.blocked).toEqual([{ id: `${hash}#2`, reason: 'governance.holderClosed' }]);
  });

  it('checks selections from multiple pages using bounded URLs and one stake history', async () => {
    const ids = Array.from({ length: 105 }, (_, n) => ({ txHash: n.toString(16).padStart(64, '0'), index: 1 }));
    const requests: string[][] = [];
    get.mockImplementation(async (url: string, { params }) => {
      if (url === '/tip') return { data: [tip] };
      const hashes = params.proposal_tx_hash.slice(4, -1).split(',');
      requests.push(hashes);
      return { data: hashes.map((proposal_tx_hash: string) => ({ ...proposal, proposal_tx_hash })) };
    });
    expect((await checkHolderAnswers(stake, 'Preprod', ids)).blocked).toEqual([]);
    expect(requests.map(page => page.length)).toEqual([50, 50, 5]);
    expect(requests.flat()).toEqual(ids.map(id => id.txHash));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('fails closed on an unsupported network, indeterminate history or malformed lifecycle data', async () => {
    await expect(checkHolderAnswers(stake, 'Testnet', [action])).rejects.toThrow();
    expect(axios.create).not.toHaveBeenCalled();
    post.mockRejectedValueOnce(new Error('offline'));
    await expect(read()).rejects.toThrow();
    replies([{ ...proposal, expiration: null }]);
    await expect(read()).rejects.toThrow();
  });
});
