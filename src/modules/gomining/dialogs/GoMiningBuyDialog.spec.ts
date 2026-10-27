// Buying a miner sends the user's BTC to an address gero-backend names. These pin
// that the wallet pays exactly the quote, once, and only a quote it can check: on
// its own network, to an address valid there, with time left.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import * as Vue from 'vue';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { MessageTypes } from '@/models/MessageTypes';
import type { GoMiningCollection, GoMiningOrder } from '@/api/gomining-api';

vi.mock('@/api/gomining-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/gomining-api')>();
  return { ...actual, default: { createOrder: vi.fn(), reportPayment: vi.fn(), getOrder: vi.fn() } };
});
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: vi.fn() } }));
vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive({ loggedWallet: { id: 1, network: 'Testnet', encryptionMethod: 'password' }, utxos: [] as unknown[] }) };
});
const feeEstimate = vi.hoisted(() => vi.fn(async () => ({ feeRate: 12 })));
vi.mock('@/chains/bitcoin/bitcoinFeeEstimator', () => ({
  FeePriority: { FAST: 'fast' },
  getBitcoinFeeEstimator: () => ({ getFeeEstimate: feeEstimate }),
}));
vi.mock('@/chains/bitcoin/bitcoinKeyManager', () => ({
  validateBitcoinAddress: (address: string, network: string) => network === 'Testnet' && address.startsWith('tb1'),
}));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// `<script setup>` imports are not registered by name, so they are mocked as modules.
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({
  default: { name: 'BaseDialogStub', setup: (_p: unknown, { slots }: { slots: Vue.Slots }) => () => Vue.h('div', slots['default']?.()) },
}));
vi.mock('@/shared/components/CopyButton.vue', () => ({ default: { name: 'CopyButtonStub', render: () => null } }));
vi.mock('@/shared/components/PassKeyPasswordField.vue', () => ({
  default: {
    name: 'PasswordStub',
    props: ['modelValue'],
    emits: ['update:modelValue', 'enter'],
    setup(props: { modelValue: string }, { emit }: { emit: (event: string, value: string) => void }) {
      return () => Vue.h('input', {
        'data-testid': 'password',
        value: props.modelValue,
        onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value),
      });
    },
  },
}));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({
  default: {
    name: 'GButtonStub',
    props: ['disabled', 'loading', 'tier'],
    emits: ['click'],
    setup(props: { disabled?: boolean }, { slots, emit }: { slots: Vue.Slots; emit: (event: string) => void }) {
      return () => Vue.h('button', { disabled: props.disabled, onClick: () => emit('click') }, slots['default']?.());
    },
  },
}));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import GoMiningBuyDialog from './GoMiningBuyDialog.vue';
import goMiningApi from '@/api/gomining-api';
import { Messaging } from '@/chrome/messaging';
import { walletStore } from '@/stores/walletStore';

const api = vi.mocked(goMiningApi);
const send = vi.mocked(Messaging.sendToBackgroundFromOptions);
const TXID = 'ab'.repeat(32);

const COLLECTION: GoMiningCollection = { id: 7, powerTh: 2, energyEfficiency: 20, priceUsd: 39.5, annualRoiPercent: 31.2, discountPercent: 0 };

