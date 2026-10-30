import { mockGlobalProperties } from '@test/helpers/globalProperties';
import * as Vue from 'vue';
import { nextTick } from 'vue';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import { createRouter, createMemoryHistory, RouterView } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/walletStore', () => ({
  walletStore: Vue.reactive({ loggedWallet: { chain: 'Midnight', network: 'Mainnet' }, transactions: [], utxos: [] }),
}));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: Vue.reactive({ transactions: [] as unknown[], utxos: [] }) }));
vi.mock('@/shared/composables/useFeatureNotifications', () => ({ isFeatureNew: () => false, markFeatureAsSeen: () => {} }));

// The page's children, reduced to what this spec observes: which transaction the
// detail pane was handed.
const { blank } = vi.hoisted(() => ({ blank: { render: () => Vue.h('div') } }));
vi.mock('@/modules/dashboard/components/TransactionsCard.vue', () => ({ default: blank }));
vi.mock('@/shared/components/TransactionDetails.vue', () => ({ default: blank }));
vi.mock('@/modules/transactions/components/UtxosTable.vue', () => ({ default: blank }));
vi.mock('@/modules/transactions/components/UtxoDetail.vue', () => ({ default: blank }));
vi.mock('@/shared/dialogs/ReportDialog.vue', () => ({ default: blank }));
vi.mock('@/modules/transactions/components/MidnightTransactionsList.vue', () => ({ default: blank }));
vi.mock('@/modules/transactions/components/MidnightUtxosTable.vue', () => ({ default: blank }));
vi.mock('@/modules/transactions/components/MidnightUtxoDetail.vue', () => ({ default: blank }));
vi.mock('@/modules/transactions/components/BitcoinTransactionDetails.vue', () => ({ default: blank }));
vi.mock('@/modules/transactions/components/BitcoinUtxosTable.vue', () => ({
  default: { render: () => Vue.h('div', { class: 'btc-utxos-list' }) },
}));
vi.mock('@/modules/transactions/components/BitcoinUtxoDetail.vue', () => ({ default: blank }));
vi.mock('@/shared/components/NotificationDot.vue', () => ({
  default: { render(this: Vue.ComponentPublicInstance) { return Vue.h('span', this.$slots['default']?.()); } },
}));
vi.mock('@/modules/transactions/components/MidnightTransactionDetails.vue', () => ({
  default: {
    props: ['transactionInfo'],
    render(this: Vue.ComponentPublicInstance & {
    transactionInfo?: {
        hash: string;
    };
}) {
    return Vue.h('div', { class: 'detail' }, this.transactionInfo?.hash ?? '');
},
  },
}));

import TransactionsSfc from './Transactions.vue';
import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';
import type { MidnightTransaction } from '@/chains/midnight/midnightTypes';

enableAutoUnmount(afterEach);

const HASH = 'ab'.repeat(32);
const midnightTx: MidnightTransaction = {
  hash: HASH, type: 'send', token: 'NIGHT', amount: 1n, counterparty: '', timestamp: 0,
  status: 'confirmed', fee: 0n, isShielded: false,
};

async function mountPage(query: Record<string, string> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/transactions', component: TransactionsSfc },
    { path: '/away', component: { template: '<div data-testid="away">Away</div>' } },
  ] });
  await router.push({ path: '/transactions', query });
  await router.isReady();
  const Host = Vue.defineComponent({
    render: () => Vue.h(RouterView, null, {
      default: ({ Component }: { Component: Vue.VNode }) => Vue.h(Vue.KeepAlive, null, { default: () => Component }),
    }),
  });
  const wrapper = mount(Host, { global: {
    plugins: [router], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) }, stubs: { 'v-icon': true },
  } });
  await flushPromises();
  return { wrapper, router };
}

const historySelected = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('.tx-tab').at(0).attributes('aria-selected');

describe('Transactions page, ?tx= deep link', () => {
  afterEach(() => { midnightStore.transactions = []; });

  it('reveals History when a search selects a transaction while UTxOs is open', async () => {
    midnightStore.transactions = [midnightTx];
    const { wrapper, router } = await mountPage();
    await wrapper.findAll('.tx-tab').at(1).trigger('click');
    expect(historySelected(wrapper)).toBe('false');

    // Global search navigates the kept-alive page to `?tx=`.
    await router.push({ path: '/transactions', query: { tx: HASH } });
    await nextTick();
    await nextTick();

    expect(historySelected(wrapper)).toBe('true');
    expect(wrapper.find('.detail').text()).toBe(HASH);
  });

  it('selects a Midnight transaction whose history arrives after the page', async () => {
    const { wrapper } = await mountPage({ tx: HASH });
    expect(wrapper.find('.detail').exists()).toBe(false);

    midnightStore.transactions = [midnightTx];
    await nextTick();
    await nextTick();

    expect(wrapper.find('.detail').text()).toBe(HASH);
  });
  it('retains the visited UTxO tab when navigating away and back through RouterView/KeepAlive', async () => {
    const { wrapper, router } = await mountPage();
    const page = wrapper.findComponent(TransactionsSfc).vm.$;
    await wrapper.findAll('.tx-tab')[1].trigger('click');
    expect(historySelected(wrapper)).toBe('false');
    await router.push('/away');
    await flushPromises();
    expect(wrapper.find('[data-testid="away"]').exists()).toBe(true);
    expect(wrapper.findAll('.tx-tab')).toHaveLength(0);
    await router.push('/transactions');
    await flushPromises();
    expect(wrapper.findComponent(TransactionsSfc).vm.$).toBe(page);
    expect(historySelected(wrapper)).toBe('false');
  });
});

describe('Transactions page, Bitcoin UTxOs', () => {
  afterEach(() => {
    walletStore.loggedWallet = { chain: 'Midnight', network: 'Mainnet' };
    walletStore.utxos = [];
  });

  it('counts the IUnifiedUtxo records sync stores and opens the Bitcoin list', async () => {
    walletStore.loggedWallet = { chain: 'Bitcoin', network: 'Mainnet' };
    walletStore.utxos = [
      { txHash: 'a'.repeat(64), index: 0, address: 'bc1qa', value: '1000', confirmed: true },
      { txHash: 'b'.repeat(64), index: 1, address: 'bc1qb', value: '2000', confirmed: false },
    ] as never;
    const { wrapper } = await mountPage({ tab: 'utxos' });
    expect(wrapper.findAll('.tx-tab__count')[1].text()).toBe('2');
    expect(wrapper.find('.btc-utxos-list').exists()).toBe(true);
  });
});
