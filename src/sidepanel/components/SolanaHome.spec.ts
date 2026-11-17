// The panel's Solana home: Gero Sync's SOL balance (never a made-up 0), SOL pinned
// above the SPL tokens it holds, Send/Receive passed up, and hidden balances masked.
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import * as Vue from 'vue';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/walletStore', () => ({
  walletStore: Vue.reactive({
    loggedWallet: { chain: 'Solana', network: 'Devnet', publicKey: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk' },
    config: { hideBalances: false },
    solana: { lamports: null as string | null, tokens: null as unknown[] | null },
  }),
}));
vi.mock('@/utils/networks', () => ({ default: { resolveCurrencyTicker: () => 'SOL' } }));
vi.mock('@/assets/svg/solana.svg', () => ({ default: 'solana.svg' }));
vi.mock('./QuickActions.vue', () => ({
  default: Vue.defineComponent({
    emits: ['action'],
    setup(_props, { emit }) {
      return () => Vue.h('button', { 'data-test': 'qa-send', onClick: () => emit('action', 'send') });
    },
  }),
}));

import SolanaHomeSfc from './SolanaHome.vue';
import { walletStore } from '@/stores/walletStore';

const SolanaHome = SolanaHomeSfc as unknown as Parameters<typeof mount>[0];
const store = walletStore as unknown as {
  loggedWallet: { network: string };
  config: { hideBalances: boolean };
  solana: { lamports: string | null; tokens: unknown[] | null };
};
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function render() {
  return mount(SolanaHome, {
    global: { config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) }, stubs: { 'v-icon': true } },
  });
}

enableAutoUnmount(afterEach);

describe('SolanaHome', () => {
  beforeEach(() => {
    store.loggedWallet.network = 'Devnet';
    store.config.hideBalances = false;
    store.solana = { lamports: null, tokens: null };
  });

  it('says the balance is loading until Gero Sync reports, never 0', () => {
    const wrapper = render();
    expect(wrapper.text()).toContain('solana.balanceLoading');
    expect(wrapper.find('[data-test="sol-home-balance-value"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('solana.devnetNotice');
  });

  it('shows SOL pinned first, then only the tokens it holds', () => {
    store.solana = {
      lamports: '1500000000',
      tokens: [
        { mint: MINT, amount: '2500000', decimals: 6 },
        { mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', amount: '0', decimals: 6 },
      ],
    };
    const wrapper = render();
    expect(wrapper.get('[data-test="sol-home-balance-value"]').text()).toBe('1.5');
    const rows = wrapper.findAll('[data-test="sol-home-tokens"] li');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('assets.solana');
    expect(rows[1].text()).toContain('2.5');
    expect(rows[1].get('a').attributes('href')).toBe(`https://solscan.io/account/${MINT}?cluster=devnet`);
    expect(wrapper.text()).not.toContain('solana.noTokens');
  });

  it('masks every amount when balances are hidden, and drops the devnet notice on mainnet', () => {
    store.loggedWallet.network = 'Mainnet';
    store.config.hideBalances = true;
    store.solana = { lamports: '1500000000', tokens: [{ mint: MINT, amount: '2500000', decimals: 6 }] };
    const wrapper = render();
    expect(wrapper.text()).not.toContain('1.5');
    expect(wrapper.text()).not.toContain('2.5');
    expect(wrapper.text()).not.toContain('solana.devnetNotice');
  });

  it('passes the quick actions up to the page', async () => {
    const wrapper = render();
    await wrapper.get('[data-test="qa-send"]').trigger('click');
    expect(wrapper.emitted('action')).toEqual([['send']]);
  });
});
