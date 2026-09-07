import { describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { Blockchain, Network, Provider } from '@/models/types';

function setup() {
  const api = new Api({ chain: Blockchain.CARDANO, network: Network.MAINNET }, Provider.BLOCKFROST);
  const get = vi.spyOn(api.axiosInstance, 'get');
  return { api, get };
}

describe('account rewards pagination', () => {
  it('fetches newer epochs beyond the first 100 rewards', async () => {
    const { api, get } = setup();
    const rewards = Array.from({ length: 130 }, (_, i) => ({ epoch: 500 + i, amount: '1000000' }));
    get.mockResolvedValueOnce({ status: 200, data: rewards.slice(0, 100) });
    get.mockResolvedValueOnce({ status: 200, data: rewards.slice(100) });

    expect(await api.getAccountRewards('stake1test')).toEqual(rewards);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0][0]).toContain('&page=1&size=100');
    expect(get.mock.calls[1][0]).toContain('&page=2&size=100');
  });

  it('rejects a failed later page instead of reporting old, partial history as complete', async () => {
    const { api, get } = setup();
    get.mockResolvedValueOnce({
      status: 200,
      data: Array.from({ length: 100 }, (_, epoch) => ({ epoch, amount: '1000000' })),
    });
    get.mockRejectedValueOnce(new Error('offline'));

    await expect(api.getAccountRewards('stake1test')).rejects.toBeDefined();
    expect(get).toHaveBeenCalledTimes(2);
  });
});
