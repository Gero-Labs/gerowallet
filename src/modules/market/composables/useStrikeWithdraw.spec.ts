import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519PublicKeyHex, Ed25519SignatureHex } from '@cardano-sdk/crypto';
import { effectScope } from 'vue';
import { MessageTypes } from '@/models/MessageTypes';

const api = vi.hoisted(() => ({ quote: vi.fn(), execute: vi.fn(), message: vi.fn() }));
vi.mock('@/api/strike-v2.user', () => ({ strikeUserApi: { getWithdrawQuote: api.quote, executeWithdraw: api.execute } }));
vi.mock('@/api/strike-v2.client', () => ({ hasStrikeApiKeys: () => true }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: api.message } }));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive({
  loggedWallet: { id: 1, chain: 'Cardano', network: 'Mainnet', baseAddress: '' },
  isLocked: false, keys: { payment: [] }, utxos: [],
}) }));
vi.mock('@/stores/priceStore', () => ({ priceStore: {} }));

import { walletStore } from '@/stores/walletStore';
import { useStrikeWithdraw } from './useStrikeWithdraw';

const key = (c: string) => ({ type: Cardano.CredentialType.KeyHash, hash: c.repeat(56) as Cardano.Credential['hash'] });
const own = Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Mainnet, key('a'), key('b')).toAddress().toBech32();
const validator = Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Mainnet, {
  ...key('c'), type: Cardano.CredentialType.ScriptHash,
}).toAddress().toBech32();
const serverWitness = [Ed25519PublicKeyHex('11'.repeat(32)), Ed25519SignatureHex('22'.repeat(64))] as const;
const walletWitness = [Ed25519PublicKeyHex('33'.repeat(32)), Ed25519SignatureHex('44'.repeat(64))] as const;
const funding = Serialization.Transaction.fromCore({
  id: '9'.repeat(64),
  body: {
    inputs: [{ txId: '9'.repeat(64), index: 0 }],
    outputs: [{ address: validator, value: { coins: 1_700_000n } }, { address: own, value: { coins: 8_100_000n } }],
    fee: 200_000n,
  },
  witness: { signatures: new Map([serverWitness]) },
} as unknown as Cardano.Tx).toCbor();
const witnesses = Serialization.TransactionWitnessSet.fromCore({ signatures: new Map([walletWitness]) }).toCbor();
const signature = { data: { signature: 'aabb', key: 'ccdd' } };
const quoted = (id: string) => ({
  withdraw_id: id, message_to_sign: '416461', validator_address: validator, tx_cbor: funding,
  expires_at: new Date(Date.now() + 60_000).toISOString(),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('Strike software-wallet withdrawals', () => {
  let scope: ReturnType<typeof effectScope>;
  let withdraw: ReturnType<typeof useStrikeWithdraw>;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T12:00:00Z'));
    Object.assign(walletStore, { loggedWallet: { id: 1, baseAddress: own, network: 'Mainnet' }, isLocked: false,
      keys: { payment: [{ address: own, cred: 'a'.repeat(56) }] }, utxos: [] });
    scope = effectScope();
    withdraw = scope.run(() => useStrikeWithdraw())!;
    withdraw.reset();
    api.message.mockImplementation(async ({ method }) => method === MessageTypes.SIGN_DATA ? signature : { data: { witnesses } });
    api.quote.mockResolvedValue(quoted('first'));
    api.execute.mockResolvedValue({ request_id: 'receipt' });
    await withdraw.requestQuote('8.00');
  });

  afterEach(() => {
    scope.stop();
    vi.useRealTimers();
  });

  it.each([false, true])('submits the signed funding transaction with the approved message (PassKey %s)', async (passkey) => {
    const bytes = passkey ? new Uint8Array([1, 2]) : undefined;
    expect(await withdraw.signAndSubmit(passkey ? '' : 'password', bytes)).toBe(true);
    expect(api.message.mock.calls.map(([message]) => message.method)).toEqual([MessageTypes.SIGN_DATA, MessageTypes.SIGN_TX]);
    for (const [message] of api.message.mock.calls) {
      expect(message.data.password).toBe(passkey ? '' : 'password');
      expect(message.data.privateKeyBytes).toEqual(passkey ? [1, 2] : undefined);
    }
    expect(api.message.mock.calls[0][0].data).toMatchObject({ address: own, payload: '416461' });
    expect(api.execute).toHaveBeenCalledExactlyOnceWith('first', 'aabb:ccdd', expect.any(String));
    const signed = Serialization.Transaction.fromCbor(api.execute.mock.calls[0][2]);
    expect(signed.body().toCbor()).toBe(Serialization.Transaction.fromCbor(funding).body().toCbor());
    expect(signed.witnessSet().toCore().signatures).toEqual(new Map([serverWitness, walletWitness]));
    expect(withdraw.requestId.value).toBe('receipt');
    expect(await withdraw.signAndSubmit('password')).toBe(false);
    expect(api.execute).toHaveBeenCalledTimes(1);
  });

  it('signs a message-only quote without requesting a Cardano funding signature', async () => {
    api.quote.mockResolvedValue({ withdraw_id: 'message-only', message_to_sign: '416461' });
    await withdraw.requestQuote('8.00');
    expect(await withdraw.signAndSubmit('password')).toBe(true);
    expect(api.message).toHaveBeenCalledTimes(1);
    expect(api.execute).toHaveBeenCalledExactlyOnceWith('message-only', 'aabb:ccdd', undefined);
  });

  it('keeps the most recent quote when an older quote request returns last', async () => {
    const slow = deferred<ReturnType<typeof quoted>>();
    api.quote.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(quoted('newest'));
    const first = withdraw.requestQuote('4.00');
    await withdraw.requestQuote('5.00');
    slow.resolve(quoted('old'));
    await first;
    expect(withdraw.quote.value?.withdraw_id).toBe('newest');
  });

  it('discards a quote that arrives after the review was closed', async () => {
    const slow = deferred<ReturnType<typeof quoted>>();
    api.quote.mockReturnValueOnce(slow.promise);
    const pending = withdraw.requestQuote('5.00');
    withdraw.reset();
    slow.resolve(quoted('closed'));
    await pending;
    expect(withdraw.status.value).toBe('idle');
    expect(withdraw.quote.value).toBeNull();
  });

  it('stops a pending signature when the user replaces its quote', async () => {
    const approval = deferred<typeof signature>();
    api.message.mockReturnValueOnce(approval.promise);
    const signing = withdraw.signAndSubmit('password');
    api.quote.mockResolvedValue(quoted('replacement'));
    await withdraw.requestQuote('9.00');
    approval.resolve(signature);
    expect(await signing).toBe(false);
    expect(api.message).toHaveBeenCalledTimes(1);
    expect(api.execute).not.toHaveBeenCalled();
    expect(withdraw.status.value).toBe('quoted');
  });

  it('ignores a second confirm while the first one is signing', async () => {
    const approval = deferred<typeof signature>();
    api.message.mockReturnValueOnce(approval.promise);
    const signing = withdraw.signAndSubmit('password');
    expect(await withdraw.signAndSubmit('password')).toBe(false);
    approval.resolve(signature);
    expect(await signing).toBe(true);
    expect(api.execute).toHaveBeenCalledTimes(1);
  });

  it.each([MessageTypes.SIGN_DATA, MessageTypes.SIGN_TX])('honours expiry while waiting for %s', async (pauseAt) => {
    api.message.mockImplementation(async ({ method }) => {
      if (method === pauseAt) vi.advanceTimersByTime(60_000);
      return method === MessageTypes.SIGN_DATA ? signature : { data: { witnesses } };
    });
    expect(await withdraw.signAndSubmit('password')).toBe(false);
    expect(withdraw.error.value).toMatch(/expir/i);
    expect(api.message).toHaveBeenCalledTimes(pauseAt === MessageTypes.SIGN_DATA ? 1 : 2);
    expect(api.execute).not.toHaveBeenCalled();
  });

  it('keeps a fresh review when a previously submitted withdrawal finishes', async () => {
    const submitted = deferred<{ request_id: string }>();
    const executing = deferred<void>();
    api.execute.mockImplementationOnce(() => { executing.resolve(); return submitted.promise; });
    const signing = withdraw.signAndSubmit('password');
    await executing.promise;
    withdraw.reset();
    api.quote.mockResolvedValue(quoted('next'));
    await withdraw.requestQuote('10.00');
    submitted.resolve({ request_id: 'original' });
    expect(await signing).toBe(true);
    expect(withdraw.status.value).toBe('quoted');
    expect(withdraw.requestId.value).toBeNull();
    expect(withdraw.quote.value?.withdraw_id).toBe('next');
  });

  it('discards a withdrawal when the wallet locks and unlocks during approval', async () => {
    const approval = deferred<typeof signature>();
    api.message.mockReturnValueOnce(approval.promise);
    const signing = withdraw.signAndSubmit('password');
    walletStore.isLocked = true;
    walletStore.isLocked = false;
    approval.resolve(signature);
    expect(await signing).toBe(false);
    expect(api.execute).not.toHaveBeenCalled();
    expect(withdraw.status.value).toBe('idle');
  });
});
