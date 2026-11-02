// The progress panel as rendered: a live region while a sweep runs, an alert with the reason once it stopped.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';

vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}${JSON.stringify(params)}` : key),
    tc: (key: string) => key,
  }),
}));

import SweepProgressPanel from './SweepProgressPanel.vue';

enableAutoUnmount(afterEach);

function mountPanel(props: InstanceType<typeof SweepProgressPanel>['$props']) {
  return mount(SweepProgressPanel, { props, global: { plugins: [createTestVuetify()] } });
}

describe('SweepProgressPanel', () => {
  it('renders nothing without progress or a stop', () => {
    const wrapper = mountPanel({ progress: null, stop: null });
    expect(wrapper.find('.sweep-progress').exists()).toBe(false);
  });

  it('is a polite live region with a cell per transaction and the checklist while sending', () => {
    const wrapper = mountPanel({ progress: { phase: 'sending', step: 7, total: 11 }, stop: null });
    const panel = wrapper.get('.sweep-progress');
    expect(panel.attributes('aria-live')).toBe('polite');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(panel.text()).toContain('send.sweepSending{"step":7,"total":11}');
    expect(panel.text()).toContain('send.sweepSentCount{"sent":6,"total":11}');
    const segments = wrapper.findAll('.sweep-progress__segment');
    expect(segments).toHaveLength(11);
    expect(segments.filter((s) => s.classes('sweep-progress__segment--done'))).toHaveLength(6);
    expect(segments[6].classes()).toContain('sweep-progress__segment--active');
    expect(wrapper.get('.sweep-progress__segments').attributes('aria-hidden')).toBe('true');
    const rows = wrapper.findAll('.sweep-progress__row');
    expect(rows).toHaveLength(3);
    expect(rows[0].get('.sweep-progress__mark').classes()).toContain('sweep-progress__mark--done');
    expect(rows[1].get('.sweep-progress__mark').classes()).toContain('sweep-progress__mark--active');
    expect(rows[1].text()).toContain('send.sweepMergesSentCount{"sent":6,"merges":10}');
    expect(rows[2].get('.sweep-progress__mark').classes()).toContain('sweep-progress__mark--pending');
    expect(panel.text()).toContain('send.sweepKeepOpen');
  });

  it('falls back to one determinate bar past 24 transactions', () => {
    const wrapper = mountPanel({ progress: { phase: 'sending', step: 10, total: 30 }, stop: null });
    expect(wrapper.find('.sweep-progress__segments').exists()).toBe(false);
    const track = wrapper.get('.sweep-progress__track');
    expect(track.attributes('role')).toBe('progressbar');
    expect(track.attributes('aria-valuemin')).toBe('0');
    expect(track.attributes('aria-valuemax')).toBe('30');
    expect(track.attributes('aria-valuenow')).toBe('9');
  });

  it('once stopped: an alert with the reason behind a disclosure, the error cell, and how to go on', () => {
    const wrapper = mountPanel({ progress: null, stop: { step: 4, total: 11, mergesSent: 3, reason: 'ValueNotConservedUTxO' } });
    const alert = wrapper.get('.sweep-progress__alert');
    expect(alert.attributes('role')).toBe('alert');
    expect(alert.text()).toContain('send.sweepStoppedTitle{"step":4,"total":11}');
    expect(alert.text()).toContain('send.sweepStoppedBody{"sent":3,"merges":10}');
    expect(alert.get('details summary').text()).toBe('send.sweepShowDetails');
    expect(alert.get('details .g-mono').text()).toBe('ValueNotConservedUTxO');
    expect(wrapper.find('.v-progress-circular').exists()).toBe(false);
    const segments = wrapper.findAll('.sweep-progress__segment');
    expect(segments.filter((s) => s.classes('sweep-progress__segment--done'))).toHaveLength(3);
    expect(segments[3].classes()).toContain('sweep-progress__segment--error');
    const rows = wrapper.findAll('.sweep-progress__row');
    expect(rows[1].get('.sweep-progress__mark').classes()).toContain('sweep-progress__mark--error');
    expect(rows[1].text()).toContain('send.sweepMergesStopped{"sent":3,"merges":10}');
    expect(rows[2].text()).toContain('send.sweepPaymentNotSent');
    expect(wrapper.text()).toContain('send.sweepTryAgainNote{"step":4}');
  });
});
