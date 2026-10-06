import Vue, { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/walletStore', () => ({
  walletStore: Vue.observable({ loggedWallet: { chain: 'Midnight', network: 'Mainnet' }, transactions: [], utxos: [] }),
}));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: Vue.observable({ transactions: [] as unknown[], utxos: [] }) }));
vi.mock('@/shared/composables/useFeatureNotifications', () => ({ isFeatureNew: () => false, markFeatureAsSeen: () => {} }));

// The page's children, reduced to what this spec observes: which transaction the
// detail pane was handed.
const { blank } = vi.hoisted(() => ({ blank: { render: (h: Vue.CreateElement) => h('div') } }));
vi.mock('@/modules/dashboard/components/TransactionsCard.vue', () => ({ default: blank }));
vi.mock('@/shared/components/TransactionDetails.vue', () => ({ default: blank }));
vi.mock('@/modules/transactions/components/UtxosTable.vue', () => ({ default: blank }));
vi.mock('@/modules/transactions/components/UtxoDetail.vue', () => ({ default: blank }));
vi.mock('@/shared/dialogs/ReportDialog.vue', () => ({ default: blank }));
vi.mock('@/modules/transactions/components/MidnightTransactionsList.vue', () => ({ default: blank }));
vi.mock('@/modules/transactions/components/MidnightUtxosTable.vue', () => ({ default: blank }));
vi.mock('@/modules/transactions/components/MidnightUtxoDetail.vue', () => ({ default: blank }));
vi.mock('@/shared/components/NotificationDot.vue', () => ({
  default: { render(this: Vue, h: Vue.CreateElement) { return h('span', this.$slots['default']); } },
}));
vi.mock('@/modules/transactions/components/MidnightTransactionDetails.vue', () => ({
  default: {
    props: ['transactionInfo'],
    render(this: Vue & { transactionInfo?: { hash: string } }, h: Vue.CreateElement) {
      return h('div', { class: 'detail' }, this.transactionInfo?.hash ?? '');
    },
  },
}));

import TransactionsSfc from './Transactions.vue';
import { midnightStore } from '@/stores/midnightStore';
import type { MidnightTransaction } from '@/chains/midnight/midnightTypes';

// test-utils v1's mount() typings predate <script setup> components.
const Transactions = TransactionsSfc as unknown as Parameters<typeof mount>[0];

const HASH = 'ab'.repeat(32);
const midnightTx: MidnightTransaction = {
  hash: HASH, type: 'send', token: 'NIGHT', amount: 1n, counterparty: '', timestamp: 0,
  status: 'confirmed', fee: 0n, isShielded: false,
};

function mountPage(query: Record<string, string> = {}) {
  const route = Vue.observable({ query });
  const wrapper = mount(Transactions, {
    mocks: { $route: route, $t: (key: string) => key },
    stubs: { 'v-icon': true },
  });
  return { wrapper, route };
}

const historySelected = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('.tx-tab').at(0).attributes('aria-selected');

describe('Transactions page, ?tx= deep link', () => {
  afterEach(() => { midnightStore.transactions = []; });

  it('reveals History when a search selects a transaction while UTxOs is open', async () => {
    midnightStore.transactions = [midnightTx];
    const { wrapper, route } = mountPage();
    await wrapper.findAll('.tx-tab').at(1).trigger('click');
    expect(historySelected(wrapper)).toBe('false');

    // Global search navigates the kept-alive page to `?tx=`.
    route.query = { tx: HASH };
    await nextTick();
    await nextTick();

    expect(historySelected(wrapper)).toBe('true');
    expect(wrapper.find('.detail').text()).toBe(HASH);
    wrapper.destroy();
  });

  it('selects a Midnight transaction whose history arrives after the page', async () => {
    const { wrapper } = mountPage({ tx: HASH });
    expect(wrapper.find('.detail').exists()).toBe(false);

    midnightStore.transactions = [midnightTx];
    await nextTick();
    await nextTick();

    expect(wrapper.find('.detail').text()).toBe(HASH);
    wrapper.destroy();
  });
});
