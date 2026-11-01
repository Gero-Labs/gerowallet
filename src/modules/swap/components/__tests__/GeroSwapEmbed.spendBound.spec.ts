import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import { TxIntentMismatchError, type SpendBound } from '@/shared/utils/txIntentGuard';

const getTokenByUnit = vi.hoisted(() => vi.fn());
vi.mock('@/modules/market/composables/useMarketData', () => ({
  getTokenByUnit,
  getTokenImage: () => '',
  marketTokensRef: ref([]),
}));

// Captures what the embed hands the signer, so the budget can be read as signing would.
const signerOptions = vi.hoisted(() => ({ current: null as null | { getSpendBound?: () => Promise<SpendBound | null> } }));
const sharedSignTx = vi.hoisted(() => vi.fn());
vi.mock('../../composables/useNativeSwapSigner', () => ({
  useNativeSwapSigner: (opts: { getSpendBound?: () => Promise<SpendBound | null> }) => {
    signerOptions.current = opts;
    return {
      signer: { meta: { name: 'Gero' }, signTx: sharedSignTx },
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
const setError = vi.hoisted(() => vi.fn());
vi.mock('@/plugins/snackbar', () => ({ default: { setError } }));

import GeroSwapEmbed from '../GeroSwapEmbed.vue';
import i18n from '@/plugins/i18n';

const TOKEN = `${'cd'.repeat(28)}534e454b`;
const widgetEvent = (name: string, payload: unknown) => new CustomEvent(name, { detail: [payload] });
// What a server could put in a quote: far more sold, and fees to match.
const inflatedQuote = (tokenIn: string) => ({
  route: {
    tokenIn, amountIn: '1000000000000', dex: 'MINSWAP_V2',
    aggregatorFeeLovelace: '900000000', batcherFeeLovelace: '500000000', partnerFeeLovelace: '700000000',
  },
});
type WidgetElement = HTMLElement & { amountIn?: string; signer?: { signTx: (cbor: string) => Promise<string> } };

function mountWithInput(typed: string, props: Record<string, unknown> = {}) {
  const wrapper = mount(GeroSwapEmbed, { props });
  const el = wrapper.find('gero-swap').element as WidgetElement;
  el.amountIn = typed; // the widget exposes its input as `amountIn`
  return { wrapper, el };
}
const budget = () => signerOptions.current!.getSpendBound!();

beforeEach(() => {
  getTokenByUnit.mockReset().mockReturnValue({ priceAda: 1_000_000 }); // a price the budget must not use
  resolveToken.mockReset().mockResolvedValue({ unit: TOKEN, decimals: 0 });
  sharedSignTx.mockReset();
  setError.mockReset();
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
    expect(bound?.maxOutflow.get('lovelace')).toBe(56_700_000n);
    expect([...(bound?.maxOutflow.keys() ?? [])]).toEqual(['lovelace']);
  });

  it('budgets a token sale as the tokens typed and the minimum fee, whatever price the wallet has', async () => {
    const { el } = mountWithInput('500');
    el.dispatchEvent(widgetEvent('token-change', { tokenIn: TOKEN, tokenOut: 'lovelace' }));
    el.dispatchEvent(widgetEvent('quote', inflatedQuote(TOKEN)));
    const bound = await budget();
    expect(resolveToken).toHaveBeenCalledWith(TOKEN);
    expect(bound?.maxOutflow.get(TOKEN)).toBe(500n);
    expect(bound?.maxOutflow.get('lovelace')).toBe(6_700_000n);
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

describe('GeroSwapEmbed signing refusals', () => {
  const overBudget = () => new TxIntentMismatchError(String(i18n.t('txGuard.orderMismatch')), ['spendExceeded']);

  it('tells the user to split a token sale over the limit, in the widget and the snackbar', async () => {
    sharedSignTx.mockRejectedValueOnce(overBudget());
    const { el } = mountWithInput('900000', { tokenIn: TOKEN });
    el.dispatchEvent(widgetEvent('quote', inflatedQuote(TOKEN)));
    const expected = String(i18n.t('swap.tokenSaleTooLarge', { limit: '1200' }));
    await expect(el.signer!.signTx('CBOR')).rejects.toMatchObject({ name: 'TxIntentMismatchError', message: expected });
    // The widget reports a signer error as UNKNOWN with the error's message.
    el.dispatchEvent(widgetEvent('swap-error', { code: 'UNKNOWN', message: expected }));
    expect(setError).toHaveBeenCalledWith(expected);
  });

  it('keeps the plain refusal for an ADA sale, and shows it rather than a generic error', async () => {
    const refusal = overBudget();
    sharedSignTx.mockRejectedValueOnce(refusal);
    const { el } = mountWithInput('50');
    el.dispatchEvent(widgetEvent('quote', inflatedQuote('lovelace')));
    await expect(el.signer!.signTx('CBOR')).rejects.toBe(refusal);
    el.dispatchEvent(widgetEvent('swap-error', { code: 'UNKNOWN', message: refusal.message }));
    expect(setError).toHaveBeenCalledWith(refusal.message);
  });

  it('keeps the generic text for an unrelated widget error', async () => {
    const { el } = mountWithInput('50');
    el.dispatchEvent(widgetEvent('swap-error', { code: 'UNKNOWN', message: 'TypeError: x is undefined' }));
    expect(setError).toHaveBeenCalledWith(i18n.t('errors.unknownError'));
  });
});
