import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { MessageTypes } from '@/models/MessageTypes';

const api = vi.hoisted(() => ({ quote: vi.fn(), execute: vi.fn(), message: vi.fn() }));
vi.mock('@/api/strike-v2.user', () => ({ strikeUserApi: { getWithdrawQuote: api.quote, executeWithdraw: api.execute } }));
vi.mock('@/api/strike-v2.client', () => ({ hasStrikeApiKeys: () => true }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: api.message } }));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive({
  loggedWallet: null, isLocked: false, keys: { payment: [] }, utxos: [],
}) }));
vi.mock('@/stores/priceStore', () => ({ priceStore: {} }));

import { walletStore } from '@/stores/walletStore';
import { useStrikeWithdraw } from './useStrikeWithdraw';

const WALLET_A = { id: 1, baseAddress: 'addr-a', network: 'Mainnet' };
const WALLET_B = { id: 2, baseAddress: 'addr-b', network: 'Mainnet' };
const signature = { data: { signature: 'aabb', key: 'ccdd' } };
const quoted = (id: string) => ({
  withdraw_id: id, message_to_sign: '416461', expires_at: new Date(Date.now() + 60_000).toISOString(),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('a Strike withdrawal keeps its result once it has been sent to Strike', () => {
  let scope: ReturnType<typeof effectScope>;
  let withdraw: ReturnType<typeof useStrikeWithdraw>;
  let answer: ReturnType<typeof deferred<{ request_id?: string }>>;

  /** A withdrawal from wallet A whose executeWithdraw call is not answered yet. */
  async function submitting() {
    const done = withdraw.signAndSubmit('password');
    await vi.waitFor(() => expect(api.execute).toHaveBeenCalledTimes(1));
    // Wrapped: an async function that returned the promise itself would wait for it.
    return { done };
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    Object.assign(walletStore, { loggedWallet: WALLET_A, isLocked: false });
    scope = effectScope();
    withdraw = scope.run(() => useStrikeWithdraw())!;
    withdraw.reset();
    answer = deferred();
    api.message.mockImplementation(async ({ method }) => (method === MessageTypes.SIGN_DATA ? signature : { data: {} }));
    api.quote.mockResolvedValue(quoted('first'));
    api.execute.mockReturnValue(answer.promise);
    await withdraw.requestQuote('8.00');
  });

  afterEach(() => {
    // Results outlive reset() by design, so each case hands back a clean slate.
    for (const wallet of [WALLET_A, WALLET_B]) {
      Object.assign(walletStore, { loggedWallet: wallet, isLocked: false });
      withdraw.acknowledgeSubmission?.();
    }
    scope.stop();
  });

  it('has no result to keep while the withdrawal is still being signed', async () => {
    const approval = deferred<typeof signature>();
    api.message.mockReturnValueOnce(approval.promise);
    const signing = withdraw.signAndSubmit('password');
    expect(withdraw.submission.value).toBeNull();
    withdraw.reset();
    approval.resolve(signature);
    expect(await signing).toBe(false);
    expect(withdraw.submission.value).toBeNull();
    expect(api.execute).not.toHaveBeenCalled();
  });

  it('keeps the accepted withdrawal when the sheet is closed while Strike is answering', async () => {
    const { done } = await submitting();
    expect(withdraw.submission.value).toMatchObject({ status: 'submitting', withdrawId: 'first', usd: '8.00', requestId: null });

    withdraw.reset();
    expect(withdraw.status.value).toBe('idle');
    expect(withdraw.submission.value).toMatchObject({ status: 'submitting', withdrawId: 'first' });

    answer.resolve({ request_id: 'receipt' });
    expect(await done).toBe(true);
    expect(withdraw.submission.value).toMatchObject({ status: 'settled', withdrawId: 'first', requestId: 'receipt', error: null });

    withdraw.reset();
    expect(withdraw.submission.value).toMatchObject({ status: 'settled', requestId: 'receipt' });
  });

  it('keeps a failed submission when the sheet was closed while Strike was answering', async () => {
    const { done } = await submitting();
    withdraw.reset();
    answer.reject(new Error('Network Error'));
    expect(await done).toBe(false);
    expect(withdraw.submission.value).toMatchObject({ status: 'error', withdrawId: 'first', requestId: null });
    expect(withdraw.submission.value?.error).toBeTruthy();
  });

  it('starts no second withdrawal while the first one is still being submitted', async () => {
    const { done } = await submitting();
    withdraw.reset();
    api.quote.mockResolvedValue(quoted('second'));
    await withdraw.requestQuote('8.00');
    expect(await withdraw.signAndSubmit('password')).toBe(false);
    expect(api.execute).toHaveBeenCalledTimes(1);

    answer.resolve({ request_id: 'receipt' });
    expect(await done).toBe(true);
  });

  it('keeps the result through a wallet lock', async () => {
    const { done } = await submitting();
    walletStore.isLocked = true;
    walletStore.isLocked = false;
    expect(withdraw.status.value).toBe('idle');
    answer.resolve({ request_id: 'receipt' });
    expect(await done).toBe(true);
    expect(withdraw.submission.value).toMatchObject({ status: 'settled', requestId: 'receipt' });
  });

  it('keeps the result with the wallet it was sent from when the wallet changes', async () => {
    const { done } = await submitting();

    Object.assign(walletStore, { loggedWallet: WALLET_B });
    expect(withdraw.submission.value).toBeNull();
    expect(withdraw.status.value).toBe('idle');

    answer.resolve({ request_id: 'receipt' });
    expect(await done).toBe(true);
    expect(withdraw.submission.value).toBeNull();
    expect(withdraw.requestId.value).toBeNull();
    expect(withdraw.status.value).toBe('idle');

    Object.assign(walletStore, { loggedWallet: WALLET_A });
    expect(withdraw.submission.value).toMatchObject({ status: 'settled', withdrawId: 'first', requestId: 'receipt' });
  });

  it('lets go of a result only once it is final and has been acknowledged', async () => {
    const { done } = await submitting();
    withdraw.acknowledgeSubmission();
    expect(withdraw.submission.value).toMatchObject({ status: 'submitting' });

    answer.resolve({});
    await done;
    expect(withdraw.submission.value).toMatchObject({ status: 'settled', requestId: 'first' });
    withdraw.acknowledgeSubmission();
    expect(withdraw.submission.value).toBeNull();
  });
});
