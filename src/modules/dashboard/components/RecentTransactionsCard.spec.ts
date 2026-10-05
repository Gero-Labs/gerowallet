import Vue, { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/walletStore', () => ({
  walletStore: Vue.observable({
    transactions: [] as unknown[],
    loggedWallet: { chain: 'Cardano', network: 'Mainnet' },
    isSyncing: false,
  }),
}));
vi.mock('@/stores/loading', () => ({
  loadingState: Vue.observable({ connecting: false, syncPending: false, loadingTxs: false }),
}));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/modules/dashboard/dialogs/TransactionDetailsDialog.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/modules/dashboard/dialogs/BitcoinTransactionDetailsDialog.vue', () => ({ default: { template: '<div />' } }));

import RecentTransactionsCardSfc from './RecentTransactionsCard.vue';
import { walletStore } from '@/stores/walletStore';
import { loadingState } from '@/stores/loading';

// test-utils v1's mount() typings predate <script setup> components.
const RecentTransactionsCard = RecentTransactionsCardSfc as unknown as Parameters<typeof mount>[0];

const received = (id: string, secondsAgo: number) => ({
  id, tx_hash: id, pending: false, ada: 15_000_000, sentAmount: 0, receivedAmount: 15_000_000,
  tx_timestamp: Math.floor(Date.now() / 1000) - secondsAgo,
  assets: [], sentAssets: [], receivedAssets: [], utxo: { inputs: [], outputs: [] },
});

/** The header spinner's accessible name, or null when it is not shown. */
function busyLabel(wrapper: ReturnType<typeof mount>): string | null {
  const spinner = wrapper.find('.recent-tx-header .spinner');
  return spinner.exists() ? (spinner.attributes('aria-label') ?? '') : null;
}

function mountCard() {
  return mount(RecentTransactionsCard, {
    mocks: { $t: (key: string) => key },
    stubs: {
      'v-card': { template: '<div><slot /></div>' },
      'v-card-text': { template: '<div><slot /></div>' },
      'v-progress-circular': { template: '<i class="spinner" :aria-label="$attrs[\'aria-label\']" />' },
      'v-icon': true,
      'router-link': true,
    },
  });
}

describe('Recent Transactions card while the wallet is still loading or syncing', () => {
  beforeEach(() => {
    walletStore.transactions = [];
    walletStore.isSyncing = false;
    loadingState.connecting = false;
    loadingState.syncPending = false;
    loadingState.loadingTxs = false;
  });

  it('says "no transactions" only once nothing is loading or pending', () => {
    const wrapper = mountCard();
    expect(wrapper.text()).toContain('transactions.noTransactionsFound');
    expect(wrapper.find('.recent-tx-skeleton').exists()).toBe(false);
    expect(busyLabel(wrapper)).toBeNull();
    wrapper.destroy();
  });

  it.each([
    // Login sets walletStore.isSyncing (WalletStore.setSyncing), not the loading store's.
    ['the login is still restoring the wallet', () => { walletStore.isSyncing = true; }],
    ['the sync socket is not open yet', () => { loadingState.connecting = true; }],
    ['gero-sync has not answered the subscription', () => { loadingState.syncPending = true; }],
    ['a batch is being written', () => { loadingState.loadingTxs = true; }],
  ] as const)('shows placeholders instead of an empty state while %s', async (_reason, arrange) => {
    // The bug: at login the store is empty for a moment and the card claimed
    // "No transactions found" before anything had been asked of the chain.
    arrange();
    const wrapper = mountCard();
    await nextTick();
    expect(wrapper.text()).not.toContain('transactions.noTransactionsFound');
    expect(wrapper.findAll('.recent-tx-skeleton').length).toBeGreaterThan(0);
    expect(busyLabel(wrapper)).toBe('dashboard.recentTransactionsLoading');
    wrapper.destroy();
  });

  it('keeps last session\'s rows on screen with a header spinner, until the first sync answer', async () => {
    walletStore.transactions = [received('a', 36 * 60), received('b', 43 * 60)];
    loadingState.syncPending = true;
    const wrapper = mountCard();
    await nextTick();

    // Rows first: they are real, just possibly not the latest.
    expect(wrapper.findAll('.recent-tx-row:not(.recent-tx-row--placeholder)')).toHaveLength(2);
    expect(busyLabel(wrapper)).toBe('dashboard.checkingForTransactions');
    expect(wrapper.find('.recent-tx-skeleton').exists()).toBe(false);

    // The answer has been applied: the list is now the chain's.
    loadingState.syncPending = false;
    await nextTick();
    expect(busyLabel(wrapper)).toBeNull();
    expect(wrapper.findAll('.recent-tx-row')).toHaveLength(2);
    wrapper.destroy();
  });

  it('does not spin the header indicator for an ordinary loader pass once rows are shown', async () => {
    // loadingTxs is true for EVERY loader pass: each later live block, the
    // periodic cbor heal. Only an unanswered subscription is worth announcing.
    walletStore.transactions = [received('a', 120)];
    loadingState.loadingTxs = true;
    const wrapper = mountCard();
    await nextTick();
    expect(wrapper.findAll('.recent-tx-row')).toHaveLength(1);
    expect(busyLabel(wrapper)).toBeNull();
    expect(wrapper.find('.recent-tx-skeleton').exists()).toBe(false);
    wrapper.destroy();
  });

  it('turns placeholders into rows when the answer delivers them', async () => {
    loadingState.syncPending = true;
    const wrapper = mountCard();
    await nextTick();
    expect(wrapper.findAll('.recent-tx-skeleton').length).toBeGreaterThan(0);

    walletStore.transactions = [received('a', 120)];
    loadingState.syncPending = false;
    await nextTick();
    expect(wrapper.find('.recent-tx-skeleton').exists()).toBe(false);
    expect(wrapper.findAll('.recent-tx-row')).toHaveLength(1);
    expect(busyLabel(wrapper)).toBeNull();
    wrapper.destroy();
  });

  it('shows at most the five newest rows, newest first', async () => {
    walletStore.transactions = [0, 1, 2, 3, 4, 5, 6].map(i => received(`tx${i}`, i * 60));
    const wrapper = mountCard();
    await nextTick();
    const rows = wrapper.findAll('.recent-tx-row');
    expect(rows).toHaveLength(5);
    wrapper.destroy();
  });
});
