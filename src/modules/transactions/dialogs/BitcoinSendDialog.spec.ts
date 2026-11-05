// Issue 1440: the Send dialog runs in a page, where the worker's fee estimator and
// its API don't exist. It used to show and sign at its own 50/25/10 sat/vB. These
// pin that the fee step shows the network's rates and the transaction uses them,
// and that the built-in fallback is never used without saying so.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import * as Vue from 'vue';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { MessageTypes } from '@/models/MessageTypes';
import type { BitcoinFeeEstimates } from '@/api/bitcoin-api';

const getFeeEstimates = vi.hoisted(() => vi.fn<() => Promise<BitcoinFeeEstimates>>());
const apiNetworks = vi.hoisted(() => [] as unknown[]);
vi.mock('@/api/bitcoin-api', () => ({
  BitcoinApi: class {
    getFeeEstimates = getFeeEstimates;
    constructor(wallet: { network: string }) { apiNetworks.push(wallet.network); }
  },
}));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: vi.fn() } }));
vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return {
    walletStore: reactive({
      loggedWallet: { id: 1, chain: 'Bitcoin', network: 'Mainnet', type: 'Normal', encryptionMethod: 'password' },
      utxos: [{ txHash: 'aa'.repeat(32), outputIndex: 0, value: 1_000_000n, confirmed: true }] as unknown[],
    }),
  };
});
vi.mock('@/stores/priceStore', () => ({ priceStore: { btcUsd: null } }));
vi.mock('@/shared/composables/useCurrencyConverter', () => ({
  useCurrencyConverter: () => ({ convertFiat: (value: number) => value, getCurrencySymbol: () => '$' }),
}));
vi.mock('@/chains/bitcoin/bitcoinKeyManager', () => ({ validateBitcoinAddress: () => true }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// `<script setup>` imports are not registered by name, so they are mocked as modules.
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({
  default: { name: 'BaseDialogStub', setup: (_p: unknown, { slots }: { slots: Vue.Slots }) => () => Vue.h('div', slots['default']?.()) },
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
import BitcoinSendDialog from './BitcoinSendDialog.vue';
import { Messaging } from '@/chrome/messaging';
import { getBitcoinFeeEstimatorFor } from '@/chains/bitcoin/bitcoinFeeEstimator';

const send = vi.mocked(Messaging.sendToBackgroundFromOptions);

// Esplora's rates as the e2e spec mocks them: next block 42, ~3 blocks 17, ~6 blocks 3, ~24 blocks 1.
const LIVE: BitcoinFeeEstimates = { fastestFee: 42, halfHourFee: 17, hourFee: 3, economyFee: 1, minimumFee: 1 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

let wrapper: VueWrapper;

function mountDialog() {
  wrapper = mount(BitcoinSendDialog, {
    props: { modelValue: false },
    global: {
      config: {
        globalProperties: mockGlobalProperties({
          $t: (key: string, params?: { value?: unknown }) => (params?.value !== undefined ? `${key}:${params.value}` : key),
        }),
      },
      stubs: {
        'v-icon': true,
        'v-btn': true,
        'v-progress-circular': true,
        'v-card-text': { setup: (_p: unknown, { slots }: { slots: Vue.Slots }) => () => Vue.h('div', slots['default']?.()) },
      },
    },
  });
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await Vue.nextTick();
}

const button = (label: string) => wrapper.findAll('button').find((b) => b.text().includes(label))!;

/** Opens the dialog and fills a valid recipient and amount, on step 1. */
async function openWithRecipient() {
  await wrapper.setProps({ modelValue: true });
  await wrapper.find('input.g-mono').setValue('bc1qrecipient');
  await wrapper.find('input[type="number"]').setValue('0.001');
  await settle();
}

beforeEach(async () => {
  getFeeEstimates.mockReset();
  apiNetworks.length = 0;
  send.mockReset();
  getBitcoinFeeEstimatorFor('Mainnet').clearCache();
});

afterEach(() => {
  wrapper?.unmount();
});

describe('BitcoinSendDialog fee rates (issue 1440)', () => {
  it('shows the network fee rates and signs at the chosen one', async () => {
    getFeeEstimates.mockResolvedValue(LIVE);
    mountDialog();
    await openWithRecipient();
    await button('common.continue').trigger('click');
    await settle();

    const text = wrapper.text();
    expect(text).toContain('bitcoin.feeRateValue:42');
    expect(text).toContain('bitcoin.feeRateValue:17');
    expect(text).toContain('bitcoin.feeRateValue:3');
    expect(text).not.toContain('bitcoin.feeRateValue:25');
    expect(text).not.toContain('bitcoin.feeRatesFallback');
    expect(apiNetworks).toContain('Mainnet');

    await button('common.continue').trigger('click');
    await wrapper.find('input[type="password"]').setValue('pw');
    send.mockResolvedValue({ data: { success: true, txId: 'ab'.repeat(32) } });
    await button('send.send').trigger('click');
    await settle();

    expect(send).toHaveBeenCalledWith({
      method: MessageTypes.SEND_BITCOIN,
      data: { recipientAddress: 'bc1qrecipient', amount: 100_000, feeRate: 17, password: 'pw' },
    });
  });

  it('keeps the fee step closed until the rates arrive', async () => {
    const rates = deferred<BitcoinFeeEstimates>();
    getFeeEstimates.mockReturnValue(rates.promise);
    mountDialog();
    await openWithRecipient();
    await button('common.continue').trigger('click');
    await settle();

    expect(wrapper.text()).not.toContain('bitcoin.feeRateValue');
    expect(button('common.continue').attributes('disabled')).toBeDefined();

    rates.resolve(LIVE);
    await settle();
    expect(wrapper.text()).toContain('bitcoin.feeRateValue:17');
    expect(button('common.continue').attributes('disabled')).toBeUndefined();
  });

  it('says so when it falls back to the built-in rates', async () => {
    getFeeEstimates.mockRejectedValue(new Error('network down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mountDialog();
    await openWithRecipient();
    await button('common.continue').trigger('click');
    await settle();

    expect(wrapper.text()).toContain('bitcoin.feeRatesFallback');
    expect(wrapper.text()).toContain('bitcoin.feeRateValue:10');
  });
});
