// The merge dialog builds through the cache the swap screen hands it, so opening it again
// (it mounts afresh each time) reuses the merges instead of rebuilding them.
import * as Vue from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ options: [] as unknown[] }));

vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key, tc: (key: string) => key }) }));
vi.mock('@/shared/composables/usePaymentSweep', async () => {
  const { computed, ref, shallowRef } = await import('vue');
  return {
    usePaymentSweep: (options?: unknown) => {
      state.options.push(options);
      return {
        sweep: shallowRef(null), payment: shallowRef(null), preparing: ref(null),
        prerequisites: computed(() => null), consolidate: vi.fn(() => new Promise(() => {})), reset: vi.fn(),
      };
    },
  };
});
vi.mock('@/stores/walletStore', () => ({ walletStore: { utxos: [], collateral: null, transactions: [] } }));
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({ default: { render(this: { $slots: { default?: () => Vue.VNode[] } }) { return Vue.h('div', this.$slots.default?.()); } } }));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({ default: { render: () => Vue.h('button') } }));
vi.mock('@/modules/wallet/components/ui/CardSignSection.vue', () => ({ default: { render: () => Vue.h('div') } }));

import SwapMergeDialog from '../SwapMergeDialog.vue';
import { createSweepCache } from '@/api/sweepCache';

describe('SwapMergeDialog cache', () => {
  it('builds through the cache it is handed', () => {
    const cache = createSweepCache();
    mount(SwapMergeDialog, { props: { open: false, cache } });
    expect(state.options.at(-1)).toEqual({ cache });
  });
});
