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

// happy-dom lays nothing out; the diagram draws only once its container has a width.
// Chip rows are 150px wide and every chip 56px plus a 4px gap, so chip fitting can be measured.
const CHIP_ROW_WIDTH = 150;
const CHIP_STEP = 60;
let canvasWidth = 600;
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get(this: HTMLElement) {
    return this.hasAttribute('data-chips') ? CHIP_ROW_WIDTH : canvasWidth;
  },
});
const realRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element) {
  if (this.hasAttribute('data-chip')) {
    const index = Array.from(this.parentElement?.children ?? []).indexOf(this);
    return { left: index * CHIP_STEP, right: index * CHIP_STEP + 56, top: 0, bottom: 18, width: 56, height: 18, x: index * CHIP_STEP, y: 0, toJSON: () => ({}) } as DOMRect;
  }
  if (this.hasAttribute('data-chips')) {
    return { left: 0, right: CHIP_ROW_WIDTH, top: 0, bottom: 18, width: CHIP_ROW_WIDTH, height: 18, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  }
  return realRect.call(this);
};

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
      await wrapper.find('.tx-flow__chip[data-chip]').trigger('pointerenter', { pointerType: 'mouse' });
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

  describe('token chips', () => {
    const withTokens = (units: string[]) => model({
      inputs: [node('in:mine', 'own', 10_000_000, units.map((unit) => ({ unit, quantity: 5 })))],
      outputs: [node('out:other', 'other', 9_800_000), node('src:fee', 'fee', 200_000)],
    });

    it('folds the chips that do not fit into "+N", naming them in its title', async () => {
      const wrapper = await mountDiagram({ model: withTokens(['AAA', 'BBB', 'CCC']) });
      try {
        await nextTick();
        await nextTick();
        const row = wrapper.find('[data-chips="in:mine"]');
        expect(row.findAll('[data-chip]').map((chip) => chip.text())).toEqual(['5 AAA']);
        const more = row.find('.tx-flow__chip--more');
        expect(more.text()).toBe('+2');
        expect(more.attributes('title')).toBe('BBB, CCC');
      } finally {
        wrapper.unmount();
      }
    });

    it('shows every chip, with no "+N", when they all fit', async () => {
      const wrapper = await mountDiagram({ model: withTokens(['AAA', 'BBB']) });
      try {
        await nextTick();
        await nextTick();
        const row = wrapper.find('[data-chips="in:mine"]');
        expect(row.findAll('[data-chip]')).toHaveLength(2);
        expect(row.find('.tx-flow__chip--more').exists()).toBe(false);
      } finally {
        wrapper.unmount();
      }
    });
  });

  it('goes compact below 520px: no icon, the amount under the label', async () => {
    canvasWidth = 400;
    const narrow = await mountDiagram();
    canvasWidth = 600;
    const wide = await mountDiagram();
    try {
      expect(narrow.find('.tx-flow').classes()).toContain('tx-flow--compact');
      expect(narrow.find('.tx-flow__icon').exists()).toBe(false);
      expect(narrow.find('.tx-flow__ada').exists()).toBe(false);
      expect(wide.find('.tx-flow').classes()).not.toContain('tx-flow--compact');
      expect(wide.find('.tx-flow__icon').exists()).toBe(true);
    } finally {
      narrow.unmount();
      wide.unmount();
    }
  });

  it('pins a tapped box, which a second tap clears; a touch pointer does not hover', async () => {
    const wrapper = await mountDiagram();
    try {
      const mine = () => wrapper.findAll('.tx-flow__box').find((box) => box.classes().includes('tx-flow__box--own'))!;
      await mine().trigger('pointerenter', { pointerType: 'touch' });
      expect(wrapper.findAll('.tx-flow__box--hi')).toHaveLength(0);

      await mine().trigger('click');
      expect(mine().classes()).toEqual(expect.arrayContaining(['tx-flow__box--hi', 'tx-flow__box--pinned']));
      expect(wrapper.findAll('.tx-flow__box--hi')).toHaveLength(1);
      expect(wrapper.find('.tx-flow__band--hi').exists()).toBe(true);
      expect(wrapper.find('.tx-flow__info').text()).toContain('governance.you');

      await mine().trigger('click');
      expect(wrapper.findAll('.tx-flow__box--hi')).toHaveLength(0);
      expect(wrapper.find('.tx-flow__info').text()).toBe('transactions.flow.hint');
    } finally {
      wrapper.unmount();
    }
  });

  it('a tapped chip pins its token in place of a pinned box', async () => {
    const wrapper = await mountDiagram();
    try {
      await wrapper.findAll('.tx-flow__box').find((box) => box.classes().includes('tx-flow__box--own'))!.trigger('click');
      await wrapper.find('.tx-flow__chip[data-chip]').trigger('click');
      expect(wrapper.findAll('.tx-flow__box--pinned')).toHaveLength(0);
      expect(wrapper.findAll('.tx-flow__box--hi')).toHaveLength(2);
    } finally {
      wrapper.unmount();
    }
  });
});
