import Vue, { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { Cardano } from '@cardano-sdk/core';

vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.observable({
  transactions: [], loggedWallet: { chain: 'Cardano', network: 'Preprod' }, keys: {}, contacts: {}, config: {},
}) }));
vi.mock('@/stores/networkStore', () => ({ networkStore: Vue.observable({ assets: {} }) }));
vi.mock('@/stores/loading', () => ({ loadingState: Vue.observable({ loadingTxs: false }) }));
vi.mock('@/stores/priceStore', () => ({ priceStore: Vue.observable({ adaUsd: null }) }));
vi.mock('@/stores/stakingStore', () => ({ default: { loadPoolById: vi.fn(), state: {} } }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/composables/useCurrencyConverter', () => ({ useCurrencyConverter: () => ({ convertFiat: (n: number) => n, getCurrencySymbol: () => '$' }) }));
vi.mock('@/shared/composables/useCnightDustRegistration', () => ({ DUST_MAPPING_VALIDATOR: '' }));
vi.mock('@/modules/dashboard/dialogs/TransactionDetailsDialog.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/modules/dashboard/dialogs/BitcoinTransactionDetailsDialog.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/modules/dashboard/components/StackedTokens.vue', () => ({ default: { template: '<div />' } }));

import TransactionsCard from './TransactionsCard.vue';
import RecentTransactionsCard from './RecentTransactionsCard.vue';
import { walletStore } from '@/stores/walletStore';
import staking from '@/stores/stakingStore';

describe('pending history rows', () => {
  it('shows a submitted transaction while pool metadata for an older row is still loading', async () => {
    let release!: () => void;
    const metadata = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(staking.loadPoolById).mockReturnValue(metadata);
    const base = { tx_timestamp: Math.floor(Date.now() / 1000), ada: -200000, sentAmount: 200000, receivedAmount: 0,
      assets: [], sentAssets: [], receivedAssets: [], utxo: { inputs: [], outputs: [] }, body: { inputs: [], outputs: [] },
    };
    walletStore.transactions = [{ ...base, id: 'older-delegation', pending: false, body: {
      ...base.body, certificates: [{ __typename: Cardano.CertificateType.StakeDelegation, poolId: 'pool-test' }],
    } }];
    const wrapper = mount(TransactionsCard, {
      mocks: { $route: { path: '/transactions' }, $t: (key: string) => key },
      stubs: {
        'v-data-table': { props: ['items'], template: '<div><div v-for="item in items" :key="item.id" :data-id="item.id"><slot name="item.tx_timestamp" :item="item" /></div></div>' },
        'v-tooltip': { template: '<span><slot name="activator" :on="{}" :attrs="{}" /></span>' },
        'v-menu': true, 'v-select': true, 'v-text-field': true, 'v-pagination': true,
      },
    });
    try {
      await vi.waitFor(() => expect(staking.loadPoolById).toHaveBeenCalled());
      walletStore.transactions = [...walletStore.transactions, { ...base, id: 'new-send', pending: true, tx_timestamp: base.tx_timestamp + 1 }];
      await nextTick();
      expect(wrapper.find('[data-id="new-send"]').exists()).toBe(true);
      expect(wrapper.find('[data-id="new-send"] .pending-indicator').exists()).toBe(true);
      walletStore.transactions = walletStore.transactions.map(tx => ({ ...tx, pending: false }));
      await nextTick();
      expect(wrapper.find('[data-id="new-send"] .pending-indicator').exists()).toBe(false);
      Object.assign(staking.state, { currentPool: { ticker: 'POOL' } });
      release();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(wrapper.find('[data-id="older-delegation"]').text()).toContain('transactions.delegatingTo');
      expect(wrapper.find('[data-id="new-send"]').exists()).toBe(true);
      expect(wrapper.find('[data-id="new-send"] .pending-indicator').exists()).toBe(false);
    } finally {
      release();
      wrapper.destroy();
    }
  });
});


describe('recent pending rows', () => {
  it('shows a new row and a pending indicator, then clears the indicator on confirmation', async () => {
    walletStore.transactions = [];
    const wrapper = mount(RecentTransactionsCard, {
      mocks: { $t: (key: string) => key },
      stubs: { 'router-link': true, 'v-progress-circular': { template: '<span role="progressbar" v-bind="$attrs" />' } },
    });
    try {
      walletStore.transactions = [{ id: 'new-send', pending: true, tx_timestamp: Math.floor(Date.now() / 1000),
        ada: -200000, sentAmount: 200000, receivedAmount: 0, assets: [],
      }];
      await nextTick();
      expect(wrapper.findAll('.recent-tx-row')).toHaveLength(1);
      expect(wrapper.find('[role="progressbar"]').attributes('aria-label')).toBe('dashboard.transactionPendingConfirmation');
      walletStore.transactions = walletStore.transactions.map(tx => ({ ...tx, pending: false }));
      await nextTick();
      expect(wrapper.findAll('.recent-tx-row')).toHaveLength(1);
      expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
    } finally {
      wrapper.destroy();
    }
  });
});
