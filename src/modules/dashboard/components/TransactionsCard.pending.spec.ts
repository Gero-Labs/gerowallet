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
vi.mock('@/api/blockchain-api', () => ({ default: { getPoolById: vi.fn() } }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string, params?: { pool?: string }) => params?.pool ? `${key}:${params.pool}` : key }) }));
vi.mock('@/shared/composables/useCurrencyConverter', () => ({ useCurrencyConverter: () => ({ convertFiat: (n: number) => n, getCurrencySymbol: () => '$' }) }));
vi.mock('@/shared/composables/useCnightDustRegistration', () => ({ DUST_MAPPING_VALIDATOR: '' }));
vi.mock('@/modules/dashboard/dialogs/TransactionDetailsDialog.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/modules/dashboard/dialogs/BitcoinTransactionDetailsDialog.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/modules/dashboard/components/StackedTokens.vue', () => ({ default: { template: '<div />' } }));

import TransactionsCard from './TransactionsCard.vue';
import RecentTransactionsCard from './RecentTransactionsCard.vue';
import { walletStore } from '@/stores/walletStore';
import staking from '@/stores/stakingStore';
import blockchainApi from '@/api/blockchain-api';

function mountHistory() {
  return mount(TransactionsCard, {
      mocks: { $route: { path: '/transactions' }, $t: (key: string, params?: { pool?: string }) => params?.pool ? `${key}:${params.pool}` : key },
      stubs: {
        'v-data-table': { props: ['items'], template: '<div><div v-for="item in items" :key="item.id" :data-id="item.id"><slot name="item.tx_timestamp" :item="item" /></div></div>' },
        'v-tooltip': { template: '<span><slot name="activator" :on="{}" :attrs="{}" /></span>' },
        'v-menu': true, 'v-select': true, 'v-text-field': true, 'v-pagination': true,
      },
    });
}

describe('pending history rows', () => {
  it('shows a submitted transaction while pool metadata for an older row is still loading', async () => {
    let release!: (pool: { ticker: string }) => void;
    const metadata = new Promise<{ ticker: string }>(resolve => { release = resolve; });
    vi.mocked(blockchainApi.getPoolById).mockReturnValue(metadata);
    const base = { tx_timestamp: Math.floor(Date.now() / 1000), ada: -200000, sentAmount: 200000, receivedAmount: 0,
      assets: [], sentAssets: [], receivedAssets: [], utxo: { inputs: [], outputs: [] }, body: { inputs: [], outputs: [] },
    };
    walletStore.transactions = [{ ...base, id: 'older-delegation', pending: false, body: {
      ...base.body, certificates: [{ __typename: Cardano.CertificateType.StakeDelegation, poolId: 'pool-test' }],
    } }];
    const wrapper = mountHistory();
    try {
      await vi.waitFor(() => expect(blockchainApi.getPoolById).toHaveBeenCalled());
      walletStore.transactions = [...walletStore.transactions, { ...base, id: 'new-send', pending: true, tx_timestamp: base.tx_timestamp + 1 }];
      await nextTick();
      expect(wrapper.find('[data-id="new-send"]').exists()).toBe(true);
      expect(wrapper.find('[data-id="new-send"] .pending-indicator').exists()).toBe(true);
      walletStore.transactions = walletStore.transactions.map(tx => ({ ...tx, pending: false }));
      await nextTick();
      expect(wrapper.find('[data-id="new-send"] .pending-indicator').exists()).toBe(false);
      release({ ticker: 'POOL' });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(wrapper.find('[data-id="older-delegation"]').text()).toContain('transactions.delegatingTo');
      expect(wrapper.find('[data-id="new-send"]').exists()).toBe(true);
      expect(wrapper.find('[data-id="new-send"] .pending-indicator').exists()).toBe(false);
    } finally {
      release({ ticker: 'POOL' });
      wrapper.destroy();
    }
  });
});


