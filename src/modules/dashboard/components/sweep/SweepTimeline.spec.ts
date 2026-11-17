// The Summary step's account of a sweep: the merges, then the payment, under one approval.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';

vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}${JSON.stringify(params)}` : key),
    tc: (key: string, _choice?: number, params?: Record<string, unknown>) => (params ? `${key}${JSON.stringify(params)}` : key),
  }),
}));

import SweepTimeline from './SweepTimeline.vue';

enableAutoUnmount(afterEach);

describe('SweepTimeline', () => {
  it('lists the merges and the payment with their fees, and says the approval is one', () => {
    const wrapper = mount(SweepTimeline, {
      props: { steps: 11, utxoCount: 2144, mergeFee: '₳4.821905', paymentFee: '₳0.480238' },
      global: { plugins: [createTestVuetify()] },
    });
    const section = wrapper.get('.sweep-timeline');
    const title = section.get('h2');
    expect(title.text()).toBe('send.sweepHowItGoesOut');
    expect(section.attributes('aria-labelledby')).toBe(title.attributes('id'));
    expect(section.text()).toContain('send.sweepPlanPill{"steps":11}');
    expect(section.get('.d-sr-only').text()).toBe('send.sweepPlanSummary{"steps":11}');

    const rows = wrapper.findAll('.sweep-timeline__row');
    expect(rows).toHaveLength(2);
    expect(rows[0].get('.sweep-timeline__marker').text()).toBe('10');
    expect(rows[0].get('.sweep-timeline__marker').attributes('aria-hidden')).toBe('true');
    expect(rows[0].text()).toContain('send.sweepMergesStep{"merges":10}');
    expect(rows[0].text()).toContain('send.sweepMergesStepNote{"count":2144}');
    expect(rows[0].get('.sweep-timeline__fee').text()).toBe('₳4.821905');
    expect(rows[1].get('.sweep-timeline__marker').classes()).toContain('sweep-timeline__marker--accent');
    expect(rows[1].text()).toContain('send.sweepPaymentLabel');
    expect(rows[1].text()).toContain('send.sweepPaymentStepNote');
    expect(rows[1].get('.sweep-timeline__fee').text()).toBe('₳0.480238');

    expect(section.get('.sweep-timeline__note').text()).toContain('send.sweepApproveOnce{"steps":11}');
  });
});
