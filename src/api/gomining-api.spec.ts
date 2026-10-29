// The GoMining client is the wallet's only line to gero-backend's GoMining routes.
// These pin what it sends (a bearer token only where a session is needed, never an
// address or user id the backend should derive) and that any reply it cannot fully
// read throws instead of reaching a payment, an amount or a balance.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('axios', () => ({
  default: { create: () => http },
  isAxiosError: (error: unknown) => !!(error as { isAxiosError?: boolean })?.isAxiosError,
}));

import goMiningApi, { GoMiningApiError, GoMiningSessionError, type GoMiningOrder } from './gomining-api';

const reply = (data: unknown) => http.request.mockResolvedValueOnce({ data });
const refuse = (status: number, data?: unknown) => http.request.mockRejectedValueOnce({ isAxiosError: true, response: { status, data } });

const ORDER: GoMiningOrder = {
  id: 'ord_1',
  collectionId: 7,
  powerTh: 2,
  energyEfficiency: 20,
  priceUsd: 39.5,
  status: 'awaiting_payment',
  payment: { address: 'tb1qdeposit', amountSats: 61_234, network: 'Testnet', expiresAt: 1_900_000_000_000 },
  txid: null,
  createdAt: '2026-10-27T10:00:00.000Z',
};

const lastRequest = () => http.request.mock.calls.at(-1)![0];

beforeEach(() => { http.request.mockReset(); });

describe('requests', () => {
  it('sends public calls without a token', async () => {
    reply({ environment: 'sandbox', bitcoinNetwork: 'Testnet', ordersEnabled: false, referralUrl: null });
    await goMiningApi.getConfig();
    expect(lastRequest()).toMatchObject({ method: 'GET', url: '/config', headers: undefined });
  });

  it('sends the session token as a bearer header on account calls', async () => {
    reply({ availableSats: 1, withdrawnSats: 0, totalIncomeSats: 1 });
    await goMiningApi.getBalances('tok_abc');
    expect(lastRequest()).toMatchObject({ method: 'GET', url: '/balances', headers: { Authorization: 'Bearer tok_abc' } });
  });

  it('withdraws without naming a destination: the backend pays the linked address', async () => {
    reply({ status: 'accepted' });
    await goMiningApi.withdraw('tok', { amountSats: 50_000, speed: 'fast', requestId: 'req-1' });
    expect(lastRequest()).toMatchObject({ method: 'POST', url: '/withdrawals' });
    expect(lastRequest().data).toEqual({ amountSats: 50_000, speed: 'fast', requestId: 'req-1' });
  });

  it('opens an order with only the collection and an idempotency id', async () => {
    reply(ORDER);
    await goMiningApi.createOrder('tok', { collectionId: 7, requestId: 'req-2' });
    expect(lastRequest().data).toEqual({ collectionId: 7, requestId: 'req-2' });
  });

  it('escapes the order id in the path', async () => {
    reply(ORDER);
    await goMiningApi.getOrder('tok', '../me');
    expect(lastRequest().url).toBe('/orders/..%2Fme');
  });

  it('binds the challenge to the address and network being linked', async () => {
    reply({ nonce: 'ab'.repeat(16), expiresAt: 1 });
    await goMiningApi.createChallenge('tb1qlinked', 'Testnet');
    expect(lastRequest()).toMatchObject({ method: 'POST', url: '/session/challenge', data: { address: 'tb1qlinked', network: 'Testnet' } });
  });
});

