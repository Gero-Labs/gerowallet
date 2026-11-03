// The plan card on the Recipients step: the merges being built, then the plan.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';

vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}${JSON.stringify(params)}` : key),
    tc: (key: string, _choice?: number, params?: Record<string, unknown>) => (params ? `${key}${JSON.stringify(params)}` : key),
  }),
}));

import SweepPlanCard from './SweepPlanCard.vue';

enableAutoUnmount(afterEach);

function mountCard(props: InstanceType<typeof SweepPlanCard>['$props']) {
  return mount(SweepPlanCard, { props, global: { plugins: [createTestVuetify()] } });
}

describe('SweepPlanCard', () => {
  it('while preparing: a live region with a determinate bar counting the merges built', () => {
    const wrapper = mountCard({ utxoCount: 2144, merges: 10, preparing: { built: 4, total: 10 } });
    const card = wrapper.get('.sweep-plan');
    expect(card.attributes('aria-live')).toBe('polite');
    expect(card.text()).toContain('send.sweepPreparing{"steps":11}');
    expect(card.text()).toContain('send.sweepPreparingCount{"built":4,"total":10}');
    expect(card.text()).toContain('send.sweepPreparingNote{"count":2144}');
    const track = wrapper.get('.sweep-plan__track');
    expect(track.attributes('role')).toBe('progressbar');
    expect(track.attributes('aria-valuemin')).toBe('0');
    expect(track.attributes('aria-valuemax')).toBe('10');
    expect(track.attributes('aria-valuenow')).toBe('4');
    expect(wrapper.get('.sweep-plan__fill').attributes('style')).toContain('width: 40%');
    expect(wrapper.find('.v-progress-circular').exists()).toBe(true);
    expect(wrapper.find('.sweep-plan__segments').exists()).toBe(false);
  });

  it('once built: the plan with one cell per merge, a wider one for the payment, and the explanation', () => {
    const wrapper = mountCard({ utxoCount: 2144, merges: 10, preparing: null });
    const card = wrapper.get('.sweep-plan');
    expect(card.attributes('aria-live')).toBeUndefined();
    expect(card.text()).toContain('send.sweepPlanTitle{"steps":11}');
    expect(card.text()).toContain('send.sweepOneApproval');
    expect(card.text()).toContain('send.sweepMergesLabel{"merges":10}');
    expect(card.text()).toContain('send.sweepPaymentLabel');
    expect(card.text()).toContain('send.sweepPlanNote{"count":2144}');
    const segments = wrapper.get('.sweep-plan__segments');
    expect(segments.attributes('aria-hidden')).toBe('true');
    expect(segments.attributes('style')).toContain('repeat(10, minmax(0, 1fr)) 3fr');
    expect(wrapper.findAll('.sweep-plan__segment')).toHaveLength(11);
    expect(wrapper.findAll('.sweep-plan__segment--payment')).toHaveLength(1);
    expect(wrapper.find('.sweep-plan__track').exists()).toBe(false);
    expect(wrapper.find('.v-progress-circular').exists()).toBe(false);
  });

  it('past 24 transactions the bar is only its two parts', () => {
    const wrapper = mountCard({ utxoCount: 9000, merges: 40, preparing: null });
    expect(wrapper.findAll('.sweep-plan__segment')).toHaveLength(2);
    expect(wrapper.get('.sweep-plan__segments').attributes('style')).toContain('3fr 1fr');
    expect(wrapper.text()).toContain('send.sweepPlanTitle{"steps":41}');
  });

  it('says the server asked Gero to wait, only while a merge build is waiting', () => {
    const waiting = mountCard({ utxoCount: 2144, merges: 10, preparing: { built: 4, total: 10, waiting: true } });
    expect(waiting.text()).toContain('send.sweepPreparingWaiting');
    // The count and bar stay as they were: the wait is a note under them, not a new state.
    expect(waiting.text()).toContain('send.sweepPreparingCount{"built":4,"total":10}');
    expect(waiting.get('.sweep-plan__track').attributes('aria-valuenow')).toBe('4');
    expect(waiting.find('.v-progress-circular').exists()).toBe(true);

    const building = mountCard({ utxoCount: 2144, merges: 10, preparing: { built: 4, total: 10, waiting: false } });
    expect(building.text()).not.toContain('send.sweepPreparingWaiting');
    const planned = mountCard({ utxoCount: 2144, merges: 10, preparing: null });
    expect(planned.text()).not.toContain('send.sweepPreparingWaiting');
  });

  // The dialog is centred, so any change in the card's height moves the whole dialog. Every
  // state therefore has the same rows, and the texts that change share one cell each.
  const PREPARING = { utxoCount: 2144, merges: 10, preparing: { built: 4, total: 10 } };
  const WAITING = { utxoCount: 2144, merges: 10, preparing: { built: 4, total: 10, waiting: true } };
  const PLANNED = { utxoCount: 2144, merges: 10, preparing: null };

  /** The card's rows, by each one's first class. */
  function rowClasses(wrapper: ReturnType<typeof mountCard>): string[] {
    return Array.from(wrapper.get('.sweep-plan').element.children).map((child) => child.className.split(' ')[0]);
  }

  it('has the same rows while preparing, while waiting and once planned', () => {
    const preparing = rowClasses(mountCard(PREPARING));
    expect(preparing).toEqual(['sweep-plan__head', 'sweep-plan__track', 'sweep-plan__legend', 'sweep-plan__notes']);
    expect(rowClasses(mountCard(WAITING))).toEqual(preparing);
    expect(rowClasses(mountCard(PLANNED))).toEqual(['sweep-plan__head', 'sweep-plan__segments', 'sweep-plan__legend', 'sweep-plan__notes']);
  });

  it('shows the plan legend while preparing too', () => {
    const legend = mountCard(PREPARING).get('.sweep-plan__legend');
    expect(legend.text()).toContain('send.sweepMergesLabel{"merges":10}');
    expect(legend.text()).toContain('send.sweepPaymentLabel');
  });

  it('keeps both explanations in one cell and shows the one for the state', () => {
    const visible = (wrapper: ReturnType<typeof mountCard>) =>
      wrapper.get('.sweep-plan__notes').findAll('p').filter((p) => !p.classes('sweep-plan__hidden')).map((p) => p.text());

    const preparing = mountCard(PREPARING);
    expect(preparing.get('.sweep-plan__notes').text()).toContain('send.sweepPlanNote{"count":2144}');
    expect(visible(preparing)).toEqual(['send.sweepPreparingNote{"count":2144}']);

    // The wait takes the explanation's place instead of adding a paragraph under it.
    const waiting = mountCard(WAITING);
    expect(waiting.get('.sweep-plan__notes').text()).toContain('send.sweepPreparingWaiting');
    expect(visible(waiting)).toEqual(['send.sweepPreparingWaiting']);

    const planned = mountCard(PLANNED);
    expect(planned.get('.sweep-plan__notes').text()).toContain('send.sweepPreparingNote{"count":2144}');
    expect(visible(planned)).toEqual(['send.sweepPlanNote{"count":2144}']);
  });

  it('keeps the count and the approval pill in one cell of the head', () => {
    const aside = (wrapper: ReturnType<typeof mountCard>) => wrapper.get('.sweep-plan__aside');

    const preparing = aside(mountCard(PREPARING));
    expect(preparing.get('.sweep-plan__pill').classes()).toContain('sweep-plan__hidden');
    expect(preparing.get('.sweep-plan__count').classes()).not.toContain('sweep-plan__hidden');

    const planned = aside(mountCard(PLANNED));
    expect(planned.get('.sweep-plan__pill').classes()).not.toContain('sweep-plan__hidden');
    expect(planned.get('.sweep-plan__count').classes()).toContain('sweep-plan__hidden');
  });
});