function order(patch: Partial<GoMiningOrder> = {}, payment: Partial<GoMiningOrder['payment']> = {}): GoMiningOrder {
  return {
    id: 'ord_1', collectionId: 7, powerTh: 2, energyEfficiency: 20, priceUsd: 39.5, status: 'awaiting_payment',
    payment: { address: 'tb1qdeposit', amountSats: 61_234, network: 'Testnet', expiresAt: Date.now() + 10 * 60_000, ...payment },
    txid: null, createdAt: '2026-10-27T10:00:00.000Z', ...patch,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

let wrapper: VueWrapper;
const withSession = vi.fn(<T,>(call: (token: string) => Promise<T>) => call('tok'));

function mountDialog() {
  wrapper = mount(GoMiningBuyDialog, {
    props: { modelValue: true, collection: COLLECTION, walletNetwork: 'Testnet', withSession },
    global: {
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
      stubs: {
        'v-icon': true,
        'v-card-text': { setup: (_p: unknown, { slots }: { slots: Vue.Slots }) => () => Vue.h('div', slots['default']?.()) },
      },
    },
  });
}

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await Vue.nextTick();
}

const button = (label: string) => wrapper.findAll('button').find((b) => b.text().includes(label))!;

async function quoteAndFillPassword() {
  await button('gomining.getBtcPrice').trigger('click');
  await vi.waitFor(() => expect(wrapper.find('[data-testid="password"]').exists()).toBe(true));
  // The fee estimator is imported on demand; the dialog cannot price the payment before it answers.
  await vi.waitFor(() => expect(feeEstimate).toHaveBeenCalled());
  await settle();
  await wrapper.find('[data-testid="password"]').setValue('pw');
}

beforeEach(() => {
  api.createOrder.mockReset().mockResolvedValue(order());
  api.reportPayment.mockReset().mockResolvedValue(order({ status: 'payment_detected', txid: TXID }));
  api.getOrder.mockReset();
  send.mockReset().mockResolvedValue({ data: { success: true, txId: TXID } });
  withSession.mockClear();
  feeEstimate.mockClear();
  (walletStore as unknown as { utxos: unknown[] }).utxos = [{ value: '200000' }, { value: '50000' }];
});

afterEach(() => { wrapper?.unmount(); });

describe('GoMiningBuyDialog', () => {
  it('pays exactly the quote to its deposit address, then reports the payment', async () => {
    mountDialog();
    await quoteAndFillPassword();
    expect(api.createOrder).toHaveBeenCalledWith('tok', { collectionId: 7, requestId: expect.any(String) });

    await button('gomining.payNow').trigger('click');
    await vi.waitFor(() => expect(api.reportPayment).toHaveBeenCalled());

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      method: MessageTypes.SEND_BITCOIN,
      data: { recipientAddress: 'tb1qdeposit', amount: 61_234, feeRate: 12, password: 'pw' },
    });
    expect(api.reportPayment).toHaveBeenCalledWith('tok', 'ord_1', TXID);
    await settle();
    expect(wrapper.text()).toContain('gomining.orderPaymentDetected');
    expect(button('gomining.payNow')).toBeUndefined();
  });

  it('never pays the same quote twice', async () => {
    const sending = deferred<{ data: { success: boolean; txId: string } }>();
    send.mockReturnValueOnce(sending.promise);
    mountDialog();
    await quoteAndFillPassword();

    const pay = button('gomining.payNow');
    await pay.trigger('click');
    await pay.trigger('click');
    // Enter in the password field calls pay() directly, past the disabled button.
    wrapper.findComponent({ name: 'PasswordStub' }).vm.$emit('enter');
    await settle();
    sending.resolve({ data: { success: true, txId: TXID } });
    await vi.waitFor(() => expect(api.reportPayment).toHaveBeenCalled());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("refuses a quote for another network than the wallet's", async () => {
    api.createOrder.mockResolvedValueOnce(order({}, { network: 'Mainnet', address: 'bc1qdeposit' }));
    mountDialog();
    await quoteAndFillPassword();

    await button('gomining.payNow').trigger('click');
    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').exists()).toBe(true));
    expect(wrapper.find('[role="alert"]').text()).toContain('gomining.errorQuoteInvalid');
    expect(send).not.toHaveBeenCalled();
  });

  it('offers a new price instead of paying a quote that is about to run out', async () => {
    api.createOrder
      .mockResolvedValueOnce(order({}, { expiresAt: Date.now() + 60_000 }))
      .mockResolvedValueOnce(order({ id: 'ord_2' }));
    mountDialog();
    await quoteAndFillPassword();

    expect(button('gomining.payNow')).toBeUndefined();
    await button('gomining.newQuote').trigger('click');
    await vi.waitFor(() => expect(api.createOrder).toHaveBeenCalledTimes(2));
    const [first, second] = api.createOrder.mock.calls.map((call) => call[1].requestId);
    expect(second).not.toBe(first);
    expect(send).not.toHaveBeenCalled();
  });

  it('asks again with the same request id after a failed attempt, so a lost reply opens no second order', async () => {
    api.createOrder.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(order());
    mountDialog();
    await button('gomining.getBtcPrice').trigger('click');
    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').exists()).toBe(true));
    await button('gomining.getBtcPrice').trigger('click');
    await vi.waitFor(() => expect(api.createOrder).toHaveBeenCalledTimes(2));
    const [first, second] = api.createOrder.mock.calls.map((call) => call[1].requestId);
    expect(second).toBe(first);
  });

  it('will not pay when the wallet cannot cover amount and fee', async () => {
    (walletStore as unknown as { utxos: unknown[] }).utxos = [{ value: '61234' }];
    mountDialog();
    await quoteAndFillPassword();
    expect(button('gomining.payNow').attributes('disabled')).toBeDefined();
  });
});