describe('reply checks', () => {
  it('reads the config and keeps only an https referral link', async () => {
    reply({ environment: 'production', bitcoinNetwork: 'Mainnet', ordersEnabled: true, referralUrl: 'https://join.gomining.com/x' });
    expect(await goMiningApi.getConfig()).toEqual({
      environment: 'production', bitcoinNetwork: 'Mainnet', ordersEnabled: true, referralUrl: 'https://join.gomining.com/x',
    });
    reply({ environment: 'production', bitcoinNetwork: 'Mainnet', ordersEnabled: true, referralUrl: 'javascript:alert(1)' });
    expect((await goMiningApi.getConfig()).referralUrl).toBeNull();
  });

  it('refuses a config for an environment or network it does not know', async () => {
    reply({ environment: 'staging', bitcoinNetwork: 'Testnet', ordersEnabled: false, referralUrl: null });
    await expect(goMiningApi.getConfig()).rejects.toMatchObject({ code: 'malformed_response' });
    reply({ environment: 'sandbox', bitcoinNetwork: 'Signet', ordersEnabled: false, referralUrl: null });
    await expect(goMiningApi.getConfig()).rejects.toMatchObject({ code: 'malformed_response' });
  });

  it('reads an order exactly', async () => {
    reply(ORDER);
    expect(await goMiningApi.createOrder('tok', { collectionId: 7, requestId: 'r' })).toEqual(ORDER);
  });

  it.each([
    ['a fractional amount', { amountSats: 1.5 }],
    ['a zero amount', { amountSats: 0 }],
    ['a negative amount', { amountSats: -5 }],
    ['an amount as text', { amountSats: '61234' }],
    ['no address', { address: '' }],
    ['an unknown network', { network: 'Signet' }],
  ])('refuses a payment quote with %s', async (_label, patch) => {
    reply({ ...ORDER, payment: { ...ORDER.payment, ...patch } });
    await expect(goMiningApi.createOrder('tok', { collectionId: 7, requestId: 'r' })).rejects.toMatchObject({ code: 'malformed_response' });
  });

  it('refuses an order status it does not know', async () => {
    reply({ ...ORDER, status: 'paid' });
    await expect(goMiningApi.getOrder('tok', 'ord_1')).rejects.toBeInstanceOf(GoMiningApiError);
  });

  it('refuses balances that are not whole satoshis', async () => {
    reply({ availableSats: 0.0001, withdrawnSats: 0, totalIncomeSats: 0 });
    await expect(goMiningApi.getBalances('tok')).rejects.toMatchObject({ code: 'malformed_response' });
  });

  it('drops miner art that is not https', async () => {
    const miner = { id: 1, name: 'Miner', powerTh: 2, energyEfficiency: 20, createdAt: '2026-10-01T00:00:00Z', lastRewardSats: null };
    reply({ miners: [{ ...miner, imageUrl: 'http://cdn.example/a.png' }, { ...miner, id: 2, imageUrl: 'https://cdn.example/b.png' }] });
    const miners = await goMiningApi.getMiners('tok');
    expect(miners.map((m) => m.imageUrl)).toEqual([null, 'https://cdn.example/b.png']);
  });

  it('reads the withdrawal terms with either kind of fee', async () => {
    reply({ fastMinSats: 10_000, fastFeePercent: 1.5, fastFeeSats: null });
    expect(await goMiningApi.getWithdrawalTerms('tok')).toEqual({ fastMinSats: 10_000, fastFeePercent: 1.5, fastFeeSats: null });
  });
});

describe('errors', () => {
  it('turns a 401 into a session error', async () => {
    refuse(401, { error: 'invalid_token' });
    await expect(goMiningApi.getAccount('tok')).rejects.toBeInstanceOf(GoMiningSessionError);
  });

  it('keeps the backend error code', async () => {
    refuse(409, { error: 'quote_expired' });
    await expect(goMiningApi.createOrder('tok', { collectionId: 7, requestId: 'r' })).rejects.toMatchObject({ code: 'quote_expired', status: 409 });
  });

  it('does not carry a code it cannot trust', async () => {
    refuse(500, { error: '<script>alert(1)</script>' });
    await expect(goMiningApi.getAccount('tok')).rejects.toMatchObject({ code: 'request_failed', status: 500 });
  });

  it('reports a request that never got an answer as a network error', async () => {
    http.request.mockRejectedValueOnce({ isAxiosError: true });
    await expect(goMiningApi.getConfig()).rejects.toMatchObject({ code: 'network_error' });
  });
});
