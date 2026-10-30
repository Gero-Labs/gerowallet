import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

describe('market-api axios instance', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_NEXUS_URL', 'https://nexus.example.test');
    vi.resetModules();
  });

  it('uses VITE_NEXUS_URL as baseURL', async () => {
    const mod = await import('./market-api');
    expect(mod.marketAxiosInstance.defaults.baseURL).toBe('https://nexus.example.test');
  });

  it('attaches no client-side auth interceptor (auth handled by the backend proxy)', async () => {
    const mod = await import('./market-api');
    const handlers = (mod.marketAxiosInstance.interceptors.request as unknown as { handlers: unknown[] }).handlers;
    expect(handlers.length).toBe(0);
  });
});

describe('market-api launchpad feeds (read from the market host, not the Nexus proxy)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MARKET_API_URL', '');
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const stubGet = (rows: unknown[] = []) => vi.spyOn(axios, 'get').mockResolvedValue({ data: rows });

  it('getSnekFunTokens hits /api/v1/market/snekfun on market.gerowallet.io', async () => {
    const get = stubGet([{ assetId: 'a', source: 'SNEKFUN' }]);
    const { default: api } = await import('./market-api');
    await expect(api.getSnekFunTokens()).resolves.toEqual([{ assetId: 'a', source: 'SNEKFUN' }]);
    expect(get).toHaveBeenCalledWith('https://market.gerowallet.io/api/v1/market/snekfun', { timeout: 15000 });
  });

  it('getSoladaTokens hits /api/v1/market/solada on market.gerowallet.io, without a limit by default', async () => {
    const get = stubGet([{ assetId: 'b', source: 'SOLADA', dex: 'SOLADA' }]);
    const { default: api } = await import('./market-api');
    await expect(api.getSoladaTokens()).resolves.toEqual([{ assetId: 'b', source: 'SOLADA', dex: 'SOLADA' }]);
    expect(get).toHaveBeenCalledWith('https://market.gerowallet.io/api/v1/market/solada', { params: undefined, timeout: 15000 });
  });

  it('getSoladaTokens passes limit through, including 0 (= all)', async () => {
    const get = stubGet();
    const { default: api } = await import('./market-api');
    await api.getSoladaTokens(50);
    await api.getSoladaTokens(0);
    expect(get).toHaveBeenNthCalledWith(1, 'https://market.gerowallet.io/api/v1/market/solada', { params: { limit: 50 }, timeout: 15000 });
    expect(get).toHaveBeenNthCalledWith(2, 'https://market.gerowallet.io/api/v1/market/solada', { params: { limit: 0 }, timeout: 15000 });
  });

  it('honours VITE_MARKET_API_URL for both feeds', async () => {
    vi.stubEnv('VITE_MARKET_API_URL', 'https://market.example.test');
    const get = stubGet();
    const { default: api } = await import('./market-api');
    await api.getSnekFunTokens();
    await api.getSoladaTokens();
    expect(get.mock.calls.map(c => c[0])).toEqual([
      'https://market.example.test/api/v1/market/snekfun',
      'https://market.example.test/api/v1/market/solada',
    ]);
  });
});
