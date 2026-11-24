// The swap's Nexus calls degrade: a route this Nexus does not serve answers null,
// a refusal is its code (never its text), and a network failure is SWAP_UNAVAILABLE.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { instance } = vi.hoisted(() => ({
  instance: { get: vi.fn(), post: vi.fn(), interceptors: { request: { use: () => undefined }, response: { use: () => undefined } } },
}));
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, create: () => instance } };
});
vi.mock('@/services/nexusDevice.service', () => ({ getNexusAccessToken: vi.fn(), reauthenticateNexus: vi.fn() }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));

const { MidnightApi } = await import('./midnight-api');
const { MidnightSwapError } = await import('@/chains/midnight/midnightSwapConfig');

const TYPE_A = 'aa'.repeat(32);
const TYPE_B = 'bb'.repeat(32);
const api = () => new MidnightApi('Preprod');

beforeEach(() => {
  instance.get.mockReset();
  instance.post.mockReset();
});

describe('token catalog', () => {
  it('asks the network\'s tokens route and reads the page', async () => {
    instance.get.mockResolvedValue({ status: 200, data: { total: 1, tokens: [{ tokenType: TYPE_A, kind: 'UNSHIELDED', symbol: 'TTK', name: 'T', decimals: 6, metadataSource: 'CURATED', verified: true }] } });
    const page = await api().getTokenCatalog({ limit: 50 });
    expect(page?.tokens[0].symbol).toBe('TTK');
    expect(instance.get.mock.calls[0][0]).toMatch(/\/api\/midnight\/midnight-preprod\/tokens\?limit=50&offset=0$/);
  });

  it('is null on a Nexus without the route', async () => {
    instance.get.mockResolvedValue({ status: 404, data: {} });
    await expect(api().getTokenCatalog()).resolves.toBeNull();
  });
});

describe('trades', () => {
  it('normalizes the pair (tokenA < tokenB) and is null when swaps are not enabled', async () => {
    instance.get.mockResolvedValue({ status: 200, data: { trades: [] } });
    await api().getSwapTrades(TYPE_B, TYPE_A);
    expect(instance.get.mock.calls[0][0]).toContain(`tokenA=${TYPE_A}&tokenB=${TYPE_B}&limit=1`);
    instance.get.mockResolvedValue({ status: 404, data: { code: 'SWAP_NOT_ENABLED' } });
    await expect(api().getSwapTrades(TYPE_A, TYPE_B)).resolves.toBeNull();
  });
});

describe('listing with Gero', () => {
  it('posts the offer string and reads the id', async () => {
    instance.post.mockResolvedValue({ status: 201, data: { offerId: 'cc'.repeat(32), status: 'live', published: true } });
    await expect(api().listSwapOffer('swapoffer1abc')).resolves.toEqual({ offerId: 'cc'.repeat(32), status: 'live', published: true });
    expect(instance.post.mock.calls[0][0]).toMatch(/\/swap-offers$/);
    expect(instance.post.mock.calls[0][1]).toEqual({ offer: 'swapoffer1abc' });
  });

  it('a refusal is its code; an unknown code or no answer is SWAP_UNAVAILABLE', async () => {
    instance.post.mockResolvedValue({ status: 400, data: { code: 'OFFER_EXPIRED', message: 'server words' } });
    await expect(api().listSwapOffer('swapoffer1abc')).rejects.toMatchObject({ code: 'OFFER_EXPIRED' });
    instance.post.mockResolvedValue({ status: 400, data: { code: 'SOMETHING_NEW' } });
    await expect(api().listSwapOffer('swapoffer1abc')).rejects.toMatchObject({ code: 'SWAP_UNAVAILABLE' });
    instance.post.mockRejectedValue(new Error('network'));
    await expect(api().listSwapOffer('swapoffer1abc')).rejects.toBeInstanceOf(MidnightSwapError);
  });
});

describe('open offers', () => {
  it('asks for live offers and is null when swaps are not enabled', async () => {
    instance.get.mockResolvedValue({ status: 200, data: { offers: [], nextCursor: null } });
    await expect(api().listOpenSwapOffers({ wants: TYPE_A })).resolves.toEqual([]);
    expect(instance.get.mock.calls[0][0]).toContain('status=live');
    expect(instance.get.mock.calls[0][0]).toContain(`wants=${TYPE_A}`);
    instance.get.mockResolvedValue({ status: 404, data: { code: 'SWAP_NOT_ENABLED' } });
    await expect(api().listOpenSwapOffers()).resolves.toBeNull();
  });

  it('fetches one offer only for a valid id, and only with its string', async () => {
    await expect(api().getSwapOffer('nope')).resolves.toBeNull();
    expect(instance.get).not.toHaveBeenCalled();
    instance.get.mockResolvedValue({ status: 200, data: { offerId: 'cc'.repeat(32), computed: { gives: [{ token: TYPE_A, amount: '1', type: 'UNSHIELDED' }], wants: [{ token: TYPE_B, amount: '2', type: 'UNSHIELDED' }] } } });
    await expect(api().getSwapOffer('cc'.repeat(32))).resolves.toBeNull();
  });
});
