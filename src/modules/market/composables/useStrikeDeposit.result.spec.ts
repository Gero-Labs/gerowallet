import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { MessageTypes } from '@/models/MessageTypes';

const calls = vi.hoisted(() => ({
  quote: vi.fn(),
  build: vi.fn(),
  confirm: vi.fn(),
  send: vi.fn(),
  serialize: vi.fn(),
}));
vi.mock('@/api/strike-v2.user', () => ({
  strikeUserApi: { getDepositQuote: calls.quote, buildDepositTx: calls.build, confirmDeposit: calls.confirm },
}));
vi.mock('@/api/strike-v2.client', () => ({ hasStrikeApiKeys: () => true }));
vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive({}) };
});
vi.mock('@/stores/priceStore', () => ({ priceStore: {} }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: calls.send } }));
vi.mock('@/chrome/cardanoJsSdkCbor', () => ({ serializeCardanoJsSdkTx: calls.serialize }));
vi.mock('@/modules/swap/composables/utxoToCip30Hex', () => ({ utxoToCip30Hex: vi.fn(() => 'utxo-hex') }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));

import { useStrikeDeposit } from './useStrikeDeposit';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);

const net = Cardano.NetworkId.Mainnet;
const keyCred = (c: string) => ({ type: Cardano.CredentialType.KeyHash, hash: c.repeat(56) as Cardano.Credential['hash'] });
const OWN = Cardano.BaseAddress.fromCredentials(net, keyCred('a'), keyCred('b')).toAddress().toBech32();
const OTHER = Cardano.BaseAddress.fromCredentials(net, keyCred('d'), keyCred('d')).toAddress().toBech32();
const DEPOSIT = Cardano.EnterpriseAddress.fromCredentials(net, keyCred('9')).toAddress().toBech32();
const EXCHANGER = Cardano.EnterpriseAddress.fromCredentials(net, keyCred('e')).toAddress().toBech32();
const WALLET = 10_000_000_000n;
const AMOUNT = 100_000_000n;
const TX_ID = 'ab'.repeat(32);
const WALLET_A = { id: 1, baseAddress: OWN };
const WALLET_B = { id: 2, baseAddress: OTHER };

const FUNDING_CBOR = Serialization.Transaction.fromCore({
  id: '3'.repeat(64),
  body: { inputs: [{ txId: '3'.repeat(64), index: 0 }], outputs: [{ address: OWN, value: { coins: WALLET } }], fee: 170_000n },
  witness: { signatures: new Map() },
} as unknown as Cardano.Tx).toCbor();
const FUND = String(Serialization.Transaction.fromCbor(FUNDING_CBOR).getId());
const UNSIGNED = Serialization.Transaction.fromCore({
  id: '9'.repeat(64),
  body: {
    inputs: [{ txId: FUND, index: 0 }],
    outputs: [{ address: EXCHANGER, value: { coins: AMOUNT } }, { address: OWN, value: { coins: 9_899_800_000n } }],
    fee: 200_000n,
  },
  witness: { signatures: new Map() },
} as unknown as Cardano.Tx).toCbor();

type SubmitReply = { data?: { txId?: string; error?: string } } | undefined;
let answerSubmit!: (reply: SubmitReply) => void;

function sentMethods(): string[] {
  return calls.send.mock.calls.map(([message]) => (message as { method: string }).method);
}

function render() {
  let deposit!: ReturnType<typeof useStrikeDeposit>;
  mount(defineComponent({ setup: () => { deposit = useStrikeDeposit(); return () => null; } }));
  return deposit;
}

/** A deposit from wallet A whose SUBMIT_TX is on its way and not answered yet. */
async function submitting() {
  const deposit = render();
  await deposit.requestQuote(100);
  const done = deposit.buildAndSign('test-password');
  await vi.waitFor(() => expect(sentMethods()).toContain(MessageTypes.SUBMIT_TX));
  return { deposit, done };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(walletStore, {
    loggedWallet: WALLET_A,
    utxos: [[{ txId: FUND, index: 0, address: OWN }, { address: OWN, value: { coins: WALLET } }]],
    transactions: [{ tx_hash: FUND, cbor: FUNDING_CBOR }],
    keys: {
      payment: [{ address: OWN, cred: 'a'.repeat(56) }],
      change: [],
      stake: [{ cred: 'b'.repeat(56) }],
    },
  });
  calls.serialize.mockImplementation((core: Cardano.Tx) => Serialization.Transaction.fromCore(core).toCbor());
  calls.quote.mockResolvedValue({
    request_id: 'req-1',
    deposit_address: DEPOSIT,
    confirmations_required: 15,
    quote: { asset_symbol: 'ADA', asset_amount: AMOUNT.toString(), usd_value: '40', exchange_rate: '0.4', expiration_at: Math.floor(Date.now() / 1000) + 600 },
  });
  calls.build.mockResolvedValue({ unsigned_tx: UNSIGNED });
  calls.confirm.mockResolvedValue({ request_id: 'req-1', status: 'pending' });
  calls.send.mockImplementation(({ method }: { method: string }) => {
    if (method === MessageTypes.VERIFY_SPENDING_PASSWORD) return Promise.resolve({ data: { success: true } });
    if (method === MessageTypes.SIGN_TX) return Promise.resolve({ data: { witnesses: 'a1' } });
    return new Promise<SubmitReply>(resolve => { answerSubmit = resolve; });
  });
});

