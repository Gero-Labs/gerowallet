// @vitest-environment node
import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const codecs = vi.hoisted(() => ({ check8: vi.fn(), prove8: vi.fn(), parse8: vi.fn(), check9: vi.fn(), prove9: vi.fn(), parse9: vi.fn() }));
vi.mock('@midnight-ntwrk/ledger-v8', async original => ({
  ...await original<object>(), createCheckPayload: codecs.check8, createProvingPayload: codecs.prove8, parseCheckResult: codecs.parse8,
}));
vi.mock('@midnightntwrk/ledger-v9', async original => ({
  ...await original<object>(), createCheckPayload: codecs.check9, createProvingPayload: codecs.prove9, parseCheckResult: codecs.parse9,
}));
import { makeLocalProvingProvider } from './midnightLocalProver';

beforeEach(() => {
  vi.clearAllMocks();
  for (const codec of [codecs.check8, codecs.prove8, codecs.check9, codecs.prove9]) codec.mockReturnValue(new Uint8Array([1, 2, 3]));
  codecs.parse8.mockReturnValue([8n]); codecs.parse9.mockReturnValue([9n]);
});
afterEach(() => vi.unstubAllGlobals());

describe('native proof HTTP adapter', () => {
  it.each(['stagenet', 'preprod'])('uses the selected %s codec and forwards only native binary payloads', async network => {
    const fetch = vi.fn().mockImplementation(async () => new Response(new Uint8Array([4, 5])));
    vi.stubGlobal('fetch', fetch);
    const provider = makeLocalProvingProvider('https://prover.example/native', { sdkNetworkId: network, headers: { 'x-api-key': 'synthetic-key' } });
    const preimage = new Uint8Array([7]);
    await provider.prove(preimage, 'builtin', 5n);
    expect(network === 'stagenet' ? codecs.prove9 : codecs.prove8).toHaveBeenCalledWith(preimage, 5n);
    const checked = await provider.check(preimage, 'builtin');
    expect(checked).toEqual([network === 'stagenet' ? 9n : 8n]);
    expect(fetch.mock.calls[0][0].toString()).toBe('https://prover.example/native/prove');
    expect(new Uint8Array(fetch.mock.calls[0][1].body)).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetch.mock.calls[0][1].headers).toEqual({ 'x-api-key': 'synthetic-key', 'Content-Type': 'application/octet-stream' });
    expect(await provider.lookupKey('builtin')).toBeUndefined();
  });

  it('never includes an upstream response body or credential-bearing URL in the error', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('secret-witness echoed by upstream', { status: 400 }));
    vi.stubGlobal('fetch', fetch);
    const provider = makeLocalProvingProvider('https://prover.example/secret-api-key', { sdkNetworkId: 'stagenet' });
    await expect(provider.prove(new Uint8Array(), 'builtin')).rejects.toThrow('proof server /prove: HTTP 400');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('bounds a real HTTP response that sends headers but stalls its binary body', async () => {
    const server = createServer((_request, response) => { response.writeHead(200); response.flushHeaders(); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server');
      const provider = makeLocalProvingProvider(`http://127.0.0.1:${address.port}`, { sdkNetworkId: 'stagenet', timeoutMs: 100 });
      const started = Date.now();
      await expect(provider.prove(new Uint8Array(), 'builtin')).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
