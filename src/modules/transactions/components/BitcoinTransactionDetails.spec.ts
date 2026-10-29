import { mockGlobalProperties } from '@test/helpers/globalProperties';
import * as Vue from 'vue';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

const OWN = 'bc1qownaddress0000000000000000000000000000';
const OTHER = 'bc1qsomeoneelse000000000000000000000000000';

vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.reactive({
  transactions: [],
  loggedWallet: { chain: 'Bitcoin', network: 'Mainnet', baseAddress: 'bc1qownaddress0000000000000000000000000000' },
  keys: null,
  contacts: {},
  config: {},
}) }));
vi.mock('@/stores/priceStore', () => ({ priceStore: Vue.reactive({ btcUsd: { lastPrice: 100_000 } }) }));
vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
    tc: (key: string, count: number) => `${key}#${count}`,
  }),
}));
vi.mock('@/shared/composables/useCurrencyConverter', () => ({
  useCurrencyConverter: () => ({ convertFiat: (n: number) => n, getCurrencySymbol: () => '$' }),
}));

import BitcoinTransactionDetails from './BitcoinTransactionDetails.vue';
import { walletStore } from '@/stores/walletStore';

const received = {
  id: 'a'.repeat(64),
  tx_timestamp: Math.floor(Date.now() / 1000) - 600,
  ada: 123_456,
  assets: [],
  pending: false,
  block_height: 900_000,
  fee: 1_410,
  confirmations: 2,
  type: 'receive',
  inputs: [{ address: OTHER, value: 200_000, txid: 'b'.repeat(64), vout: 1 }],
  outputs: [
    { address: OWN, value: 123_456 },
    { address: OTHER, value: 75_134 },
  ],
};

const mountDetails = (transactionInfo: unknown) =>
  mount(BitcoinTransactionDetails, {
    props: { transactionInfo } as never,
    global: {
      config: {
        globalProperties: mockGlobalProperties({
          $t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
        }),
      },
    },
  });

describe('Bitcoin transaction details', () => {
  afterEach(() => {
    walletStore.transactions = [];
  });

  it('shows the amount in BTC with all eight decimals, and its sats', () => {
    const wrapper = mountDetails(received);
    try {
      expect(wrapper.find('.tx-hero__amount-value').text()).toBe('+ 0.00123456 BTC');
      expect(wrapper.find('.tx-hero__amount-value').classes()).toContain('tx-hero__amount-value--in');
      expect(wrapper.find('.tx-hero__amount').text()).toContain('bitcoin.satsValue:{"value":"123,456"}');
    } finally {
      wrapper.unmount();
    }
  });

  it('counts confirmations until the sixth, then says confirmed', async () => {
    walletStore.transactions = [received] as never;
    const wrapper = mountDetails(received);
    try {
      expect(wrapper.find('.tx-status').text()).toContain('bitcoin.confirmationsCount#2');
      expect(wrapper.find('.tx-status').classes()).toContain('tx-status--pending');

      walletStore.transactions = [{ ...received, confirmations: 6 }] as never;
      await nextTick();

      expect(wrapper.find('.tx-status').text()).toContain('transactions.confirmed');
    } finally {
      wrapper.unmount();
    }
  });

  it('lists inputs and outputs, and marks the wallet\'s own address', () => {
    const wrapper = mountDetails(received);
    try {
      const rows = wrapper.findAll('.tx-utxo');
      expect(rows).toHaveLength(3);
      expect(rows[1].find('.tx-you').exists()).toBe(true);
      expect(rows[2].find('.tx-you').exists()).toBe(false);
      expect(rows[1].find('.tx-utxo__ada').text()).toBe('0.00123456 BTC');
    } finally {
      wrapper.unmount();
    }
  });

  it('shows a sent amount with a real minus sign', () => {
    const wrapper = mountDetails({ ...received, ada: -50_000, type: 'send' });
    try {
      expect(wrapper.find('.tx-hero__amount-value').text()).toBe('− 0.00050000 BTC');
    } finally {
      wrapper.unmount();
    }
  });
});
