import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';

// useMarketData.ts uses module-level auto-imported `ref` (undefined under vitest);
// the catalog builder needs getTokenByUnit/getTokenImage for token logos, and
// GeroSwapEmbed.vue also watch()es `allTokens` directly (to rebuild the catalog once
// market data hydrates), so it must be a real ref — not undefined — or Vue's watch()
// throws an "Invalid watch source" warning.
vi.mock('@/modules/market/composables/useMarketData', () => ({
  // Passive module-level readers the swap imports directly (no useMarketData() call).
  getTokenByUnit: () => undefined,
  getTokenImage: () => '',
  marketTokensRef: ref([]),
}));

// Mirrors sidepanel/options main.ts: <gero-swap> self-registers as a real custom
// element, so Vue must not try to resolve it as a component (avoids dev-mode noise).

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
// `state` must be genuinely reactive (not a plain object) so GeroSwapEmbed.vue's
// `watch(() => TokenMetadataStore.state.tokens, ...)` actually fires when a test
// reassigns `.tokens` post-mount (simulating the async registry hydration).
vi.mock('@/stores/tokenMetadataStore', async () => {
  const { reactive } = await import('vue');
  const state = reactive({ tokens: {} as Record<string, unknown> });
  return { default: { state }, tokenMetadataStore: state };
});
vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: { network: 'Mainnet', type: 'Normal' } } }));
const sendToBackgroundFromOptions = vi.hoisted(() => vi.fn());
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions } }));
const setError = vi.hoisted(() => vi.fn());
vi.mock('@/plugins/snackbar', () => ({ default: { setError } }));

import GeroSwapEmbed from '../GeroSwapEmbed.vue';
import TokenMetadataStore from '@/stores/tokenMetadataStore';
import { walletStore } from '@/stores/walletStore';
import { MessageTypes } from '@/models/MessageTypes';
import i18n from '@/plugins/i18n';

// What <gero-swap> really dispatches: a Vue custom element puts the emit's argument
// ARRAY in `detail`, not the payload itself.
const widgetEvent = (name: string, payload: unknown) => new CustomEvent(name, { detail: [payload] });
const TX_HASH = 'ab'.repeat(32);
const ADDRESS = 'addr1q8xf2scs38ttgmhmgpuxv73fcckwa65r56rptlhv3akdyty0wdhwf8eevhfg8cxc6r70ncprncasd2x87x7q9ezxe95q37pkan';

beforeEach(() => {
  // Reset the shared reactive registry between tests so one test's tokens don't leak
  // into the next.
  TokenMetadataStore.state.tokens = {};
  sendToBackgroundFromOptions.mockReset().mockResolvedValue({ data: { success: true } });
  setError.mockReset();
  walletStore.loggedWallet = { network: 'Mainnet', type: 'Normal' } as typeof walletStore.loggedWallet;
});

