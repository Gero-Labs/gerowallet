import Vue from 'vue';
import Vuetify from 'vuetify';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { CardInfo } from '@/models/card';
import { orderTracker } from '@/modules/wallet/utils/cardOrderTracker';

vi.mock('@/plugins/i18n', () => ({ default: { locale: 'us' }, getLocaleCode: () => 'en-US' }));
vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn(), fireSuccess: vi.fn() } }));
vi.mock('@/stores/modules/card', () => ({ default: { activatePhysicalCard: vi.fn() } }));

import CardStatusSectionSfc from './CardStatusSection.vue';

Vue.use(Vuetify);
const CardStatusSection = CardStatusSectionSfc as unknown as Parameters<typeof mount>[0];

function card(data: Record<string, unknown>, balance?: { amount: number; currencyCode: string; state?: string }): CardInfo {
  return {
    cardData: { own_type: 'virtual', pan: '537524******4121', ...data },
    cardDetails: null,
    cardPin: null,
    cardNumber: null,
    cardBalance: balance ? { currentBalance: { amount: balance.amount, currencyCode: balance.currencyCode }, state: balance.state ?? 'ACTIVE' } : null,
    cardHistory: null,
    totalDeposits: 0,
    activities: [],
  } as unknown as CardInfo;
}

function render(props: Record<string, unknown>) {
  return mount(CardStatusSection, { vuetify: new Vuetify(), propsData: props, mocks: { $t: (key: string) => key } });
}

describe('CardStatusSection', () => {
  it('shows an issued card balance in its own currency', () => {
    const wrapper = render({ card: card({ card_uuid: 'c1' }, { amount: 250, currencyCode: 'EUR' }), exchangeRate: 0.35 });
    expect(wrapper.text()).toContain('€250.00');
    expect(wrapper.text()).toContain('714.29');
    expect(wrapper.text()).toContain('•••• 4121');
  });

  it('falls back to the card list balance, and shows a dash instead of an invented €0.00', () => {
    expect(render({ card: card({ card_uuid: 'c1', balance: '12.5', currency: 'EUR' }) }).text()).toContain('€12.50');
    const unknown = render({ card: card({ card_uuid: 'c1' }) });
    expect(unknown.text()).toContain('—');
    expect(unknown.text()).not.toContain('€0.00');
  });

  it('marks a blocked card from either source', () => {
    expect(render({ card: card({ card_uuid: 'c1', card_status: 'TEMPORARY_BLOCKED' }) }).text()).toContain('card.blocked');
    expect(render({ card: card({ card_uuid: 'c1' }, { amount: 1, currencyCode: 'EUR', state: 'BLOCKED' }) }).text()).toContain('card.blocked');
    expect(render({ card: card({ card_uuid: 'c1' }, { amount: 1, currencyCode: 'EUR' }) }).text()).not.toContain('card.blocked');
  });

  it('emits top-up and manage from the balance panel', async () => {
    const wrapper = render({ card: card({ card_uuid: 'c1' }, { amount: 5, currencyCode: 'EUR' }) });
    const buttons = wrapper.findAll('button');
    await buttons.filter(b => b.text() === 'card.topUp').at(0).trigger('click');
    await buttons.filter(b => b.text() === 'card.cardControls').at(0).trigger('click');
    expect(wrapper.emitted('top-up')).toHaveLength(1);
    expect(wrapper.emitted('manage')).toHaveLength(1);
  });

  it('tracks an unpaid physical order and asks for the fee', async () => {
    const order = card({ own_type: 'physical', order_uuid: 'o1', card_uuid: null });
    const tracker = orderTracker({ physical: true, orderStatus: 'new', payment: 'awaiting' });
    const wrapper = render({ card: order, tracker, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() });
    expect(wrapper.text()).toContain('card.trackerTitlePhysical');
    expect(wrapper.text()).toContain('card.trackerAwaitingPayment');
    await wrapper.findAll('button').filter(b => b.text() === 'card.completePayment').at(0).trigger('click');
    expect(wrapper.emitted('complete-payment')).toHaveLength(1);
    wrapper.destroy();
  });

  it('says a detected payment is confirming instead of asking to pay again', () => {
    const order = card({ own_type: 'physical', order_uuid: 'o1', card_uuid: null });
    const wrapper = render({ card: order, tracker: orderTracker({ physical: true, orderStatus: 'new', payment: 'detected' }) });
    expect(wrapper.text()).toContain('card.trackerPaymentDetected');
    expect(wrapper.text()).not.toContain('card.completePayment');
  });

  it('offers activation once the card is dispatched', () => {
    const order = card({ own_type: 'physical', order_uuid: 'o1', card_uuid: null });
    const wrapper = render({ card: order, tracker: orderTracker({ physical: true, orderStatus: 'dispatched', payment: 'paid' }) });
    expect(wrapper.text()).toContain('card.activateTitle');
  });

  it('shows the order call to action on the empty slot', async () => {
    const wrapper = render({ card: card({ card_uuid: null, order_uuid: null }), canOrder: true });
    expect(wrapper.text()).toContain('card.getYourGeroCard');
    await wrapper.findAll('button').filter(b => b.text() === 'card.orderNewCard').at(0).trigger('click');
    expect(wrapper.emitted('open-order-card-flow')).toHaveLength(1);
  });
});
