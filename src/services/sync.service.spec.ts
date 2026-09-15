import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncService } from './sync.service';
import type { WalletBg } from '@/chrome/walletBg';
import { Blockchain } from '@/models/types';

vi.mock('@/api/api', () => ({ Api: class {} }));
vi.mock('@/api/blockchain-api', () => ({ default: {} }));
vi.mock('@/chrome/walletBg', () => ({ WalletBg: class {} }));
vi.mock('@cardano-sdk/core', () => ({ Serialization: {} }));
vi.mock('@/stores/loading', () => ({ default: {} }));
vi.mock('@/stores/networkStore', () => ({ default: { setTip: vi.fn() } }));
vi.mock('@/stores/walletStore', () => ({ default: { state: {} }, walletStore: {} }));
vi.mock('@/services/websocket.service', () => ({ default: {} }));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));

function setup(chain = Blockchain.CARDANO, enterprise = false) {
  const rows = new Map([[600, { epoch: 600, amount: '1000000' }]]);
  const api = { getAccountRewards: vi.fn().mockResolvedValue([{ epoch: 630, amount: '2000000' }]) };
  const wallet = {
    chain,
    stakeAddress: 'stake1test',
    api,
    isEnterpriseAddress: () => enterprise,
    setAccountInfo: vi.fn().mockResolvedValue(undefined),
    setLastSyncInfo: vi.fn().mockResolvedValue(undefined),
    setAccountRewards: vi.fn(async (rewards: Array<{ epoch: number; amount: string }>) => {
      rewards.forEach(reward => rows.set(reward.epoch, reward));
    }),
    getAccountInfo: vi.fn().mockResolvedValue({ controlled_amount: '0' }),
  };
  const service = new SyncService(wallet as unknown as WalletBg);
  vi.spyOn(service, 'healMissingTxCbor').mockResolvedValue();
  const push = (epoch = 632, rewardsSum = '3000000') => service.setSync({
    type: 'SYNC',
    block: { epoch, height: 100, hash: 'tip' },
    account: { controlled_amount: '10000000', rewards_sum: rewardsSum },
  });
  return { service, wallet, api, rows, push };
}

async function flushRefresh() {
  // Refresh runs independently of block processing; settle its promises.
  await vi.advanceTimersByTimeAsync(0);
}

describe('reward history during WebSocket sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T12:00:00Z'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('repairs 30-epoch-old history on first sync without transactions or a balance change', async () => {
    const { rows, push, api } = setup();
    await push();
    await flushRefresh();
    expect([...rows.keys()]).toEqual([600, 630]);
    await push();
    vi.advanceTimersByTime(60_000);
    await push();
    expect(api.getAccountRewards).toHaveBeenCalledTimes(1);
  });

  it('refreshes on epoch and reward-sum changes, including keep-alives with no account', async () => {
    const { push, service, api } = setup();
    await push();
    await flushRefresh();
    vi.advanceTimersByTime(60_000);
    await service.setSync({ type: 'SYNC', block: { epoch: 633, height: 101 } });
    await flushRefresh();
    vi.advanceTimersByTime(60_000);
    await push(633, '4000000');
    await flushRefresh();
    expect(api.getAccountRewards).toHaveBeenCalledTimes(3);
  });

  it('checks again within the same epoch for delayed provider indexing', async () => {
    const { push, api } = setup();
    await push();
    await flushRefresh();
    vi.advanceTimersByTime(3_600_000);
    await push();
    await flushRefresh();
    expect(api.getAccountRewards).toHaveBeenCalledTimes(2);
  });

  it('coalesces overlapping requests and does not block tip processing', async () => {
    const { push, api, wallet } = setup();
    let resolve!: (rows: unknown[]) => void;
    api.getAccountRewards.mockReturnValue(new Promise(r => { resolve = r; }));
    await push();
    vi.advanceTimersByTime(3_600_000);
    await push();
    expect(wallet.setLastSyncInfo).toHaveBeenCalledTimes(2);
    expect(api.getAccountRewards).toHaveBeenCalledTimes(1);
    resolve([]);
    await flushRefresh();
  });

  it.each(['fetch', 'save'])('retries a failed %s without changing the existing history', async (failure) => {
    const { push, api, wallet, rows } = setup();
    if (failure === 'fetch') api.getAccountRewards.mockRejectedValueOnce(new Error('offline'));
    else wallet.setAccountRewards.mockRejectedValueOnce(new Error('database unavailable'));
    await push();
    await flushRefresh();
    expect([...rows.keys()]).toEqual([600]);
    await push();
    expect(api.getAccountRewards).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    await push();
    await flushRefresh();
    expect([...rows.keys()]).toEqual([600, 630]);
    expect(api.getAccountRewards).toHaveBeenCalledTimes(2);
  });

  it('waits for reward writes before recording a successful refresh', async () => {
    const { push, api, wallet } = setup();
    let save!: () => void;
    wallet.setAccountRewards.mockReturnValueOnce(new Promise<void>(resolve => { save = resolve; }));
    await push();
    await flushRefresh();
    vi.advanceTimersByTime(3_600_000);
    await push();
    expect(api.getAccountRewards).toHaveBeenCalledTimes(1);
    save();
    await flushRefresh();
    await push();
    expect(api.getAccountRewards).toHaveBeenCalledTimes(1);
  });

  it.each([Blockchain.BITCOIN, Blockchain.MIDNIGHT])('skips non-staking chain %s', async (chain) => {
    const { push, api } = setup(chain);
    await push();
    expect(api.getAccountRewards).not.toHaveBeenCalled();
  });

  it('skips enterprise wallets', async () => {
    const { push, api } = setup(Blockchain.CARDANO, true);
    await push();
    expect(api.getAccountRewards).not.toHaveBeenCalled();
  });
});
