// Side-panel activity for a Solana wallet: Gero Sync's history, each row opening on
// Solscan, a failed transaction said as such, and older history linked when it exists.
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import * as Vue from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/walletStore', () => ({
  walletStore: Vue.reactive({
    transactions: [],
    loggedWallet: { chain: 'Solana', network: 'Devnet', publicKey: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk' },
    solana: { historyTruncated: false },
    solanaTransactions: [] as unknown[],
  }),
}));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: Vue.reactive({ transactions: [] }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../components/flows/TxDetailSheet.vue', () => ({ default: Vue.defineComponent({ render() { return Vue.h('div'); } }) }));

import ActivityPageSfc from './ActivityPage.vue';
import { walletStore } from '@/stores/walletStore';

const ActivityPage = ActivityPageSfc as unknown as Parameters<typeof mount>[0];
const store = walletStore as unknown as { solana: { historyTruncated: boolean }; solanaTransactions: unknown[] };
const SIG_OK = '5'.repeat(88);
const SIG_FAILED = '4'.repeat(88);

function mountPage() {
  return mount(ActivityPage, { global: { config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) }, stubs: { 'v-icon': true } } });
}

describe('side-panel activity: Solana rows', () => {
  beforeEach(() => {
    store.solana = { historyTruncated: false };
    store.solanaTransactions = [];
  });

  it('says there is no activity yet', () => {
    expect(mountPage().text()).toContain('solana.noActivity');
  });

  it('links each row to Solscan on the wallet network and marks a failed one', () => {
    store.solanaTransactions = [
      { signature: SIG_OK, slot: 2, blockTime: 1_758_000_000, success: true },
      { signature: SIG_FAILED, slot: 1, blockTime: 0, success: false },
    ];
    const [ok, failed] = mountPage().findAll('a.tx-item');
    expect(ok.attributes('href')).toBe(`https://solscan.io/tx/${SIG_OK}?cluster=devnet`);
    expect(ok.attributes('rel')).toContain('noopener');
    expect(ok.text()).not.toContain('transactions.failed');
    expect(failed.text()).toContain('transactions.failed');
    expect(failed.text()).toContain('solana.pending');
  });

  it('links older history on Solscan only when Gero Sync held some back', async () => {
    store.solanaTransactions = [{ signature: SIG_OK, slot: 2, blockTime: 1, success: true }];
    const wrapper = mountPage();
    expect(wrapper.find('.sol-more').exists()).toBe(false);
    store.solana = { historyTruncated: true };
    await Vue.nextTick();
    expect(wrapper.find('.sol-more').attributes('href')).toContain('/account/HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
  });
});