describe('GeroSwapEmbed', () => {
  it('renders <gero-swap native> and sets signer + resolveToken as element properties', async () => {
    const wrapper = mount(GeroSwapEmbed, { props: { tokenOut: 'SNEK' } });
    const el = wrapper.find('gero-swap').element as HTMLElement & { signer?: unknown; resolveToken?: unknown };
    expect(el).toBeTruthy();
    expect(el.getAttribute('mode')).toBe('native');
    expect(el.getAttribute('token-out')).toBe('SNEK');
    await wrapper.vm.$nextTick();
    expect(el.signer).toBeTruthy();
    expect(typeof el.resolveToken).toBe('function');
  });

  it('forwards arbitrary token units, including native lovelace, as token-in', async () => {
    const tokenIn = '1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378';
    const wrapper = mount(GeroSwapEmbed, { props: { tokenIn, tokenOut: 'lovelace' } });
    const el = wrapper.find('gero-swap').element;
    expect(el.getAttribute('token-in')).toBe(tokenIn);
    expect(el.getAttribute('token-out')).toBe('lovelace');
    await wrapper.setProps({ tokenIn: 'lovelace', tokenOut: 'another-policy.token' });
    expect(el.getAttribute('token-in')).toBe('lovelace');
    expect(el.getAttribute('token-out')).toBe('another-policy.token');
  });

  it('re-emits swap-submitted from the element with the widget payload', async () => {
    const wrapper = mount(GeroSwapEmbed, {});
    const el = wrapper.find('gero-swap').element;
    el.dispatchEvent(widgetEvent('swap-submitted', { txHash: 'TX' }));
    el.dispatchEvent(new CustomEvent('swap-submitted', { detail: { txHash: 'TX2' } })); // a plain payload still works
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('swap-submitted')?.[0]?.[0]).toEqual({ txHash: 'TX' });
    expect(wrapper.emitted('swap-submitted')?.[1]?.[0]).toEqual({ txHash: 'TX2' });
  });

  it('registers a submitted swap for fill/cancel alerts', async () => {
    walletStore.loggedWallet = { ...walletStore.loggedWallet, id: 7, baseAddress: ADDRESS } as typeof walletStore.loggedWallet;
    const wrapper = mount(GeroSwapEmbed, {});
    wrapper.find('gero-swap').element.dispatchEvent(widgetEvent('swap-submitted', { txHash: TX_HASH, trackingUrl: 'https://x' }));
    await wrapper.vm.$nextTick();
    expect(sendToBackgroundFromOptions).toHaveBeenCalledWith({
      method: MessageTypes.NOTIFY_WATCH_ORDERS,
      data: { walletId: 7, ownerPkh: expect.stringMatching(/^[0-9a-f]{56}$/), txHashes: [TX_HASH] },
    });
  });

  it('does not register a swap without a valid tx hash', async () => {
    walletStore.loggedWallet = { ...walletStore.loggedWallet, id: 7, baseAddress: ADDRESS } as typeof walletStore.loggedWallet;
    const wrapper = mount(GeroSwapEmbed, {});
    wrapper.find('gero-swap').element.dispatchEvent(widgetEvent('swap-submitted', { txHash: 'not-a-hash' }));
    await wrapper.vm.$nextTick();
    expect(sendToBackgroundFromOptions).not.toHaveBeenCalled();
  });

  it('maps a widget error code to its translated message', async () => {
    const wrapper = mount(GeroSwapEmbed, {});
    wrapper.find('gero-swap').element.dispatchEvent(widgetEvent('swap-error', { code: 'NO_ROUTE', message: 'raw' }));
    await wrapper.vm.$nextTick();
    expect(setError).toHaveBeenCalledWith(i18n.t('swap.poolNotFound'));
    expect(wrapper.emitted('swap-error')?.[0]?.[0]).toEqual({ code: 'NO_ROUTE', message: 'raw' });
  });

  it('dedupes ADA/lovelace to a single catalog entry even when the registry has its own ADA-ish row', async () => {
    // The swap-tradable registry represents native ADA with its own entry
    // (empty unit, ticker 'ADA') distinct from the 'lovelace' unit this app uses.
    TokenMetadataStore.state.tokens = {
      '': { unit: '', ticker: 'ADA', decimals: 6, verified: true },
      'policyabc.foo': { unit: 'policyabc.foo', ticker: 'FOO', decimals: 0 },
    };
    const wrapper = mount(GeroSwapEmbed, { props: { tokenOut: 'SNEK' } });
    await wrapper.vm.$nextTick();
    const el = wrapper.find('gero-swap').element as HTMLElement & { tokens?: Array<{ unit: string; ticker?: string; balance?: string }> };
    const adaRows = (el.tokens ?? []).filter(t => t.unit === 'lovelace' || (t.ticker ?? '').toUpperCase() === 'ADA');
    expect(adaRows).toHaveLength(1);
    expect(adaRows[0].unit).toBe('lovelace');
  });

  it('defaults the Buying token to GERO when the host does not specify tokenOut and GERO is already known', async () => {
    TokenMetadataStore.state.tokens = {
      'policygero.token': { unit: 'policygero.token', ticker: 'GERO', decimals: 6 },
    };
    const wrapper = mount(GeroSwapEmbed, {});
    await wrapper.vm.$nextTick();
    const el = wrapper.find('gero-swap').element;
    expect(el.getAttribute('token-out')).toBe('policygero.token');
  });

  it('leaves token-out unset until GERO hydrates, then sets it (only if the host did not specify one)', async () => {
    const wrapper = mount(GeroSwapEmbed, {});
    await wrapper.vm.$nextTick();
    let el = wrapper.find('gero-swap').element;
    expect(el.getAttribute('token-out')).toBeFalsy();

    // Registry hydrates (a-la setTokens()'s wholesale reassignment) with GERO now present.
    TokenMetadataStore.state.tokens = {
      'policygero.token': { unit: 'policygero.token', ticker: 'GERO', decimals: 6 },
    };
    // scheduleCatalogRebuild() debounces 200ms.
    await new Promise(resolve => setTimeout(resolve, 260));
    await wrapper.vm.$nextTick();

    el = wrapper.find('gero-swap').element;
    expect(el.getAttribute('token-out')).toBe('policygero.token');
  });

  it('never overrides the Buying token once the user has picked one, even if GERO changes later', async () => {
    TokenMetadataStore.state.tokens = {
      'policygero.token': { unit: 'policygero.token', ticker: 'GERO', decimals: 6 },
    };
    const wrapper = mount(GeroSwapEmbed, {});
    await wrapper.vm.$nextTick();
    const el = wrapper.find('gero-swap').element;
    expect(el.getAttribute('token-out')).toBe('policygero.token'); // default applied

    // Simulate the user picking a different Buying token inside the widget.
    el.dispatchEvent(widgetEvent('token-change', { tokenIn: 'lovelace', tokenOut: 'someOtherUnit' }));
    await wrapper.vm.$nextTick();

    // Registry changes again post-pick — must NOT stomp the user's choice.
    TokenMetadataStore.state.tokens = {
      'policygero2.token': { unit: 'policygero2.token', ticker: 'GERO', decimals: 6 },
    };
    await new Promise(resolve => setTimeout(resolve, 260));
    await wrapper.vm.$nextTick();

    expect(el.getAttribute('token-out')).toBeFalsy(); // no forced re-binding by the host
  });
});
