import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import type { SpendBound } from '@/shared/utils/txIntentGuard';

const market = vi.hoisted(() => ({ price: undefined as number | undefined }));
vi.mock('@/modules/market/composables/useMarketData', () => ({
  getTokenByUnit: (unit: string) => (market.price === undefined ? undefined : { unit, priceAda: market.price }),
  getTokenImage: () => '',
  marketTokensRef: ref([]),
}));
const getTokenPrice = vi.hoisted(() => vi.fn());
vi.mock('@/api/market-api', () => ({ default: { getTokenPrice } }));

// Captures what the embed hands the signer, so the budget can be read as signing would.
const signerOptions = vi.hoisted(() => ({ current: null as null | { getSpendBound?: () => Promise<SpendBound | null> } }));
vi.mock('../../composables/useNativeSwapSigner', () => ({
  useNativeSwapSigner: (opts: { getSpendBound?: () => Promise<SpendBound | null> }) => {
    signerOptions.current = opts;
    return {
      signer: { meta: { name: 'Gero' } },
      keystone: { keystoneShow: { value: false }, keystoneType: { value: '' }, keystoneCbor: { value: '' }, onKeystoneScan: vi.fn(), cancelKeystone: vi.fn(), failKeystone: vi.fn() },
    };
  },
}));
const resolveToken = vi.hoisted(() => vi.fn());
vi.mock('../../composables/useSwapTokenResolver', () => ({
  useSwapTokenResolver: () => ({ resolveToken }),
  buildHeldBalanceMap: () => new Map(),
}));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { isSwapEnabled: () => true } }));
vi.mock('@/stores/tokenMetadataStore', async () => {
  const { reactive } = await import('vue');
  const state = reactive({ tokens: {} as Record<string, unknown> });
  return { default: { state }, tokenMetadataStore: state };
});
vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: { network: 'Mainnet', type: 'Normal' } } }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: vi.fn().mockResolvedValue({}) } }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn() } }));

import GeroSwapEmbed from '../GeroSwapEmbed.vue';

const ADA = 1_000_000n;
const TOKEN = `${'cd'.repeat(28)}534e454b`;
const widgetEvent = (name: string, payload: unknown) => new CustomEvent(name, { detail: [payload] });
// What a server could put in a quote: far more sold, and fees to match.
const inflatedQuote = (tokenIn: string) => ({
  route: {
    tokenIn, amountIn: '1000000000000', dex: 'MINSWAP_V2',
    aggregatorFeeLovelace: '900000000', batcherFeeLovelace: '500000000', partnerFeeLovelace: '700000000',
  },
});

function mountWithInput(typed: string, props: Record<string, unknown> = {}) {
  const wrapper = mount(GeroSwapEmbed, { props });
  const el = wrapper.find('gero-swap').element as HTMLElement & { amountIn?: string };
  el.amountIn = typed; // the widget exposes its input as `amountIn`
  return { wrapper, el };
}
const budget = () => signerOptions.current!.getSpendBound!();

beforeEach(() => {
  market.price = undefined;
  getTokenPrice.mockReset().mockRejectedValue(new Error('offline'));
  resolveToken.mockReset().mockResolvedValue({ unit: TOKEN, decimals: 0 });
});

describe('GeroSwapEmbed spend budget', () => {
  it('has no budget before a quote', async () => {
    mountWithInput('50');
    expect(await budget()).toBeNull();
  });

  it('budgets the amount the user typed, not what the quote claims', async () => {
    const { el } = mountWithInput('50');
    el.dispatchEvent(widgetEvent('quote', inflatedQuote('lovelace')));
    const bound = await budget();
    expect(bound?.maxOutflow.get('lovelace')).toBe(62n * ADA);
    expect([...(bound?.maxOutflow.keys() ?? [])]).toEqual(['lovelace']);
  });

  it('budgets the token the user is selling, at the amount typed and the wallet\'s own price', async () => {
    market.price = 20; // ADA per token: 500 tokens are worth 10,000 ADA
    const { el } = mountWithInput('500');
    el.dispatchEvent(widgetEvent('token-change', { tokenIn: TOKEN, tokenOut: 'lovelace' }));
    el.dispatchEvent(widgetEvent('quote', inflatedQuote(TOKEN)));
    const bound = await budget();
    expect(resolveToken).toHaveBeenCalledWith(TOKEN);
    expect(bound?.maxOutflow.get(TOKEN)).toBe(500n);
    // 30 bps of 2 x 10,000 ADA, plus the largest DEX overhead.
    expect(bound?.maxOutflow.get('lovelace')).toBe(65_500_000n);
  });

  it('asks the market API for a price the cache does not hold, and keeps to the floor without one', async () => {
    getTokenPrice.mockResolvedValueOnce({ priceAda: 20 });
    const { el } = mountWithInput('500', { tokenIn: TOKEN });
    el.dispatchEvent(widgetEvent('quote', inflatedQuote(TOKEN)));
    expect((await budget())?.maxOutflow.get('lovelace')).toBe(65_500_000n);
    expect(getTokenPrice).toHaveBeenCalledWith(TOKEN);
    expect((await budget())?.maxOutflow.get('lovelace')).toBe(12n * ADA);
  });

  it('gives no budget for an amount it cannot read or a token without decimals', async () => {
    const { el } = mountWithInput('abc');
    el.dispatchEvent(widgetEvent('quote', inflatedQuote('lovelace')));
    expect(await budget()).toBeNull();

    resolveToken.mockResolvedValueOnce(null);
    el.amountIn = '5';
    el.dispatchEvent(widgetEvent('token-change', { tokenIn: TOKEN, tokenOut: 'lovelace' }));
    expect(await budget()).toBeNull();
  });

  it('spends the quote once the swap is submitted, so a later cancel gets no budget', async () => {
    const { el } = mountWithInput('50');
    el.dispatchEvent(widgetEvent('quote', inflatedQuote('lovelace')));
    el.dispatchEvent(widgetEvent('swap-submitted', { txHash: 'ab'.repeat(32) }));
    expect(await budget()).toBeNull();
  });
});
