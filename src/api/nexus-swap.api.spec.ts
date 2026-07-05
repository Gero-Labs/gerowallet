// src/api/nexus-swap.api.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('nexus-swap aggregator client', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_NEXUS_URL', 'https://nexus.example.test');
    vi.resetModules();
  });

  it('uses VITE_NEXUS_URL as baseURL', async () => {
    const mod = await import('./nexus-swap.api');
    expect(mod.swapAxiosInstance.defaults.baseURL).toBe('https://nexus.example.test');
  });

  it('quote() posts to /api/aggregator/quote and returns routes', async () => {
    const mod = await import('./nexus-swap.api');
    const spy = vi.spyOn(mod.swapAxiosInstance, 'post').mockResolvedValue({
      data: { routes: [{ dex: 'MINSWAP', tokenIn: 'lovelace', tokenOut: 'abc', amountIn: '100', expectedOutput: '900', minimumOutput: '880' }], bestRouteIndex: 0 },
    } as never);
    const res = await mod.nexusSwapApi.quote({ tokenIn: 'lovelace', tokenOut: 'abc', amountIn: '100' });
    expect(spy).toHaveBeenCalledWith('/api/aggregator/quote', { tokenIn: 'lovelace', tokenOut: 'abc', amountIn: '100' });
    expect(res.routes[0].minimumOutput).toBe('880');
    expect(res.bestRouteIndex).toBe(0);
  });

  it('buildTx() posts the route + utxos and returns the opaque unsignedTxCbor', async () => {
    const mod = await import('./nexus-swap.api');
    const spy = vi.spyOn(mod.swapAxiosInstance, 'post').mockResolvedValue({
      data: { unsignedTxCbor: 'deadbeef', txBodyHash: 'h', aggregatorFeeLovelace: '500000' },
    } as never);
    const route = { dex: 'MINSWAP', tokenIn: 'lovelace', tokenOut: 'abc', amountIn: '100', expectedOutput: '900', minimumOutput: '880' };
    const res = await mod.nexusSwapApi.buildTx({ route, senderAddress: 'addr1', changeAddress: 'addr1', utxos: [] });
    expect(spy).toHaveBeenCalledWith('/api/aggregator/build-tx', { route, senderAddress: 'addr1', changeAddress: 'addr1', utxos: [] });
    expect(res.unsignedTxCbor).toBe('deadbeef');
  });

  it('submit() posts the verbatim cbor + witness', async () => {
    const mod = await import('./nexus-swap.api');
    const spy = vi.spyOn(mod.swapAxiosInstance, 'post').mockResolvedValue({ data: { txHash: 'tx1', status: 'SUBMITTED' } } as never);
    const res = await mod.nexusSwapApi.submit({ unsignedTxCbor: 'deadbeef', userWitnessHex: 'a100' });
    expect(spy).toHaveBeenCalledWith('/api/aggregator/submit', { unsignedTxCbor: 'deadbeef', userWitnessHex: 'a100' });
    expect(res.txHash).toBe('tx1');
  });
});
