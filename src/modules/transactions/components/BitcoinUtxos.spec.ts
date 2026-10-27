import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import * as Vue from 'vue';
import { nextTick } from 'vue';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.reactive({
  loggedWallet: { chain: 'Bitcoin', network: 'Mainnet', addressType: 'segwit' },
  utxos: [] as unknown[],
  config: {},
}) }));
vi.mock('@/stores/priceStore', () => ({ priceStore: Vue.reactive({ btcUsd: { lastPrice: 100_000 } }) }));
vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
  }),
}));
vi.mock('@/shared/composables/useCurrencyConverter', () => ({
  useCurrencyConverter: () => ({ convertFiat: (n: number) => n, getCurrencySymbol: () => '$' }),
}));

import BitcoinUtxosTable from './BitcoinUtxosTable.vue';
import BitcoinUtxoDetail from './BitcoinUtxoDetail.vue';
import { bitcoinUtxoRows, shortOutpoint, type BitcoinUtxoRow } from './bitcoinUtxoRows';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);

const RECEIVE = 'bc1qreceive00000000000000000000000000000000';
const CHANGE = 'bc1qchange000000000000000000000000000000000';

// As the dashboard sees them: store broadcasts turn the sats bigint into a string.
const small = { txHash: 'a'.repeat(64), index: 0, address: RECEIVE, value: '50000', confirmed: true, derivationChain: 0, derivationIndex: 2 };
const large = { txHash: 'b'.repeat(64), index: 3, address: CHANGE, value: '123456', confirmed: false, derivationChain: 1, derivationIndex: 5 };

const globalProperties = mockGlobalProperties({
  $t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
});

const mountTable = (selectedUtxo?: BitcoinUtxoRow) => mount(BitcoinUtxosTable, {
  props: { selectedUtxo },
  global: { plugins: [createTestVuetify()], config: { globalProperties } },
});

const mountDetail = (utxo: unknown) => mount(BitcoinUtxoDetail, {
  props: { utxo } as never,
  global: { plugins: [createTestVuetify()], config: { globalProperties } },
});

beforeEach(() => {
  walletStore.loggedWallet = { chain: 'Bitcoin', network: 'Mainnet', addressType: 'segwit' };
  walletStore.utxos = [small, large] as never;
});

describe('Bitcoin UTxO rows', () => {
  it('reads sats from a bigint or the string a broadcast leaves, and the chain from derivationChain', () => {
    const rows = bitcoinUtxoRows([{ ...small, value: 50_000n }, large]);
    expect(rows.map((row) => [row.id, row.sats, row.kind, row.confirmed])).toEqual([
      [`${'a'.repeat(64)}:0`, 50_000n, 'receive', true],
      [`${'b'.repeat(64)}:3`, 123_456n, 'change', false],
    ]);
  });

  it('skips what is not a Bitcoin UTxO, so the tab counts only what the list shows', () => {
    const cardanoPair = [{ txId: 'c'.repeat(64), index: 0 }, { address: 'addr1', value: { coins: 1n } }];
    expect(bitcoinUtxoRows([cardanoPair, { ...small, value: 'not sats' }, small])).toHaveLength(1);
    expect(bitcoinUtxoRows(null)).toEqual([]);
  });

  it('leaves the kind unknown when sync did not record the chain', () => {
    const [row] = bitcoinUtxoRows([{ ...small, derivationChain: undefined, derivationIndex: undefined }]);
    expect(row.kind).toBeNull();
    expect(row.addressIndex).toBeNull();
  });

  it('shortens the txid of an outpoint but keeps its output index', () => {
    expect(shortOutpoint({ txHash: 'b'.repeat(64), index: 13 })).toBe('bbbbbbbb…bbbbbb:13');
  });
});

