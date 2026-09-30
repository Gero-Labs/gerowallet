import { describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';
import { Api } from './api';
import { Blockchain, Network, Provider } from '@/models/types';

function setup(status: number) {
  const api = new Api({ chain: Blockchain.CARDANO, network: Network.PREPROD }, Provider.KOIOS);
  const error = new AxiosError('Request failed', undefined, undefined, undefined, { status } as AxiosError['response']);
  vi.spyOn(api.axiosInstance, 'get').mockRejectedValue(error);
  return api;
}

describe('stake account lookup', () => {
  it.each([true, false])('preserves a successful account record with active:%s', async active => {
    const api = setup(404);
    const account = { active, pool_id: null, drep_id: null, withdrawable_amount: '0' };
    vi.mocked(api.axiosInstance.get).mockResolvedValue({ status: 200, data: account });
    await expect(api.getAccountInfo('stake_test1test', true)).resolves.toBe(account);
  });

  it('treats a missing stake account as unregistered only when preflight opts in', async () => {
    const api = setup(404);
    await expect(api.getAccountInfo('stake_test1test', true)).resolves.toMatchObject({ active: false, pool_id: null, drep_id: null });
    await expect(api.getAccountInfo('stake_test1test')).rejects.toContain('404');
  });

  it.each([400, 429, 500, 503])('does not interpret HTTP %i as an unregistered key', async status => {
    await expect(setup(status).getAccountInfo('stake_test1test', true)).rejects.toContain(String(status));
  });

  it('does not interpret a timeout as an unregistered key', async () => {
    const api = setup(404);
    vi.mocked(api.axiosInstance.get).mockRejectedValue(new AxiosError('timeout', 'ECONNABORTED'));
    await expect(api.getAccountInfo('stake_test1test', true)).rejects.toContain('timeout');
  });
});
