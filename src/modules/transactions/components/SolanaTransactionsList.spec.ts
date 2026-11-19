// The Transactions page's Solana history: Gero Sync's rows, search, and older pages read
// from Nexus only when Gero Sync held some back.
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import * as Vue from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nexus = vi.hoisted(() => ({ getSignatures: vi.fn() }));

vi.mock('@/stores/walletStore', () => ({
  walletStore: Vue.reactive({
    loggedWallet: { chain: 'Solana', network: 'Devnet', publicKey: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk' },
    solana: { historyTruncated: false },
    solanaTransactions: [] as unknown[],
  }),
}));
vi.mock('@/api/solana-api', () => ({
  SolanaApi: class {
    getSignatures = nexus.getSignatures;
  },
}));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import ListSfc from './SolanaTransactionsList.vue';
import { walletStore } from '@/stores/walletStore';
import { SOLANA_HISTORY_PAGE } from '@/chains/solana/solanaHistory';

const List = ListSfc as unknown as Parameters<typeof mount>[0];
const store = walletStore as unknown as {
  loggedWallet: { network: string };
  solana: { historyTruncated: boolean };
  solanaTransactions: unknown[];
};
const sig = (c: string) => c.repeat(88);
const row = (c: string, slot: number, extra: Record<string, unknown> = {}) =>
  ({ signature: sig(c), slot, blockTime: 1_758_000_000 + slot, success: true, ...extra });

const VTextField = Vue.defineComponent({
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  render() {
    return Vue.h('input', {
      class: 'search',
      value: this.modelValue,
      onInput: (e: Event) => this.$emit('update:modelValue', (e.target as HTMLInputElement).value),
    });
  },
});
const GButton = Vue.defineComponent({
  emits: ['click'],
  render() {
    return Vue.h('button', { class: 'load-older', onClick: () => this.$emit('click') }, this.$slots['default']?.());
  },
});

function mountList() {
  return mount(List, {
    global: {
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
      stubs: { 'v-card': { template: '<div><slot /></div>' }, 'v-text-field': VTextField, 'v-icon': true, GButton, TxGlyph: true },
    },
  });
}

const signatures = (wrapper: ReturnType<typeof mountList>) =>
  wrapper.findAll('.sol-tx-row__sig').map((el) => el.attributes('title')?.[0]);

describe('SolanaTransactionsList', () => {
  beforeEach(() => {
    store.loggedWallet.network = 'Devnet';
    store.solana = { historyTruncated: false };
    store.solanaTransactions = [];
    nexus.getSignatures.mockReset();
  });

  it('says there is no activity yet', () => {
    expect(mountList().text()).toContain('solana.noActivity');
  });

  it('lists Gero Sync rows newest first, marks a failed one and emits the clicked row', async () => {
    store.solanaTransactions = [row('a', 1, { success: false }), row('b', 2)];
    const wrapper = mountList();
    expect(signatures(wrapper)).toEqual(['b', 'a']);
    expect(wrapper.findAll('.sol-tx-row')[1].text()).toContain('transactions.failed');
    await wrapper.findAll('.sol-tx-row')[0].trigger('click');
    expect(wrapper.emitted('row-click')?.[0]?.[0]).toMatchObject({ signature: sig('b') });
  });

  it('filters by signature', async () => {
    store.solanaTransactions = [row('a', 1), row('b', 2)];
    const wrapper = mountList();
    await wrapper.find('input.search').setValue('aaaa');
    expect(signatures(wrapper)).toEqual(['a']);
    await wrapper.find('input.search').setValue('zzzz');
    expect(wrapper.text()).toContain('transactions.noTransactionsFound');
  });

  it('offers older history only when Gero Sync held some back', async () => {
    store.solanaTransactions = [row('b', 20)];
    const wrapper = mountList();
    expect(wrapper.find('.load-older').exists()).toBe(false);
    store.solana = { historyTruncated: true };
    await Vue.nextTick();
    expect(wrapper.find('.load-older').exists()).toBe(true);
  });

  it('pages before the oldest row, drops malformed Nexus rows, and stops at a short page', async () => {
    store.solana = { historyTruncated: true };
    store.solanaTransactions = [row('b', 20)];
    nexus.getSignatures.mockResolvedValueOnce([row('a', 10), { signature: 'bad', slot: 1 }]);
    const wrapper = mountList();
    await wrapper.find('.load-older').trigger('click');
    await flushPromises();
    expect(nexus.getSignatures).toHaveBeenCalledWith(
      'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk', { before: sig('b'), limit: SOLANA_HISTORY_PAGE });
    expect(signatures(wrapper)).toEqual(['b', 'a']);
    expect(wrapper.find('.load-older').exists()).toBe(false);
  });

  it('shows a Nexus row without a block time by its slot, not as confirming', async () => {
    store.solana = { historyTruncated: true };
    store.solanaTransactions = [row('b', 20)];
    nexus.getSignatures.mockResolvedValueOnce([{ signature: sig('a'), slot: 10, blockTime: null, success: true }]);
    const wrapper = mountList();
    await wrapper.find('.load-older').trigger('click');
    await flushPromises();
    const old = wrapper.findAll('.sol-tx-row')[1];
    expect(old.text()).toContain('poolOperator.slot 10');
    expect(old.text()).not.toContain('solana.pending');
  });

  it('stops paging when a full page has no usable row (the same cursor would repeat)', async () => {
    store.solana = { historyTruncated: true };
    store.solanaTransactions = [row('b', 20)];
    nexus.getSignatures.mockResolvedValueOnce(Array.from({ length: SOLANA_HISTORY_PAGE }, () => ({ signature: 'bad', slot: 1 })));
    const wrapper = mountList();
    await wrapper.find('.load-older').trigger('click');
    await flushPromises();
    expect(wrapper.find('.load-older').exists()).toBe(false);
  });

  it('drops an answer that arrives after a network switch, and is ready to load again', async () => {
    store.solana = { historyTruncated: true };
    store.solanaTransactions = [row('b', 20)];
    let answer!: (rows: unknown[]) => void;
    nexus.getSignatures.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const wrapper = mountList();
    await wrapper.find('.load-older').trigger('click');
    store.loggedWallet.network = 'Mainnet';
    await Vue.nextTick();
    answer([row('a', 10)]);
    await flushPromises();
    expect(signatures(wrapper)).toEqual(['b']);
    nexus.getSignatures.mockResolvedValueOnce([]);
    await wrapper.find('.load-older').trigger('click');
    await flushPromises();
    expect(nexus.getSignatures).toHaveBeenCalledTimes(2);
  });

  it('says a failed read and offers to try again', async () => {
    store.solana = { historyTruncated: true };
    store.solanaTransactions = [row('b', 20)];
    nexus.getSignatures.mockRejectedValueOnce(new Error('offline'));
    const wrapper = mountList();
    await wrapper.find('.load-older').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('solana.loadOlderFailed');
    expect(wrapper.find('.load-older').text()).toContain('common.tryAgain');
  });
});
