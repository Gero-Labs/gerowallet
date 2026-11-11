// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readVerifiedMidnightChainIdentity, assertMidnightChainIdentityUnchanged, midnightCheckpointNamespace } from './midnightChainIdentity';
import { getMidnightEndpoints } from './midnightConfig';

vi.mock('@/services/nexusDevice.service', () => ({
  getNexusAccessToken: async () => 'test-token', reauthenticateNexus: async () => 'new-test-token',
}));
const endpoints = getMidnightEndpoints('Stagenet')!;
const identity = { network: 'midnight-stagenet', chain_generation: 1, genesis_hash: `0x${'12'.repeat(32)}` };
const request = vi.fn();
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }
beforeEach(() => { request.mockReset(); vi.stubGlobal('fetch', request); });
afterEach(() => vi.unstubAllGlobals());

describe('verified Midnight chain identity', () => {
  it('requires agreement between independent Nexus and indexer reads', async () => {
    request.mockResolvedValueOnce(json(identity)).mockResolvedValueOnce(json({ data: { block: { hash: identity.genesis_hash.slice(2) } } }));
    expect(await readVerifiedMidnightChainIdentity(endpoints)).toEqual(identity);
    expect(request.mock.calls[1][0]).toBe(endpoints.publicIndexerUrl);
    expect(request.mock.calls[1][1].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it.each([0, -1, 1.1, '1', null, Number.MAX_SAFE_INTEGER + 1])('rejects invalid generation %s before accessing the indexer', async generation => {
    request.mockResolvedValueOnce(json({ ...identity, chain_generation: generation }));
    await expect(readVerifiedMidnightChainIdentity(endpoints)).rejects.toThrow('Invalid Midnight chain identity');
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([false, 0, null, 'false', '0x12', 'not-a-hash'])('rejects invalid indexer genesis %s', async hash => {
    request.mockResolvedValueOnce(json(identity)).mockResolvedValueOnce(json({ data: { block: { hash } } }));
    await expect(readVerifiedMidnightChainIdentity(endpoints)).rejects.toThrow('Cannot verify');
  });

  it('refuses an indexer reset even when observation-only Nexus still reports the old generation', async () => {
    request.mockResolvedValueOnce(json(identity)).mockResolvedValueOnce(json({ data: { block: { hash: '34'.repeat(32) } } }));
    await expect(readVerifiedMidnightChainIdentity(endpoints)).rejects.toThrow('reset detected');
  });

  it('treats an unreachable service as unknown and never returns a fallback generation', async () => {
    request.mockRejectedValue(new TypeError('network unavailable'));
    await expect(readVerifiedMidnightChainIdentity(endpoints)).rejects.toThrow();
  });

  it('refuses a known pending reset reported by Nexus', async () => {
    request.mockResolvedValueOnce(json({ code: 'RESET_PENDING' }, 503));
    await expect(readVerifiedMidnightChainIdentity(endpoints)).rejects.toThrow('reset recovery');
    expect(request).toHaveBeenCalledOnce();
  });

  it('reauthenticates once and never forwards a Nexus credential to the public indexer', async () => {
    request.mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json(identity))
      .mockResolvedValueOnce(json({ data: { block: { hash: identity.genesis_hash } } }));
    await readVerifiedMidnightChainIdentity(endpoints);
    expect(request.mock.calls[1][1].headers.Authorization).toBe('Bearer new-test-token');
    expect(request.mock.calls[2][1].headers.Authorization).toBeUndefined();
  });

  it('rejects a generation advanced during preparation even if the hash is the same', async () => {
    request.mockResolvedValueOnce(json({ ...identity, chain_generation: 2 }))
      .mockResolvedValueOnce(json({ data: { block: { hash: identity.genesis_hash } } }));
    await expect(assertMidnightChainIdentityUnchanged(endpoints, identity)).rejects.toThrow('changed during');
    expect(midnightCheckpointNamespace(identity)).not.toBe(midnightCheckpointNamespace({ ...identity, chain_generation: 2 }));
  });

  it('keeps wallet SDK 2 checkpoints apart from the beta ones', () => {
    expect(midnightCheckpointNamespace(identity)).toContain('-ledger9-sdk2-');
    expect(midnightCheckpointNamespace(identity)).not.toContain('rc3');
  });
});
