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
});
