import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { FlowNode, TxFlowModel } from '@/shared/utils/txFlow';

vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    tc: (key: string, _count: number, params?: Record<string, unknown>) => `${key} ${JSON.stringify(params)}`,
  }),
}));

import TxFlowDiagram from './TxFlowDiagram.vue';

// happy-dom lays nothing out; the diagram draws only once its container has a width
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });

const node = (key: string, kind: FlowNode['kind'], lovelace: number, tokens: FlowNode['tokens'] = []): FlowNode =>
  ({ key, kind, address: kind === 'fee' ? '' : `addr1${key}`, lovelace, count: 1, tokens });

const model = (overrides: Partial<TxFlowModel> = {}): TxFlowModel => ({
  inputs: [
    node('in:pool', 'script', 1_250_000_000_000, [{ unit: 'MIN', quantity: 3 }]),
    node('in:mine', 'own', 254_000_000),
    ...Array.from({ length: 6 }, (_, index) => node(`in:o${index}`, 'script', (index + 1) * 10_000_000)),
  ],
  outputs: [
    node('out:pool', 'script', 1_250_005_000_000),
    node('out:mine', 'own', 2_000_000, [{ unit: 'MIN', quantity: 3 }]),
    node('src:fee', 'fee', 900_000),
  ],
  collateralCount: 0,
  referenceInputCount: 0,
  ...overrides,
});

const mountDiagram = async (props: Partial<{ model: TxFlowModel }> = {}) => {
  const wrapper = mount(TxFlowDiagram, {
    props: {
      model: model(),
      tokenInfo: (unit: string) => ({ name: unit, decimals: 0 }),
      currencySymbol: '₳',
      ...props,
    },
    global: { config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } },
  });
  await nextTick();
  return wrapper;
};

describe('TxFlowDiagram', () => {
  it('folds a long column into a "more" button that expands it', async () => {
    const wrapper = await mountDiagram();
    try {
      // 8 inputs: own + 3 largest others + "more"
      expect(wrapper.findAll('.tx-flow__box').filter((box) => box.attributes('style')?.includes('left: 0px'))).toHaveLength(5);
      const more = wrapper.find('button.tx-flow__box--more');
      expect(more.exists()).toBe(true);
      await more.trigger('click');
      expect(wrapper.find('button.tx-flow__box--more').exists()).toBe(false);
      expect(wrapper.findAll('.tx-flow__box').filter((box) => box.attributes('style')?.includes('left: 0px'))).toHaveLength(8);
    } finally {
      wrapper.unmount();
    }
  });

  it('draws one band per box', async () => {
    const wrapper = await mountDiagram();
    try {
      expect(wrapper.findAll('.tx-flow__band')).toHaveLength(wrapper.findAll('.tx-flow__box').length);
    } finally {
      wrapper.unmount();
    }
  });

  it('traces a token to every box that holds it', async () => {
    const wrapper = await mountDiagram();
    try {
      await wrapper.find('.tx-flow__chip[data-chip]').trigger('mouseenter');
      await nextTick();
      const lit = wrapper.findAll('.tx-flow__box--hi');
      expect(lit).toHaveLength(2);
      expect(wrapper.find('.tx-flow__info').text()).toContain('transactions.flow.trace');
      expect(wrapper.find('.tx-flow__info').text()).toContain('"token":"MIN"');
    } finally {
      wrapper.unmount();
    }
  });

  it('lists collateral and reference inputs apart, as not spent', async () => {
    const none = await mountDiagram();
    const some = await mountDiagram({ model: model({ collateralCount: 1, referenceInputCount: 2 }) });
    try {
      expect(none.find('.tx-flow__unspent').exists()).toBe(false);
      expect(some.findAll('.tx-flow__ghost')).toHaveLength(2);
      expect(some.find('.tx-flow__unspent').text()).toContain('×2');
    } finally {
      none.unmount();
      some.unmount();
    }
  });
});
