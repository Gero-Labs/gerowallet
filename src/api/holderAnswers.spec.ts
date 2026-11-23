import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { checkHolderAnswers } from './holderAnswers';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('axios', () => ({ default: { create: vi.fn(() => ({ get, post })) } }));

const stake = 'stake_test1example';
const hash = 'aa'.repeat(32);
const reg = 'bb'.repeat(32);
const action = { txHash: hash, index: 1 };
const proposal = { proposal_tx_hash: hash, proposal_index: 1, block_time: 100, expiration: 12,
  ratified_epoch: null, enacted_epoch: null, dropped_epoch: null, expired_epoch: null };
const tip = { abs_slot: 4_751_990, epoch_slot: 431_990, epoch_no: 10 };
const change = (action_type: string, block_time: number, tx_hash = reg) => ({ action_type, block_time, tx_hash });
const read = () => checkHolderAnswers(stake, 'Preprod', [action]);
const account = (updates: ReturnType<typeof change>[]) => [{ stake_address: stake, updates }];
function replies(proposals = [proposal], accounts = account([change('registration', 90)])) {
  get.mockImplementation(async (url: string) => ({ data: url === '/tip' ? [tip] : proposals }));
  post.mockResolvedValue({ data: accounts });
}
beforeEach(() => { vi.clearAllMocks(); replies(); });

describe('holder answer eligibility at review', () => {
  it('accepts a continuously registered key with no delegation and caps validity at the next epoch', async () => {
    const result = await read();
    expect(result).toEqual({ blocked: [], slot: tip.abs_slot, invalidHereafter: tip.abs_slot + 10 });
    expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://preprod.koios.rest/api/v1' }));
    expect(post).toHaveBeenCalledTimes(1);
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

  it('fails closed on an unsupported network, indeterminate history or malformed lifecycle data', async () => {
    await expect(checkHolderAnswers(stake, 'Testnet', [action])).rejects.toThrow();
    expect(axios.create).not.toHaveBeenCalled();
    post.mockRejectedValueOnce(new Error('offline'));
    await expect(read()).rejects.toThrow();
    replies([{ ...proposal, expiration: null }]);
    await expect(read()).rejects.toThrow();
  });
});
