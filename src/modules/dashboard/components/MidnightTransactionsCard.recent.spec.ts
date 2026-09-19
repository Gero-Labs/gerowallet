import Vue from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/midnightStore', () => ({ midnightStore: Vue.observable({ transactions: [] as unknown[] }) }));
vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.observable({ loggedWallet: { chain: 'Midnight', network: 'Mainnet' } }) }));
vi.mock('@/chains/midnight/midnightSponsorLinks', () => ({ sponsoredTxFor: () => null, loadSponsoredTxs: async () => ({}) }));
vi.mock('@/chains/midnight/midnightTokenRegistry', () => ({ midnightTokenMeta: () => ({ symbol: 'USDM', decimals: 6 }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import MidnightTransactionsCardSfc from './MidnightTransactionsCard.vue';
import { midnightStore } from '@/stores/midnightStore';

// test-utils v1's mount() typings predate <script setup> components.
const MidnightTransactionsCard = MidnightTransactionsCardSfc as unknown as Parameters<typeof mount>[0];
const USDM = 'aa'.repeat(32);

function mountCard() {
  return mount(MidnightTransactionsCard, {
    mocks: { $t: (key: string) => key },
    stubs: { 'v-card': { template: '<div><slot /></div>' }, 'v-card-text': { template: '<div><slot /></div>' }, 'v-icon': true, 'v-tooltip': true, 'router-link': true },
  });
}

describe('Recent Transactions card', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_758_000_013_000); });
  afterEach(() => vi.useRealTimers());

  it('keeps a relative time moving after the last store update', async () => {
    // The screenshot: a row confirmed 13 s before the last render still read
    // "13s ago" ten minutes later, because nothing re-rendered the card.
    midnightStore.transactions = [{
      hash: 'a', type: 'self', token: USDM, amount: 2_000_000n, counterparty: '',
      timestamp: 1_758_000_000_000, status: 'confirmed', fee: 0n, isShielded: false,
    }];
    const wrapper = mountCard();
    expect(wrapper.text()).toContain('13s ago');

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(wrapper.text()).toContain('10m ago');
    expect(wrapper.text()).not.toContain('13s ago');
    wrapper.destroy();
  });

  it('shows a self-transfer with the amount that was sent and no direction sign', () => {
    midnightStore.transactions = [{
      hash: 'b', type: 'self', token: USDM, amount: 2_000_000n, counterparty: '',
      timestamp: 1_758_000_000_000, status: 'confirmed', fee: 0n, isShielded: false,
    }];
    const wrapper = mountCard();
    expect(wrapper.text()).toContain('midnight.txSelf');
    expect(wrapper.text()).toContain('2.00 USDM');
    expect(wrapper.text()).not.toContain('−');
    expect(wrapper.text()).not.toContain('0.00 USDM');
    wrapper.destroy();
  });
});
