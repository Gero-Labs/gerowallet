// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDustLightTransport } from './midnightDustLightTransport';
import { getMidnightEndpoints } from './midnightConfig';
import type { DustSyncBlock } from './midnightDustLightSync';

const auth = vi.hoisted(() => ({ token: vi.fn(), refresh: vi.fn() }));
vi.mock('@/services/nexusDevice.service', () => ({ getNexusAccessToken: auth.token, reauthenticateNexus: auth.refresh }));
describe('DUST projection transport', () => {
  const fetchMock = vi.fn();
  const endpoints = getMidnightEndpoints('Mainnet')!;
  const block = { hash: 'ab'.repeat(32) } as DustSyncBlock;
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubGlobal('fetch', fetchMock);
    auth.token.mockResolvedValue('first'); auth.refresh.mockResolvedValue('fresh');
  });
  afterEach(() => vi.unstubAllGlobals());
  it('retries once after token expiry and sends only public projection fields', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(Response.json({ blockHash: block.hash, transactions: [], nextBlock: null }));
    const signal = new AbortController().signal;
    await createDustLightTransport(endpoints, signal).spends(block, ['12'], 0, 100);
    expect(auth.refresh).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[1]).toEqual([expect.stringContaining('/midnight-mainnet/dust/light-sync'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fresh' },
      body: JSON.stringify({ operation: 'spends', blockHash: block.hash, prefixes: ['12'], fromBlock: 0, toBlock: 100 }), signal,
    }]);
  });
  it('rejects a different pinned block', async () => {
    fetchMock.mockResolvedValue(Response.json({ blockHash: 'cd'.repeat(32), updates: [] }));
    await expect(createDustLightTransport(endpoints, new AbortController().signal).commitments(block, []))
      .rejects.toThrow('snapshot mismatch');
  });
  it('stops waiting when shared authentication stalls', async () => {
    auth.token.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const result = expect(createDustLightTransport(endpoints, controller.signal).snapshot('public-address')).rejects.toThrow('cancelled');
    controller.abort(new Error('cancelled'));
    await result;
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('fails promptly on unavailable service without retrying a replay path', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    await expect(createDustLightTransport(endpoints, new AbortController().signal).snapshot('public-address'))
      .rejects.toThrow('temporarily unavailable');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
