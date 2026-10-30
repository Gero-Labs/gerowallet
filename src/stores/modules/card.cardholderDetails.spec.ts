import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  get: [] as { url: string; config?: { timeout?: number } }[],
  post: [] as { url: string; body: unknown }[],
  response: undefined as unknown,
}));

vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: { baseAddress: 'addr1' } } }));

vi.mock('@/api/api', () => ({
  Api: class {
    axiosInstance = {
      defaults: {} as Record<string, unknown>,
      interceptors: { request: { use: () => 0 }, response: { use: () => 0 } },
      get: async (url: string, config?: { timeout?: number }) => {
        calls.get.push({ url, config });
        return { data: calls.response };
      },
      post: async (url: string, body: unknown) => {
        calls.post.push({ url, body });
        return { data: calls.response };
      },
    };
  },
}));

type CardStoreModule = typeof import('./card')['default'];
let store: CardStoreModule;

beforeAll(async () => {
  store = (await import('./card')).default;
});

beforeEach(() => {
  calls.get = [];
  calls.post = [];
});

describe('cardholder details API', () => {
  it('asks for the missing fields with a short timeout, so the order modal never hangs', async () => {
    calls.response = { missing_fields: ['zipCode', 'address'] };
    await expect(store.getMissingCardholderDetails()).resolves.toEqual(['address', 'zipCode']);
    expect(calls.get).toEqual([{ url: '/api/kaiserex/cards/cardholder-details/missing', config: { timeout: 8000 } }]);
  });

  it('posts the details and returns what Zione still lists', async () => {
    calls.response = { message: 'saved', filled_fields: ['address'], missing_fields: ['nationality'] };
    await expect(store.fillCardholderDetails({ address: 'Vnouckova 2007' })).resolves.toEqual(['nationality']);
    expect(calls.post).toEqual([{ url: '/api/kaiserex/cards/cardholder-details', body: { address: 'Vnouckova 2007' } }]);
  });
});