describe('Bitcoin UTxOs list', () => {
  it('lists outputs largest first in BTC, with their sats', () => {
    const wrapper = mountTable();
    const rows = wrapper.findAll('.btc-utxo');
    expect(rows).toHaveLength(2);
    expect(wrapper.find('.btc-utxos__count').text()).toBe('2');
    expect(rows[0].find('.btc-utxo__ref').text()).toBe('bbbbbbbb…bbbbbb:3');
    expect(rows[0].find('.btc-utxo__amount').text()).toBe('0.00123456 BTC');
    expect(rows[0].find('.btc-utxo__sats').text()).toBe('bitcoin.satsValue:{"value":"123,456"}');
    expect(rows[1].find('.btc-utxo__amount').text()).toBe('0.00050000 BTC');
  });

  it('tags change and unconfirmed outputs', () => {
    const [changeRow, receiveRow] = mountTable().findAll('.btc-utxo');
    expect(changeRow.find('.btc-utxo__meta').text()).toContain('receive.changeChip');
    expect(changeRow.find('.btc-utxo__meta').text()).toContain('mempool.unconfirmed');
    expect(changeRow.find('.btc-utxo__amount').classes()).toContain('btc-utxo__amount--pending');
    expect(receiveRow.find('.btc-utxo__meta').text()).not.toContain('receive.changeChip');
    expect(receiveRow.find('.btc-utxo__meta').text()).not.toContain('mempool.unconfirmed');
  });

  it('reverses the order and filters by address', async () => {
    const wrapper = mountTable();
    await wrapper.find('.btc-icon-btn').trigger('click');
    expect(wrapper.findAll('.btc-utxo__amount')[0].text()).toBe('0.00050000 BTC');

    await wrapper.find('.btc-search__input').setValue('BC1QCHANGE');
    expect(wrapper.findAll('.btc-utxo')).toHaveLength(1);
    expect(wrapper.find('.btc-utxo__ref').text()).toBe('bbbbbbbb…bbbbbb:3');

    await wrapper.find('.btc-search__input').setValue('nothing like this');
    expect(wrapper.find('.btc-utxos__empty').text()).toContain('transactions.noUtxos');
  });

  it('emits the clicked row and marks the selected one', async () => {
    const [selected] = bitcoinUtxoRows([small]);
    const wrapper = mountTable(selected);
    expect(wrapper.find('.btc-utxo--selected .btc-utxo__ref').text()).toBe('aaaaaaaa…aaaaaa:0');

    await wrapper.findAll('.btc-utxo__main')[0].trigger('click');
    const [row] = wrapper.emitted('row-click')![0] as [BitcoinUtxoRow];
    expect(row).toMatchObject({ id: `${'b'.repeat(64)}:3`, sats: 123_456n, kind: 'change' });
  });
});

describe('Bitcoin UTxO detail', () => {
  const [changeRow] = bitcoinUtxoRows([large]);

  it('shows the amount, its sats and fiat, and that it is unconfirmed', () => {
    const wrapper = mountDetail(changeRow);
    expect(wrapper.find('.tx-hero__amount-value').text()).toBe('0.00123456 BTC');
    expect(wrapper.find('.tx-hero__amount-value').classes()).toContain('tx-hero__amount-value--pending');
    expect(wrapper.find('.tx-hero__amount').text()).toContain('bitcoin.satsValue:{"value":"123,456"}');
    expect(wrapper.find('.tx-hero__amount').text()).toContain('transactions.fiatAtTodaysPrice');
    expect(wrapper.find('.tx-status').classes()).toContain('tx-status--pending');
    expect(wrapper.find('.tx-status').text()).toContain('mempool.unconfirmed');
  });

  it('names the change address and the path sync derived it at', () => {
    const text = mountDetail(changeRow).find('.tx-facts').text();
    expect(text).toContain('bitcoin.changeAddress');
    expect(text).toContain("m/84'/0'/0'/1/5");
  });

  it('links the transaction that created the output', () => {
    const link = mountDetail(changeRow).find('a.tx-fact__link');
    expect(link.attributes('href')).toContain('b'.repeat(64));
  });

  it('follows the store when the output confirms', async () => {
    const wrapper = mountDetail(changeRow);
    walletStore.utxos = [small, { ...large, confirmed: true }] as never;
    await nextTick();
    expect(wrapper.find('.tx-status').classes()).toContain('tx-status--confirmed');
    expect(wrapper.find('.tx-status').text()).toContain('transactions.confirmed');
  });

  it('shows nothing for a row from another chain', () => {
    const cardanoRow = { id: `${'c'.repeat(64)}#0`, txHash: 'c'.repeat(64), outputIndex: 0, lovelace: 1_000_000n };
    expect(mountDetail(cardanoRow).find('.tx-details').exists()).toBe(false);
  });
});
