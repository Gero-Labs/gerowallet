import Vue from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.observable({ transactions: [], loggedWallet: { chain: 'Midnight', network: 'Mainnet' } }) }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: Vue.observable({ transactions: [] as unknown[] }) }));
vi.mock('@/chains/midnight/midnightTokenRegistry', () => ({
  midnightTokenMeta: (color: string) => (color === 'aa'.repeat(32) ? { symbol: 'USDM', decimals: 6 } : null),
}));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../components/flows/TxDetailSheet.vue', () => ({ default: Vue.extend({ render(h) { return h('div'); } }) }));

import ActivityPageSfc from './ActivityPage.vue';
import { midnightStore } from '@/stores/midnightStore';

// test-utils v1's mount() typings predate <script setup> components.
const ActivityPage = ActivityPageSfc as unknown as Parameters<typeof mount>[0];
const USDM = 'aa'.repeat(32);

function mountPage() {
  return mount(ActivityPage, { mocks: { $t: (key: string) => key }, stubs: { 'v-icon': true, 'v-progress-circular': true } });
}

describe('side-panel activity: Midnight rows', () => {
  it('renders a self-transfer neutrally, with the token it actually moved', () => {
    midnightStore.transactions = [{
      hash: 'a', type: 'self', token: USDM, amount: 2_000_000n, counterparty: '',
      timestamp: 1_758_000_000_000, status: 'confirmed', fee: 0n, isShielded: false,
    }];
    const wrapper = mountPage();
    const row = wrapper.find('.tx-item');
    expect(row.text()).toContain('midnight.txSelf');
    // Was "0.0000 NIGHT": the DUST divisor and NIGHT ticker for any non-NIGHT colour.
    expect(row.text()).toContain('2.00 USDM');
    expect(row.text()).not.toContain('−');
    expect(row.find('.tx-icon-wrapper').classes()).toContain('icon-neutral');
    expect(row.find('.tx-amount-col > div').classes()).toContain('grey--text');
    expect(row.find('.tx-amount-col > div').classes()).not.toContain('error-text');
  });

  it('still colours a real send red and a receive green', () => {
    midnightStore.transactions = [
      { hash: 's', type: 'send', token: 'NIGHT', amount: 1_500_000n, counterparty: 'mn_addr1other', timestamp: 2, status: 'confirmed', fee: 0n, isShielded: false },
      { hash: 'r', type: 'receive', token: USDM, amount: 10_000_000n, counterparty: '', timestamp: 1, status: 'confirmed', fee: 0n, isShielded: false },
    ];
    const wrapper = mountPage();
    const [send, receive] = wrapper.findAll('.tx-item').wrappers;
    expect(send.text()).toContain('−1.50 NIGHT');
    expect(send.find('.tx-amount-col > div').classes()).toContain('error-text');
    expect(receive.text()).toContain('+10.00 USDM');
    expect(receive.find('.tx-amount-col > div').classes()).toContain('accent-text');
  });
});
