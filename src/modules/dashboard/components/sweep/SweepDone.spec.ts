// What a sweep's done panel shows, where its explorer link points, and that Done hands back to the dialog.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';

vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  const walletStore = reactive({
    loggedWallet: { id: 1, chain: 'Cardano', network: 'Mainnet' },
    config: { explorer: 'cardanoscan' } as Record<string, unknown>,
  });
  return { walletStore, default: { setExplorer: vi.fn() } };
});
vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}${JSON.stringify(params)}` : key),
    tc: (key: string) => key,
  }),
}));

import SweepDone from './SweepDone.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);

const txId = '9f2c7a1e'.repeat(8);
const address = 'addr1qy3z8m4t' + 'x'.repeat(80) + 'h7c29xq2';

function mountDone() {
  return mount(SweepDone, {
    props: { txId, amount: '₳3,753.401206', address, steps: 11, fee: '₳5.302143' },
    global: { plugins: [createTestVuetify()] },
  });
}

describe('SweepDone', () => {
  it('shows the amount, the recipient, the transaction count, the fee and the payment id', () => {
    const wrapper = mountDone();
    const card = wrapper.get('.sweep-done__card');
    expect(card.attributes('role')).toBe('status');
    expect(card.text()).toContain('send.sweepDoneTitle');
    expect(card.text()).toContain('₳3,753.401206');
    expect(card.text()).toContain('send.sweepDoneTo{"address":"addr1qy3…c29xq2"}');
    expect(card.text()).toContain('dashboard.transactions');
    expect(card.text()).toContain('send.sweepDoneTransactions{"steps":11,"merges":10}');
    expect(card.text()).toContain('signTx.networkFee');
    expect(card.text()).toContain('₳5.302143');
    expect(card.text()).toContain('dashboard.transactionId');
    expect(card.text()).toContain('9f2c7a1e…2c7a1e');
    expect(wrapper.getComponent(CopyButton).props('value')).toBe(txId);
    expect(wrapper.text()).toContain('send.sweepDoneNote');
  });

  it('links the payment on the explorer the wallet chose', async () => {
    const wrapper = mountDone();
    const link = wrapper.get('a.sweep-done__explorer');
    expect(link.attributes('href')).toBe(`https://cardanoscan.io/transaction/${txId}`);
    expect(link.attributes('target')).toBe('_blank');
    expect(link.attributes('rel')).toBe('noopener noreferrer');
    expect(link.text()).toContain('send.sweepViewOnExplorer');

    // pool.pm has no transaction page: the link falls back to the default explorer rather than vanishing.
    walletStore.config = { explorer: 'poolpm' };
    await wrapper.vm.$nextTick();
    expect(wrapper.get('a.sweep-done__explorer').attributes('href')).toBe(`https://cexplorer.io/tx/${txId}`);
  });

  it('emits done from its one button', async () => {
    const wrapper = mountDone();
    await wrapper.get('.sweep-done__button').trigger('click');
    expect(wrapper.emitted('done')).toHaveLength(1);
  });
});
