import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({
  get: [] as string[],
  post: [] as { url: string; body: unknown }[],
  getResponse: (() => ({ data: null })) as (url: string) => unknown,
  postFails: false,
}));

vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: { baseAddress: 'addr1' } } }));

vi.mock('@/api/api', () => ({
  Api: class {
    axiosInstance = {
      defaults: {} as Record<string, unknown>,
      interceptors: { request: { use: () => 0 }, response: { use: () => 0 } },
      get: async (url: string) => {
        http.get.push(url);
        return http.getResponse(url);
      },
      post: async (url: string, body: unknown) => {
        http.post.push({ url, body });
        if (http.postFails) throw Object.assign(new Error('Network Error'), { response: undefined });
        return { data: null };
      },
    };
  },
}));

import { rememberSentFeePayment, resetSentFeePaymentsForTests, sentFeePayment } from '@/modules/wallet/utils/cardFeePayments';

type CardStoreModule = typeof import('./card')['default'];
let store: CardStoreModule;

const TX = 'b5a2e0c02d51d6f4676ddd12bff8883cc09a30fa8305520f1f2093f72d084f26';
const url = (order: string) => `/api/kaiserex/cards/delivery-payment/${order}/sent`;
const notFound = () => { throw Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } }); };

beforeAll(async () => {
  store = (await import('./card')).default;
});

beforeEach(() => {
  http.get = [];
  http.post = [];
  http.getResponse = () => ({ data: null });
  http.postFails = false;
  resetSentFeePaymentsForTests();
});

describe('sent fee payments across devices', () => {
  it('remembers a sent fee locally and at gero-backend', async () => {
    await store.rememberFeePayment('order-a', TX);
    expect(sentFeePayment('order-a')?.txId).toBe(TX);
    expect(http.post).toEqual([{ url: url('order-a'), body: { txId: TX } }]);
  });

  it('keeps the local record when gero-backend cannot be reached', async () => {
    http.postFails = true;
    await store.rememberFeePayment('order-b', TX);
    expect(sentFeePayment('order-b')?.txId).toBe(TX);
  });

  it('adopts a payment another device recorded', async () => {
    http.getResponse = () => ({ data: { tx_id: TX, sent_at: '2026-10-22T10:36:56Z' } });
    await store.syncSentFeePayment('order-c');
    expect(http.get).toEqual([url('order-c')]);
    expect(sentFeePayment('order-c')).toEqual({ txId: TX, sentAt: Date.parse('2026-10-22T10:36:56Z') });
  });

  it('leaves the pay button alone when no device recorded a payment', async () => {
    http.getResponse = notFound;
    await store.syncSentFeePayment('order-d');
    expect(sentFeePayment('order-d')).toBeNull();
  });

  it('sends a record made before the backend route existed, instead of asking for one', async () => {
    // An earlier page recorded the payment only in this browser (as before gero-backend had the route).
    await rememberSentFeePayment('order-e', TX);
    await store.syncSentFeePayment('order-e');
    expect(http.post).toEqual([{ url: url('order-e'), body: { txId: TX } }]);
    expect(http.get).toEqual([]);
  });

  it('asks only once per order and page, but retries after a failure', async () => {
    http.getResponse = () => { throw new Error('Network Error'); };
    await store.syncSentFeePayment('order-f');
    http.getResponse = notFound;
    await store.syncSentFeePayment('order-f');
    await store.syncSentFeePayment('order-f');
    expect(http.get).toEqual([url('order-f'), url('order-f')]);
  });

  it('rejects a malformed transaction id from the backend', async () => {
    http.getResponse = () => ({ data: { tx_id: 'nope', sent_at: '2026-10-22T10:36:56Z' } });
    await store.syncSentFeePayment('order-g');
    expect(sentFeePayment('order-g')).toBeNull();
  });
});
