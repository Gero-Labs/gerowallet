import type Vue from 'vue';
import type { CreateElement } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({
  default: {
    name: 'BaseDialog',
    props: ['isOpen', 'title', 'subtitle', 'minHeight', 'width', 'persistent', 'img', 'imgStyle'],
    render(this: Vue, h: CreateElement) {
      return h('div', [
        h('button', { attrs: { 'data-test': 'dismiss' }, on: { click: () => this.$emit('close') } }),
        ...(this.$slots['default'] || []),
      ]);
    },
  },
}));
vi.mock('@/modules/swap/components/GeroSwapEmbed.vue', () => ({
  default: {
    name: 'GeroSwapEmbed',
    props: ['tokenIn', 'tokenOut', 'context'],
    render(h) {
      return h('div');
    },
  },
}));

import SwapDialog from './SwapDialog.vue';

function mountDialog(propsData: Record<string, unknown> = {}) {
  return mount(SwapDialog, {
    propsData: { isOpen: true, ...propsData },
    stubs: { 'v-card-text': true },
  });
}

describe('SwapDialog', () => {
  it('forwards optional sell and buy units to the widget and preserves defaults when unset', () => {
    const configured = mountDialog({ sellTokenUnit: 'lovelace', buyTokenUnit: 'token-unit' });
    const configuredEmbed = configured.findComponent({ name: 'GeroSwapEmbed' });
    expect(configuredEmbed.props('tokenIn')).toBe('lovelace');
    expect(configuredEmbed.props('tokenOut')).toBe('token-unit');
    expect(configuredEmbed.props('context')).toBe('dialog');

    const defaults = mountDialog();
    const defaultEmbed = defaults.findComponent({ name: 'GeroSwapEmbed' });
    expect(defaultEmbed.props('tokenIn')).toBeUndefined();
    expect(defaultEmbed.props('tokenOut')).toBeUndefined();
    expect(defaultEmbed.props('context')).toBe('dialog');
  });

  it('closes on dismissal without emitting swap-submitted', async () => {
    const wrapper = mountDialog();

    await wrapper.find('[data-test="dismiss"]').trigger('click');

    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(wrapper.emitted('swap-submitted')).toBeUndefined();
  });

  it('forwards submitted detail before closing', () => {
    const wrapper = mountDialog();
    const order: string[] = [];
    const detail = { txHash: 'submitted-tx' };
    wrapper.vm.$on('swap-submitted', forwarded => {
      expect(forwarded).toBe(detail);
      order.push('submitted');
    });
    wrapper.vm.$on('close', () => order.push('close'));

    wrapper.findComponent({ name: 'GeroSwapEmbed' }).vm.$emit('swap-submitted', detail);

    expect(wrapper.emitted('swap-submitted')).toEqual([[detail]]);
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(order).toEqual(['submitted', 'close']);
  });
});
