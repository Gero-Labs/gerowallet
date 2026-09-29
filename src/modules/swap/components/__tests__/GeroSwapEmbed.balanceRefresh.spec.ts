import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Vue, { ref } from 'vue';

// Same module doubles as GeroSwapEmbed.spec.ts, except walletStore is reactive here so
// the component's walletStore.utxos watch can fire.
vi.mock('@/modules/market/composables/useMarketData', () => ({
  getTokenByUnit: () => undefined,
  getTokenImage: () => '',
  marketTokensRef: ref([]),
}));

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
vi.mock('@/stores/tokenMetadataStore', async () => {
  const { reactive } = await import('vue');
  const state = reactive({ tokens: {} as Record<string, unknown> });
  return { default: { state }, tokenMetadataStore: state };
});
vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive({ loggedWallet: { network: 'Mainnet', type: 'Normal' }, utxos: [] as unknown[] }) };
});

import GeroSwapEmbed from '../GeroSwapEmbed.vue';
import { walletStore } from '@/stores/walletStore';
import { marketTokensRef } from '@/modules/market/composables/useMarketData';

type SwapEl = HTMLElement & { tokens?: unknown[] };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

// Let the component's (async) watchers run, then fire the 200 ms catalog debounce.
async function flushRebuild(wrapper: ReturnType<typeof mount>) {
  await wrapper.vm.$nextTick();
  vi.advanceTimersByTime(250);
  await wrapper.vm.$nextTick();
}

describe('GeroSwapEmbed balance refresh', () => {
  it('re-sends the catalog when the wallet UTxOs change, so the widget re-reads its balance', async () => {
    const wrapper = mount(GeroSwapEmbed, { propsData: { tokenOut: 'SNEK' } });
    const el = wrapper.find('gero-swap').element as SwapEl;

    // Settle the token-set key with a first market-data tick.
    (marketTokensRef as { value: unknown[] }).value = [];
    await flushRebuild(wrapper);
    const settled = el.tokens;
    expect(Array.isArray(settled)).toBe(true);

    // A price tick with the same token set and unchanged holdings is still skipped.
    (marketTokensRef as { value: unknown[] }).value = [];
    await flushRebuild(wrapper);
    expect(el.tokens).toBe(settled);

    // Holdings change (e.g. sync hydrated after login): same token set, new catalog.
    (walletStore as unknown as { utxos: unknown[] }).utxos = [{}];
    await flushRebuild(wrapper);
    expect(el.tokens).not.toBe(settled);

    wrapper.destroy();
  });
});