afterEach(() => {
  // Results outlive reset() by design, so each case hands back a clean slate.
  const deposit = render();
  for (const wallet of [WALLET_A, WALLET_B]) {
    Object.assign(walletStore, { loggedWallet: wallet });
    deposit.acknowledgeSubmission?.();
  }
});

describe('a Strike deposit keeps its result once the transaction is being submitted', () => {
  it('has no result to keep while the deposit is still being built and signed', async () => {
    const deposit = render();
    await deposit.requestQuote(100);
    expect(deposit.submission.value).toBeNull();
    deposit.reset();
    expect(deposit.submission.value).toBeNull();
  });

  it('keeps the transaction and its confirmation when the sheet is closed during the broadcast', async () => {
    const { deposit, done } = await submitting();
    expect(deposit.submission.value).toMatchObject({ status: 'submitting', requestId: 'req-1', lovelace: AMOUNT.toString(), txHash: null });

    deposit.reset();
    expect(deposit.status.value).toBe('idle');
    expect(deposit.submission.value).toMatchObject({ status: 'submitting', requestId: 'req-1' });

    answerSubmit({ data: { txId: TX_ID } });
    expect(await done).toBe(true);
    expect(calls.confirm).toHaveBeenCalledWith('req-1', TX_ID);
    expect(deposit.submission.value).toMatchObject({ status: 'confirmed', requestId: 'req-1', txHash: TX_ID, error: null });

    deposit.reset();
    expect(deposit.submission.value).toMatchObject({ status: 'confirmed', txHash: TX_ID });
  });

  it.each([
    ['a lost reply', undefined, 'errors.submitUnconfirmed'],
    ['a rejected transaction', { data: { error: 'BadInputsUTxO' } }, 'BadInputsUTxO'],
  ] as const)('keeps %s when the sheet was closed during the broadcast', async (_name, reply, message) => {
    const { deposit, done } = await submitting();
    deposit.reset();
    answerSubmit(reply);
    expect(await done).toBe(false);
    expect(deposit.submission.value).toMatchObject({ status: 'error', error: message, txHash: null, requestId: 'req-1' });
    expect(calls.confirm).not.toHaveBeenCalled();
  });

  it('starts no second deposit while the first one is still being submitted', async () => {
    const { deposit, done } = await submitting();
    deposit.reset();
    await deposit.requestQuote(100);
    expect(await deposit.buildAndSign('test-password')).toBe(false);
    expect(calls.build).toHaveBeenCalledTimes(1);
    expect(sentMethods().filter(method => method === MessageTypes.SUBMIT_TX)).toHaveLength(1);

    answerSubmit({ data: { txId: TX_ID } });
    expect(await done).toBe(true);
    expect(deposit.submission.value).toMatchObject({ status: 'confirmed', txHash: TX_ID });
  });

  it('keeps the result with the wallet it was sent from when the wallet changes', async () => {
    const { deposit, done } = await submitting();

    Object.assign(walletStore, { loggedWallet: WALLET_B });
    expect(deposit.submission.value).toBeNull();
    expect(deposit.status.value).toBe('idle');
    expect(deposit.quote.value).toBeNull();

    answerSubmit({ data: { txId: TX_ID } });
    expect(await done).toBe(true);
    expect(calls.confirm).toHaveBeenCalledWith('req-1', TX_ID);
    expect(deposit.submission.value).toBeNull();
    expect(deposit.txHash.value).toBeNull();
    expect(deposit.status.value).toBe('idle');

    Object.assign(walletStore, { loggedWallet: WALLET_A });
    expect(deposit.submission.value).toMatchObject({ status: 'confirmed', requestId: 'req-1', txHash: TX_ID });
  });

  it('lets go of a result only once it is final and has been acknowledged', async () => {
    const { deposit, done } = await submitting();
    deposit.acknowledgeSubmission();
    expect(deposit.submission.value).toMatchObject({ status: 'submitting' });

    answerSubmit({ data: { txId: TX_ID } });
    await done;
    deposit.acknowledgeSubmission();
    expect(deposit.submission.value).toBeNull();
  });
});
