import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import Vue from 'vue';

// Mirrors sidepanel/options main.ts: <gero-swap> self-registers as a real custom
// element, so Vue must not try to resolve it as a component (avoids dev-mode noise).
Vue.config.ignoredElements = [...(Vue.config.ignoredElements || []), 'gero-swap'];

vi.mock('../../composables/useNativeSwapSigner', () => ({
  useNativeSwapSigner: () => ({
    signer: { meta: { name: 'Gero' } },
    keystone: { keystoneShow: { value: false }, keystoneType: { value: '' }, keystoneCbor: { value: '' }, onKeystoneScan: vi.fn(), cancelKeystone: vi.fn(), failKeystone: vi.fn() },
  }),
}));
vi.mock('../../composables/useSwapTokenResolver', () => ({
  useSwapTokenResolver: () => ({ resolveToken: vi.fn() }),
  buildHeldBalanceMap: () => new Map(),
}));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { isSwapEnabled: () => true } }));
vi.mock('@/stores/tokenMetadataStore', () => ({ default: { state: { tokens: {} } }, tokenMetadataStore: { tokens: {} } }));
vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: { network: 'Mainnet', type: 'Normal' } } }));

import GeroSwapEmbed from '../GeroSwapEmbed.vue';

describe('GeroSwapEmbed', () => {
  it('renders <gero-swap native> and sets signer + resolveToken as element properties', async () => {
    const wrapper = mount(GeroSwapEmbed, { propsData: { tokenOut: 'SNEK' } });
    const el = wrapper.find('gero-swap').element as HTMLElement & { signer?: unknown; resolveToken?: unknown };
    expect(el).toBeTruthy();
    expect(el.getAttribute('mode')).toBe('native');
    expect(el.getAttribute('token-out')).toBe('SNEK');
    await wrapper.vm.$nextTick();
    expect(el.signer).toBeTruthy();
    expect(typeof el.resolveToken).toBe('function');
  });

  it('re-emits swap-submitted from the element', async () => {
    const wrapper = mount(GeroSwapEmbed, {});
    const el = wrapper.find('gero-swap').element;
    el.dispatchEvent(new CustomEvent('swap-submitted', { detail: { txHash: 'TX' } }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('swap-submitted')?.[0]?.[0]).toMatchObject({ txHash: 'TX' });
  });
});
