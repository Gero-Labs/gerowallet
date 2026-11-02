// What a sweep's done panel shows, where its explorer link points, where focus lands, and that Done hands back.
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
    tc: (key: string, _choice?: number, params?: Record<string, unknown>) => (params ? `${key}${JSON.stringify(params)}` : key),
  }),
}));

import SweepDone from './SweepDone.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);
afterEach(() => { document.body.innerHTML = ''; });

const txId = '9f2c7a1e'.repeat(8);
const address = 'addr1qy3z8m4t' + 'x'.repeat(80) + 'h7c29xq2';

function mountDone(props: Partial<InstanceType<typeof SweepDone>['$props']> = {}) {
  return mount(SweepDone, {
    attachTo: document.body,
    props: { txId, amount: '₳3,753.401206', address, recipients: 1, steps: 11, fee: '₳5.302143', ...props },
    global: { plugins: [createTestVuetify()] },
  });
}

describe('SweepDone', () => {
  it('shows the amount, the recipient, the transaction count, the fee and the payment id', () => {
    const wrapper = mountDone();
    const card = wrapper.get('.sweep-done__card');
    expect(card.attributes('role')).toBe('status');
    expect(card.get('h2').text()).toBe('send.sweepDoneTitle');
    expect(card.text()).toContain('₳3,753.401206');
    expect(card.text()).toContain('send.sweepDoneTo{"address":"addr1qy...c29xq2"}');
    expect(card.text()).toContain('dashboard.transactions');
    expect(card.text()).toContain('send.sweepDoneTransactions{"steps":11,"merges":10}');
    expect(card.text()).toContain('signTx.networkFee');
    expect(card.text()).toContain('₳5.302143');
    expect(card.text()).toContain('dashboard.transactionId');
    expect(card.text()).toContain('9f2c7a1...2c7a1e');
    expect(wrapper.getComponent(CopyButton).props('value')).toBe(txId);
    expect(wrapper.text()).toContain('send.sweepDoneNote');
  });

  it('names several recipients by their count instead of an address', () => {
    const wrapper = mountDone({ address: '', recipients: 3 });
    expect(wrapper.text()).toContain('send.sweepDoneToMany{"count":3}');
    expect(wrapper.text()).not.toContain('send.sweepDoneTo{');
  });

  it('takes focus on its title, since the button the user pressed is gone', () => {
    const wrapper = mountDone();
    const title = wrapper.get('h2');
    expect(title.attributes('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(title.element);
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
