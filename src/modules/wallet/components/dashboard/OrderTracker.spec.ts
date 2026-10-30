import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mount } from '@vue/test-utils';
import * as Vue from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { CardInfo } from '@/models/card';
import { orderTracker } from '@/modules/wallet/utils/cardOrderTracker';

const stubs = vi.hoisted(() => ({
  button: {
    props: ['href', 'tier'],
    render(this: Vue.ComponentPublicInstance & { href?: string }) {
      return this.href
        ? Vue.h('a', { href: this.href }, this.$slots['default']?.())
        : Vue.h('button', this.$attrs, this.$slots['default']?.());
    },
  },
  empty: { render() { return Vue.h('div'); } },
}));

vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({ default: stubs.button }));
vi.mock('@/shared/components/iso/IsoScene.vue', () => ({ default: stubs.empty }));
vi.mock('./CardActivationPanel.vue', () => ({ default: stubs.empty }));
vi.mock('@/shared/composables/useExplorer', () => ({
  useExplorer: () => ({ explorerUrl: (type: string, id?: string) => (id ? `https://explorer.test/${type}/${id}` : '') }),
}));

import TrackerSfc from './OrderTracker.vue';

const OrderTracker = TrackerSfc as unknown as Parameters<typeof mount>[0];
const TX = 'b5a2e0c02d51d6f4676ddd12bff8883cc09a30fa8305520f1f2093f72d084f26';
const card = { cardData: { own_type: 'physical', order_uuid: 'order-1', card_uuid: null } } as unknown as CardInfo;
const awaiting = orderTracker({ physical: true, orderStatus: 'new', payment: 'awaiting' });

function render(props: Record<string, unknown>) {
  return mount(OrderTracker, {
    props: { card, view: awaiting, expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(), ...props },
    global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } },
  });
}

describe('OrderTracker delivery fee', () => {
  it('offers to pay when no payment was sent from this wallet', () => {
    const wrapper = render({});
    expect(wrapper.text()).toContain('card.completePayment');
    expect(wrapper.text()).toContain('card.addressValidFor');
    expect(wrapper.text()).toContain('card.trackerAwaitingPayment');
  });

  it('shows the sent payment instead of the pay button while Zione confirms it', () => {
    const wrapper = render({ sentPayment: { txId: TX, sentAt: Date.now() } });
    expect(wrapper.text()).not.toContain('card.completePayment');
    expect(wrapper.text()).not.toContain('card.addressValidFor');
    expect(wrapper.text()).toContain('card.trackerPaymentSent');
    expect(wrapper.text()).toContain('card.feeSentBody');
    expect(wrapper.find(`a[href="https://explorer.test/tx/${TX}"]`).exists()).toBe(true);

    const mail = wrapper.find('a[href^="mailto:support@zione.com"]').attributes('href') ?? '';
    expect(decodeURIComponent(mail)).toContain(`card.feeSentMailBody {"order":"order-1","tx":"${TX}"}`);
  });

  it('lets the normal tracker take over once Zione confirms the fee', () => {
    const paid = orderTracker({ physical: true, orderStatus: 'new', payment: 'paid' });
    const wrapper = render({ view: paid, sentPayment: { txId: TX, sentAt: Date.now() } });
    expect(wrapper.text()).not.toContain('card.feeSentBody');
    expect(wrapper.text()).not.toContain('card.completePayment');
  });
});
