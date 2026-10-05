// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDustLightTransport } from './midnightDustLightTransport';
import { getMidnightEndpoints } from './midnightConfig';
import type { DustSyncBlock } from './midnightDustLightSync';

const auth = vi.hoisted(() => ({ token: vi.fn(), refresh: vi.fn() }));
const log = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@/services/nexusDevice.service', () => ({ getNexusAccessToken: auth.token, reauthenticateNexus: auth.refresh }));
describe('DUST projection transport', () => {
  const fetchMock = vi.fn();
  const endpoints = getMidnightEndpoints('Mainnet')!;
  const block = { hash: 'ab'.repeat(32) } as DustSyncBlock;
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(log.warn);
    auth.token.mockResolvedValue('first'); auth.refresh.mockResolvedValue('fresh');
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('resumes the same pinned page after Retry-After without restarting synchronization', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(Response.json({ blockHash: block.hash, transactions: [], nextBlock: 500001 }));
    const result = createDustLightTransport(endpoints, new AbortController().signal).spends(block, ['12'], 250001, 500000);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ transactions: [], nextBlock: 500001 });
    expect(fetchMock.mock.calls[1]).toEqual(fetchMock.mock.calls[0]);
    expect(log.warn).toHaveBeenCalledWith('Midnight DUST projection request rejected', {
      operation: 'spends', status: 429, retryInMs: 2000,
    });
    expect(auth.refresh).not.toHaveBeenCalled();
  });
  it.each([
    ['Thu, 01 Oct 2026 15:00:03 GMT', 3000],
    ['invalid', 1000],
    ['0', 1000],
  ])('waits safely for Retry-After %s', async (header, delay) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T15:00:00Z'));
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': header } }))
      .mockResolvedValueOnce(Response.json({ version: 1 }));
    const result = createDustLightTransport(endpoints, new AbortController().signal).snapshot('public-address');
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ version: 1 });
  });
  it('bounds persistent rate limits and exponential fallback delays', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => Promise.resolve(new Response('', { status: 429 })));
    const result = expect(createDustLightTransport(endpoints, new AbortController().signal).snapshot('public-address'))
      .rejects.toThrow('busy');
    await vi.advanceTimersByTimeAsync(25_000);
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(log.warn.mock.calls.map(call => call[1].retryInMs)).toEqual([1000, 2000, 4000, 8000, 10000, null]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['31', '1' + '0'.repeat(308), '9'.repeat(400)])('does not retry earlier than a long server delay', async header => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': header } }));
    await expect(createDustLightTransport(endpoints, new AbortController().signal).snapshot('public-address'))
      .rejects.toThrow('busy');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops and clears the backoff timer when the shared deadline expires', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '1' } }));
    const controller = new AbortController();
    const result = expect(createDustLightTransport(endpoints, controller.signal).snapshot('public-address'))
      .rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(500);
    controller.abort(new Error('cancelled'));
    await result;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('can refresh an expired token after a rate limit without repeatedly refreshing', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(Response.json({ version: 1 }));
    const result = createDustLightTransport(endpoints, new AbortController().signal).snapshot('public-address');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toEqual({ version: 1 });
    expect(auth.refresh).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer fresh');
  });
  it('does not repeatedly hit an exhausted upstream daily quota', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 402 }));
    await expect(createDustLightTransport(endpoints, new AbortController().signal).snapshot('public-address'))
      .rejects.toThrow('temporarily unavailable');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
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