describe('recent pending rows', () => {
  it('shows a new row and a pending indicator, then clears the indicator on confirmation', async () => {
    walletStore.transactions = [];
    const wrapper = mount(RecentTransactionsCard, {
      mocks: { $t: (key: string, params?: { pool?: string }) => params?.pool ? `${key}:${params.pool}` : key },
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


describe('pool lookup isolation', () => {
  it('returns each concurrent request own pool even when currentPool changes before callers resume', async () => {
    let resolveA!: (value: { ticker: string }) => void;
    let resolveB!: (value: { ticker: string }) => void;
    vi.mocked(blockchainApi.getPoolById)
      .mockImplementationOnce(() => new Promise(resolve => { resolveA = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveB = resolve; }));
    const wallet = { chain: 'Cardano', network: 'Preprod' };
    const resultA = staking.loadPoolById(wallet, 'pool-a');
    const resultB = staking.loadPoolById(wallet, 'pool-b');
    resolveA({ ticker: 'AAA' });
    resolveB({ ticker: 'BBB' });
    const [a, b] = await Promise.all([resultA, resultB]);
    expect(a).toEqual({ ticker: 'AAA' });
    expect(b).toEqual({ ticker: 'BBB' });
    expect(staking.state.currentPool).toEqual({ ticker: 'BBB' });
  });

  it.each(['missing', 'failed'])('returns null for a %s lookup instead of a previous pool', async (mode) => {
    staking.setCurrentPool({ ticker: 'PREVIOUS' });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      if (mode === 'missing') vi.mocked(blockchainApi.getPoolById).mockResolvedValueOnce(null);
      else vi.mocked(blockchainApi.getPoolById).mockRejectedValueOnce(new Error('offline'));
      expect(await staking.loadPoolById({ chain: 'Cardano', network: 'Preprod' }, 'new-pool')).toBeNull();
    } finally { errorLog.mockRestore(); }
  });
});


it('keeps labels tied to their pool across overlapping history batches', async () => {
  const resolvers = new Map<string, (pool: { ticker: string }) => void>();
  const responses = new Map(['pool-a', 'pool-b'].map(id => [id,
    new Promise<{ ticker: string }>(resolve => resolvers.set(id, resolve)),
  ]));
  vi.mocked(blockchainApi.getPoolById).mockImplementation(id => responses.get(id)!);
  const delegation = (id: string, timestamp: number) => ({
    id, pending: true, tx_timestamp: timestamp, ada: -200000, sentAmount: 200000, receivedAmount: 0,
    assets: [], sentAssets: [], receivedAssets: [], utxo: { inputs: [], outputs: [] },
    body: { inputs: [], outputs: [], certificates: [{ __typename: Cardano.CertificateType.StakeDelegation, poolId: id }] },
  });
  walletStore.transactions = [delegation('pool-a', Math.floor(Date.now() / 1000))];
  const wrapper = mountHistory();
  try {
    await vi.waitFor(() => expect(blockchainApi.getPoolById).toHaveBeenCalledWith('pool-a', 'Cardano', 'Preprod'));
    walletStore.transactions = [...walletStore.transactions, delegation('pool-b', Math.floor(Date.now() / 1000) + 1)];
    await nextTick();
    expect(blockchainApi.getPoolById).toHaveBeenCalledWith('pool-b', 'Cardano', 'Preprod');
    // Settle both requests in the same turn: both store writes happen before
    // the waiting history callers resume. Reading currentPool here gives B twice.
    resolvers.get('pool-a')!({ ticker: 'AAA' });
    resolvers.get('pool-b')!({ ticker: 'BBB' });
    await vi.waitFor(() => {
      expect(wrapper.find('[data-id="pool-a"]').text()).toContain('transactions.delegatingTo:AAA');
      expect(wrapper.find('[data-id="pool-b"]').text()).toContain('transactions.delegatingTo:BBB');
    });
  } finally {
    for (const resolve of resolvers.values()) resolve({ ticker: 'cleanup' });
    wrapper.destroy();
  }
});
