// A sale the largest UTxOs one transaction holds cannot cover: the swap screen offers to merge
// the wallet first, says so while the merge lands, and lets the swap go once it has.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import * as Vue from 'vue';

vi.mock('@/modules/market/composables/useMarketData', () => ({
  getTokenByUnit: () => undefined,
  getTokenImage: () => '',
  marketTokensRef: ref([]),
}));
vi.mock('../../composables/useNativeSwapSigner', () => ({
  useNativeSwapSigner: () => ({
    signer: { meta: { name: 'Gero' }, signTx: vi.fn() },
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
  return { walletStore: reactive({ loggedWallet: { network: 'Mainnet', type: 'Normal' }, utxos: [] as unknown[], collateral: null, transactions: [] }) };
});
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: vi.fn().mockResolvedValue({}) } }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn() } }));
// The dialog has its own spec; here it only reports that the merge went out.
vi.mock('../SwapMergeDialog.vue', () => ({ default: {
  name: 'SwapMergeDialog', props: ['open'], emits: ['close', 'merged'],
  render: () => Vue.h('div', { 'data-merge-dialog': '' }),
} }));

import GeroSwapEmbed from '../GeroSwapEmbed.vue';
import { walletStore } from '@/stores/walletStore';

const widgetEvent = (name: string, payload: unknown) => new CustomEvent(name, { detail: [payload] });
const quote = { route: { tokenIn: 'lovelace', amountIn: '1', dex: 'MINSWAP_V2' } };
const txId = (n: number) => n.toString(16).padStart(64, '0');
// 300 UTxOs of 1 ADA: the largest 200 hold 200 ADA.
const wallet = () => Array.from({ length: 300 }, (_, n) => [{ txId: txId(n), index: 0 }, { address: 'own', value: { coins: 1_000_000n } }]);

async function quoteFor(typed: string) {
  const wrapper = mount(GeroSwapEmbed, { attachTo: document.body, global: { mocks: { $t: (key: string) => key } } });
  const el = wrapper.find('gero-swap').element as HTMLElement & { amountIn?: string };
  el.amountIn = typed;
  el.dispatchEvent(widgetEvent('quote', quote));
  await flushPromises();
  return { wrapper, el };
}

beforeEach(() => {
  walletStore.loggedWallet = { network: 'Mainnet', type: 'Normal' } as typeof walletStore.loggedWallet;
  walletStore.utxos = wallet() as never;
});

describe('GeroSwapEmbed merge first', () => {
  it('offers to merge first when the largest UTxOs cannot cover the sale', async () => {
    const { wrapper } = await quoteFor('250');
    expect(wrapper.find('.gero-swap-embed__merge').text()).toContain('swap.mergeNeededTitle');
    expect(wrapper.find('[data-merge-dialog]').exists()).toBe(false);
    await wrapper.get('.gero-swap-embed__merge .g-btn').trigger('click');
    expect(wrapper.find('[data-merge-dialog]').exists()).toBe(true);
  });

  it('offers nothing when the largest UTxOs cover the sale', async () => {
    const { wrapper } = await quoteFor('100');
    expect(wrapper.find('.gero-swap-embed__merge').exists()).toBe(false);
  });

  it('offers nothing to a hardware wallet, which cannot sign a merge under one approval', async () => {
    walletStore.loggedWallet = { network: 'Mainnet', type: 'Ledger' } as typeof walletStore.loggedWallet;
    const { wrapper } = await quoteFor('250');
    expect(wrapper.find('.gero-swap-embed__merge').exists()).toBe(false);
  });

  it('says the merge is landing once sent, and clears when the wallet holds it', async () => {
    const { wrapper } = await quoteFor('250');
    await wrapper.get('.gero-swap-embed__merge .g-btn').trigger('click');
    wrapper.findComponent({ name: 'SwapMergeDialog' }).vm.$emit('merged', 'merge-final');
    await flushPromises();
    expect(wrapper.find('.gero-swap-embed__merge').text()).toContain('swap.mergeLanding');

    // The merge lands: the wallet now holds its one output, and the sale fits.
    walletStore.utxos = [[{ txId: 'merge-final', index: 0 }, { address: 'own', value: { coins: 299_000_000n } }]] as never;
    await flushPromises();
    expect(wrapper.find('.gero-swap-embed__merge').exists()).toBe(false);
  });
});
