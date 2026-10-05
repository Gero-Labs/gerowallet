import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fake axios instance: `getDustDestination` should reach for `get` on it and nothing else.
const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  const instance = {
    get: mocks.get,
    post: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  };
  return { ...actual, default: { ...actual.default, create: () => instance } };
});
vi.mock('@/services/nexusDevice.service', () => ({
  getNexusAccessToken: vi.fn(async () => 'token'),
  reauthenticateNexus: vi.fn(),
}));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));

import { AxiosError } from 'axios';
import { DustDestinationUnsupportedError, getMidnightApi } from './midnight-api';

const DUST = 'mn_dust1wwm5tk7ufsg9drn9wtm8yjzcz9wqsj42m4jjuqufpurqp2rcf075xxue5e8';
const wire = {
  dust_address: DUST, registered: true,
  night_balance: '302845520001', generation_rate: '2503623913848267',
  max_capacity: '1514227600005000000000', current_capacity: '1506161627796405652128',
  stakes: [{ cardano_reward_address: 'stake1u8khnvaen7p4u6ym3889y0hplv0gs0h6ngh9hvlmh2h4fzg8wgj75', state: 'active' }],
};

function httpError(status: number): AxiosError {
  return new AxiosError(`HTTP ${status}`, 'ERR_BAD_REQUEST', undefined, undefined,
    { status, data: {}, statusText: '', headers: {}, config: {} as never });
}

describe('MidnightApi.getDustDestination', () => {
  beforeEach(() => { mocks.get.mockReset(); });

  it('asks Nexus for the destination by dust address and converts the answer', async () => {
    mocks.get.mockResolvedValue({ status: 200, data: wire });

    const result = await getMidnightApi('Mainnet').getDustDestination(DUST);

    expect(result.nightBalance).toBe('302845520001');
    expect(result.stakes[0].state).toBe('active');
    const url = mocks.get.mock.calls[0][0] as string;
    expect(url).toContain('/api/midnight/midnight-mainnet/dust/destination');
    expect(url).toContain(`?dustAddress=${encodeURIComponent(DUST)}`);
  });

  it.each([404, 501])('throws the typed "unsupported" error when Nexus answers %i', async (status) => {
    mocks.get.mockRejectedValue(httpError(status));

    const failure = await getMidnightApi('Mainnet').getDustDestination(DUST).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(DustDestinationUnsupportedError);
    expect((failure as DustDestinationUnsupportedError).status).toBe(status);
  });

  it.each([500, 502, 503, 400])('does NOT call %i unsupported: it stays an ordinary failure', async (status) => {
    mocks.get.mockRejectedValue(httpError(status));

    const failure = await getMidnightApi('Mainnet').getDustDestination(DUST).catch((e: unknown) => e);

    expect(failure).not.toBeInstanceOf(DustDestinationUnsupportedError);
    expect(JSON.parse(failure as string).status).toBe(status);
  });

  it('does NOT call a network failure unsupported', async () => {
    mocks.get.mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK', undefined, {}));

    const failure = await getMidnightApi('Mainnet').getDustDestination(DUST).catch((e: unknown) => e);

    expect(failure).not.toBeInstanceOf(DustDestinationUnsupportedError);
  });

  it('rejects a malformed 200 as an Error, not a confident zero', async () => {
    mocks.get.mockResolvedValue({ status: 200, data: { ...wire, night_balance: undefined } });

    await expect(getMidnightApi('Mainnet').getDustDestination(DUST))
      .rejects.toThrow('Invalid Midnight DUST destination response');
  });
});
