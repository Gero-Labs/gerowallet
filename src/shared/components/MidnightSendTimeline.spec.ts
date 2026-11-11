// The proving node: the counter beside the label, the hint on its own line,
// both only while the node is active.
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import MidnightSendTimeline from './MidnightSendTimeline.vue';
import type { TimelineNode } from '@/shared/composables/useMidnightSendTimeline';

const stubs = { 'v-icon': true };
const nodes = (submit: Partial<TimelineNode>): TimelineNode[] => [
  { key: 'build', label: 'Build transaction', state: 'done' },
  { key: 'submit', label: 'Proving with Gero Cloud', state: 'active', showBar: true, percent: null, ...submit },
];

describe('MidnightSendTimeline', () => {
  it('puts the counter in the label row and the hint on its own line', () => {
    const w = mount(MidnightSendTimeline, {
      props: { nodes: nodes({ elapsed: '24 s', hint: 'Taking longer than usual.' }) },
      global: { stubs },
    });
    const active = w.findAll('.mtl-node')[1];
    expect(active.get('.mtl-node__label').text()).toBe('Proving with Gero Cloud · 24 s');
    expect(active.get('.mtl-node__elapsed').classes()).toContain('g-num');
    const hint = active.get('.mtl-node__hint');
    expect(hint.text()).toBe('Taking longer than usual.');
    expect(hint.classes()).toContain('t-caption');
    expect(active.find('.mtl-bar.indeterminate').exists()).toBe(true);
  });

  it('shows neither once the node is done', () => {
    const w = mount(MidnightSendTimeline, {
      props: { nodes: nodes({ state: 'done', elapsed: '24 s', hint: 'Taking longer than usual.' }) },
      global: { stubs },
    });
    expect(w.find('.mtl-node__elapsed').exists()).toBe(false);
    expect(w.find('.mtl-node__hint').exists()).toBe(false);
  });
});
