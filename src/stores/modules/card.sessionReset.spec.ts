import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The provider, as gero-backend proxies it: a route handler that returns data or
// throws an axios-style error. Swapped per test step.
let respond: (url: string) => unknown = () => [];

vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: { baseAddress: 'addr1' } } }));

vi.mock('@/api/api', () => ({
  // Minimal axios instance that runs responses through the interceptors card.ts registers.
  Api: class {
    private onRejected: (error: unknown) => unknown = error => Promise.reject(error);

    axiosInstance = {
      defaults: {} as Record<string, unknown>,
      interceptors: {
        request: { use: () => 0 },
        response: { use: (_ok: unknown, onRejected: (error: unknown) => unknown) => { this.onRejected = onRejected; return 0; } },
      },
      get: async (url: string) => {
        try {
          return { data: respond(url) };
        } catch (error) {
          return this.onRejected(error);
        }
      },
      post: async () => ({ data: null }),
    };
  },
}));

type CardStoreModule = typeof import('./card')['default'];
let store: CardStoreModule;

const card = (id: number, uuid: string) => ({ id, card_uuid: uuid, order_uuid: `order-${uuid}`, status: 'done' });
const unauthorized = () => { throw Object.assign(new Error('Request failed with status code 401'), { response: { status: 401 } }); };

describe('card session expiry (401)', () => {
  beforeAll(async () => {
    store = (await import('./card')).default;
    await new Promise(resolve => setTimeout(resolve, 0)); // let initCardStore() settle
  });

  beforeEach(async () => {
    await store.logout();
  });

  it('drops the previous account’s cards and details, so the next account starts clean', async () => {
    // Account A signs in and loads its card, details cached.
    store.state.accessToken = 'token-a';
    store.state.tokenExpiry = Date.now() + 60_000;
    store.state.userInfo = { email: 'a@example.com' };
    store.state.cardanoAddress = { wallet_address: 'addr1a' };
    respond = () => [card(1, 'card-a')];
    await store.fetchCardData();
    store.getCard('card-a')!.cardDetails = { pan: '5375000000000001', expiryDate: '12/30', cvc2: '123', cardHolderName: 'A' };
    expect(store.state.selectedCardId).toBe('card-a');

    // A's token is rejected.
    respond = unauthorized;
    await expect(store.fetchCardData()).rejects.toMatchObject({ response: { status: 401 } });

    expect(store.state.accessToken).toBeNull();
    expect(store.state.cards).toEqual([]);
    expect(store.state.selectedCardId).toBeNull();
    expect(store.state.userInfo).toBeNull();
    expect(store.state.cardanoAddress).toBeNull();

    // Account B signs in.
    store.state.accessToken = 'token-b';
    store.state.tokenExpiry = Date.now() + 60_000;
    respond = () => [card(2, 'card-b')];
    await store.fetchCardData();

    expect(store.state.cards.map(c => c.cardData.card_uuid)).toEqual(['card-b']);
    expect(store.state.selectedCardId).toBe('card-b');
    expect(store.getCard('card-a')).toBeNull();
  });

  it('leaves the session alone on a non-401 failure', async () => {
    store.state.accessToken = 'token-a';
    store.state.tokenExpiry = Date.now() + 60_000;
    respond = () => [card(1, 'card-a')];
    await store.fetchCardData();

    respond = () => { throw Object.assign(new Error('boom'), { response: { status: 404 } }); };
    await expect(store.fetchCardData()).rejects.toThrow('boom');

    expect(store.state.accessToken).toBe('token-a');
    expect(store.state.cards.map(c => c.cardData.card_uuid)).toEqual(['card-a']);
  });
});
