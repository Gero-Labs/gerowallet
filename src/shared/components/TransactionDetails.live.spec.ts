import Vue, { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.observable({
  transactions: [], loggedWallet: { chain: 'Cardano', network: 'Preprod' }, keys: {}, contacts: {}, config: {},
}) }));
vi.mock('@/stores/priceStore', () => ({ priceStore: Vue.observable({ adaUsd: null }) }));
vi.mock('@/stores/stakingStore', () => ({ default: { loadPoolById: vi.fn().mockResolvedValue(null), state: {} } }));
vi.mock('@/api/blockchain-api', () => ({ default: { getPoolById: vi.fn(), getDRepById: vi.fn() } }));
vi.mock('@/db', () => ({ getBlockchainDb: vi.fn() }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/composables/useCurrencyConverter', () => ({ useCurrencyConverter: () => ({ convertFiat: (n: number) => n, getCurrencySymbol: () => '$' }) }));
vi.mock('@/shared/composables/useCnightDustRegistration', () => ({ DUST_MAPPING_VALIDATOR: {} }));
vi.mock('@/shared/dialogs/ReportDialog.vue', () => ({ default: { template: '<div />' } }));

import TransactionDetails from './TransactionDetails.vue';
import { walletStore } from '@/stores/walletStore';

const pending = {
  id: 'tx-pending-then-confirmed', tx_hash: 'tx-pending-then-confirmed', pending: true,
  tx_timestamp: Math.floor(Date.now() / 1000) - 30, tx_size: 400,
  ada: -2_000_000, sentAmount: 2_000_000, receivedAmount: 0,
  assets: [], sentAssets: [], receivedAssets: [], utxo: null, body: { inputs: [], outputs: [], fee: 170000 },
};

describe('transaction details', () => {
  it('follows the confirmed record when the pending one the pane was opened with is replaced', async () => {
    walletStore.transactions = [pending];
    // The pane keeps the object that was clicked; the store replaces it on confirmation
    const wrapper = mount(TransactionDetails, {
      propsData: { transactionInfo: pending },
      mocks: { $t: (key: string) => key },
    });
    try {
      expect(wrapper.find('.tx-status').text()).toContain('transactions.pending');

      walletStore.transactions = [{
        ...pending, pending: false, block_height: 4_100_000, block_hash: 'b'.repeat(64), epoch_no: 250,
        utxo: { inputs: [], outputs: [] },
      }];
      await nextTick();

      expect(wrapper.find('.tx-status').text()).toContain('transactions.confirmed');
      expect(wrapper.text()).toContain('4,100,000');
    } finally {
      wrapper.destroy();
    }
  });
});
