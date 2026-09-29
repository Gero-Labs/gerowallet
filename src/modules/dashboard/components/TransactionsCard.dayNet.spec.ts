import Vue from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.observable({
  transactions: [], loggedWallet: { chain: 'Cardano', network: 'Preprod' }, keys: {}, contacts: {}, config: {},
}) }));
vi.mock('@/stores/networkStore', () => ({ networkStore: Vue.observable({ assets: {} }) }));
vi.mock('@/stores/loading', () => ({ loadingState: Vue.observable({ loadingTxs: false }) }));
vi.mock('@/stores/priceStore', () => ({ priceStore: Vue.observable({ adaUsd: null }) }));
vi.mock('@/api/blockchain-api', () => ({ default: { getPoolById: vi.fn() } }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/composables/useCurrencyConverter', () => ({ useCurrencyConverter: () => ({ convertFiat: (n: number) => n, getCurrencySymbol: () => '$' }) }));
vi.mock('@/shared/composables/useCnightDustRegistration', () => ({ DUST_MAPPING_VALIDATOR: {} }));
vi.mock('@/modules/dashboard/dialogs/TransactionDetailsDialog.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/modules/dashboard/dialogs/BitcoinTransactionDetailsDialog.vue', () => ({ default: { template: '<div />' } }));

import TransactionsCard from './TransactionsCard.vue';
import { walletStore } from '@/stores/walletStore';

const record = (id: string, ada: number, secondsAgo: number, pending: boolean) => ({
  id, pending, tx_timestamp: Math.floor(Date.now() / 1000) - secondsAgo,
  ada, sentAmount: ada < 0 ? -ada : 0, receivedAmount: ada > 0 ? ada : 0,
  assets: [], sentAssets: [], receivedAssets: [], utxo: { inputs: [], outputs: [] },
});

afterEach(() => vi.useRealTimers());

describe('day header net', () => {
  it('leaves a failed attempt (pending past the hour) out of the day\'s net', async () => {
    // Midday, so both records fall on "today" whatever the real clock says
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 29, 12, 0, 0));
    walletStore.transactions = [
      record('received', 10_000_000, 3600, false),
      record('failed-send', -2_000_000, 3 * 3600, true),
    ];
    const wrapper = mount(TransactionsCard, {
      mocks: { $route: { path: '/transactions' }, $t: (key: string) => key },
      stubs: { 'v-tooltip': true, 'v-menu': true, 'v-pagination': true },
    });
    try {
      await vi.waitFor(() => expect(wrapper.find('[data-id="failed-send"]').exists()).toBe(true));
      // The failed row is still listed, but only the confirmed +10 counts
      expect(wrapper.find('.tx-day__net').text()).toMatch(/^\+ \S*10$/);
    } finally {
      wrapper.destroy();
    }
  });
});
