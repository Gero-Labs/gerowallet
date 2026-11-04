// Merging the wallet before a swap: the merge is built as the dialog opens, its transactions
// and fee are shown before the user approves, and the dialog reports the merge once it is sent.
import * as Vue from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cardano } from '@cardano-sdk/core';

const state = vi.hoisted(() => ({
  consolidate: vi.fn(),
  reset: vi.fn(),
  canSweep: true,
  refs: null as null | { sweep: { value: unknown } },
  sign: null as null | { props: { prepare: () => Promise<unknown>; disabled: boolean; prerequisites: unknown }; emit: (event: string, value: unknown) => void },
}));

vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}${JSON.stringify(params)}` : key),
    tc: (key: string) => key,
  }),
}));
vi.mock('@/shared/composables/usePaymentSweep', async () => {
  const { computed, ref, shallowRef } = await import('vue');
  const sweep = shallowRef<{ mergeCbors: string[] } | null>(null);
  state.refs = { sweep };
  return {
    usePaymentSweep: () => ({
      sweep,
      payment: shallowRef(null),
      preparing: ref(null),
      prerequisites: computed(() => (sweep.value ? { cbors: sweep.value.mergeCbors, outputs: [] } : null)),
      consolidate: state.consolidate,
      reset: () => { state.reset(); sweep.value = null; },
    }),
  };
});
vi.mock('@/stores/walletStore', () => ({ walletStore: { utxos: [], collateral: null, transactions: [] } }));
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({ default: {
  name: 'BaseDialog', props: ['isOpen'], emits: ['close'],
  render(this: { $slots: { default?: () => Vue.VNode[] } }) { return Vue.h('div', this.$slots.default?.()); },
} }));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({ default: {
  emits: ['click'],
  render(this: { $slots: { default?: () => Vue.VNode[] }; $emit: (event: string) => void }) {
    return Vue.h('button', { onClick: () => this.$emit('click') }, this.$slots.default?.());
  },
} }));
vi.mock('@/modules/wallet/components/ui/CardSignSection.vue', () => ({ default: {
  props: ['label', 'prepare', 'disabled', 'prerequisites'],
  emits: ['submitted', 'busy', 'progress', 'interrupted'],
  setup(props: { prepare: () => Promise<unknown>; disabled: boolean; prerequisites: unknown }, { expose, emit }: { expose: (exposed: Record<string, unknown>) => void; emit: (event: string, value: unknown) => void }) {
    state.sign = { props, emit };
    expose({ reset: vi.fn(), canSweep: state.canSweep });
    return () => Vue.h('div');
  },
} }));

import SwapMergeDialog from '../SwapMergeDialog.vue';

const FINAL = { body: { fee: 250_000n } } as unknown as Cardano.Tx;

/** What consolidate() does for a wallet over the request limit: merges, then the final transaction. */
function mergeWithSweep() {
  state.refs!.sweep.value = { merges: [{}, {}], mergeCbors: ['m1', 'm2'], mergeFee: 400_000n };
  return FINAL;
}

async function openDialog() {
  const wrapper = mount(SwapMergeDialog, { props: { open: false } });
  await wrapper.setProps({ open: true });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  state.canSweep = true;
  state.consolidate.mockReset().mockImplementation(async () => mergeWithSweep());
});
afterEach(() => vi.clearAllMocks());

describe('SwapMergeDialog', () => {
  it('builds the merge as it opens and shows its transactions and fee before approval', async () => {
    const wrapper = await openDialog();
    expect(state.consolidate).toHaveBeenCalledTimes(1);
    const figures = wrapper.get('.swap-merge__figures').text();
    expect(figures).toContain('3');
    expect(figures).toContain('₳0.65');
    expect(state.sign?.props.disabled).toBe(false);
    expect(state.sign?.props.prerequisites).toEqual({ cbors: ['m1', 'm2'], outputs: [] });
  });

  it('signs the planned merge and reports it once sent', async () => {
    const wrapper = await openDialog();
    await expect(state.sign!.props.prepare()).resolves.toBe(FINAL);
    state.sign!.emit('submitted', 'final-tx');
    await flushPromises();
    expect(wrapper.emitted('merged')).toEqual([['final-tx']]);
    expect(wrapper.text()).toContain('swap.mergeSent');
  });

  it('says so when this wallet cannot sign a merge under one approval', async () => {
    state.canSweep = false;
    const wrapper = await openDialog();
    expect(wrapper.get('[role="alert"]').text()).toBe('send.sweepSoftwareOnly');
    expect(state.sign?.props.disabled).toBe(true);
  });

  it('forgets the merge when closed', async () => {
    const wrapper = await openDialog();
    state.reset.mockClear();
    wrapper.findComponent({ name: 'BaseDialog' }).vm.$emit('close');
    await flushPromises();
    expect(state.reset).toHaveBeenCalled();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
