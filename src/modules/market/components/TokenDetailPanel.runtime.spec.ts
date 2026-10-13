import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { VTabs } from 'vuetify/components';
import { createTestVuetify } from '@test/helpers/vuetify';
import type { MarketToken } from '../composables/useMarketData';

const mocks = vi.hoisted(() => ({ candles: vi.fn() }));
vi.mock('@/modules/market/composables/useMarketData', () => ({ useMarketData: () => ({ getTokenCandles: mocks.candles }) }));
vi.mock('@/modules/market/composables/useWatchlist', () => ({ useWatchlist: () => ({ isWatched: () => false, toggleWatchlist: vi.fn() }) }));
vi.mock('@/modules/market/composables/useWalletPnl', () => ({ useWalletPnl: () => ({ getTokenPnl: () => null }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: { chain: 'Cardano', network: 'Preprod' }, programmableTokens: {} } }));
vi.mock('@/stores/priceStore', () => ({ priceStore: { adaUsd: { lastPrice: 1 } } }));
vi.mock('@/shared/composables/useCurrencyConverter', async () => {
  const { ref } = await import('vue');
  return { useCurrencyConverter: () => ({ usdToEurRate: ref(1) }) };
});
vi.mock('@/modules/market/composables/useNativeCurrency', async () => {
  const { ref } = await import('vue');
  return { useNativeCurrency: () => ({ currencySymbol: ref('ADA'), currencyTicker: ref('ADA') }) };
});
vi.mock('@/utils/networks', () => ({ default: { resolveCurrencyImage: () => '' } }));
vi.mock('@/plugins/snackbar', () => ({ default: { fireSuccess: vi.fn(), setError: vi.fn() } }));
vi.mock('@/shared/composables/useExplorer', () => ({ useExplorer: () => ({ explorerUrl: () => '' }) }));
vi.mock('@/shared/composables/useDustPending', () => ({ getDustPending: () => undefined }));
vi.mock('@/shared/composables/useCnightDustRegistration', async () => {
  const { ref } = await import('vue');
  return {
    CNIGHT_ASSETS: {}, isDustLineDismissed: () => false, dismissDustLineFor: vi.fn(),
    useCnightDustRegistration: () => ({ registrationStatus: ref(null), status: ref(null), refreshStatus: vi.fn() }),
  };
});

// Replace only remote-data widgets. The panel and Vuetify tabs are mounted as
// shipped, so native tab values must select the actual conditional branches.
vi.mock('@/modules/swap/components/GeroSwapEmbed.vue', () => ({ default: { props: ['tokenOut'], template: '<div data-test="swap-widget">{{ tokenOut }}</div>' } }));
vi.mock('./DepthChart.vue', () => ({ default: { template: '<div data-test="depth-chart" />' } }));
vi.mock('./OrderBookTable.vue', () => ({ default: { template: '<div data-test="order-book" />' } }));
vi.mock('./CrossDexPrices.vue', () => ({ default: { props: ['assetId'], template: '<div data-test="markets-widget">{{ assetId }}</div>' } }));
vi.mock('./TechnicalAnalysisChart.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./RecentTrades.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./BuySellVolume.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/modules/dashboard/components/DustGenerationLine.vue', () => ({ default: { template: '<div />' } }));

import TokenDetailPanel from './TokenDetailPanel.vue';

enableAutoUnmount(afterEach);
beforeEach(() => { mocks.candles.mockReset().mockResolvedValue([]); });
afterEach(() => { document.body.innerHTML = ''; });

function token(suffix = '01', overrides: Partial<MarketToken> = {}): MarketToken {
  return {
    unit: 'a'.repeat(56) + suffix, name: 'Fixture token', ticker: 'FIX', img: '', verified: false,
    price: 1, priceAda: 1, priceEur: 1, change1h: 0, change24h: 0, change7d: 0, volume24h: 0,
    mcap: null, tvl: null, liquidity: 0, holders: 0, isNew: false, policyLocked: false, fingerprint: '', decimals: 0,
    ...overrides,
  };
}

function render(asset = token()) {
  return mount(TokenDetailPanel, {
    attachTo: document.body,
    props: { token: asset },
    global: {
      plugins: [createTestVuetify()],
      mocks: { $t: (key: string) => key },
    },
  });
}

function tab(wrapper: ReturnType<typeof render>, name: string) {
  const button = wrapper.findAll('[role="tab"]').find(item => item.text() === `market.${name}`);
  expect(button, `${name} tab`).toBeDefined();
  return button!;
}

describe('TokenDetailPanel with real Vuetify tabs', () => {
  it('shows Swap initially and opens Depth, Markets, and Swap through native tab clicks', async () => {
    const asset = token();
    const wrapper = render(asset);
    await flushPromises();
    expect(wrapper.get('[data-test="swap-widget"]').isVisible()).toBe(true);
    expect(tab(wrapper, 'swap').attributes('aria-selected')).toBe('true');

    await tab(wrapper, 'depth').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="depth-chart"]').isVisible()).toBe(true);
    expect(wrapper.get('[data-test="order-book"]').isVisible()).toBe(true);
    expect(wrapper.find('[data-test="swap-widget"]').exists()).toBe(false);
    expect(wrapper.getComponent(VTabs).props('modelValue')).toBe('depth');

    await tab(wrapper, 'markets').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="markets-widget"]').text()).toBe(asset.unit);
    expect(wrapper.find('[data-test="depth-chart"]').exists()).toBe(false);
    expect(tab(wrapper, 'markets').attributes('aria-selected')).toBe('true');

    await tab(wrapper, 'swap').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="swap-widget"]').text()).toBe(asset.unit);
    expect(wrapper.find('[data-test="markets-widget"]').exists()).toBe(false);
  });

  it('resets to Swap when selecting a different token, including native ADA without Markets', async () => {
    const wrapper = render();
    await flushPromises();
    await tab(wrapper, 'markets').trigger('click');
    const next = token('02');
    await wrapper.setProps({ token: next });
    await flushPromises();
    expect(wrapper.get('[data-test="swap-widget"]').text()).toBe(next.unit);
    expect(tab(wrapper, 'swap').attributes('aria-selected')).toBe('true');

    await tab(wrapper, 'markets').trigger('click');
    await wrapper.setProps({ token: token('', { unit: 'lovelace', ticker: 'ADA' }) });
    await flushPromises();
    expect(wrapper.findAll('[role="tab"]').map(item => item.text())).toEqual(['market.swap', 'market.depth']);
    expect(wrapper.get('.right-col').text()).toContain('market.na');
    expect(tab(wrapper, 'swap').attributes('aria-selected')).toBe('true');
    expect(wrapper.find('[data-test="markets-widget"]').exists()).toBe(false);
  });

  it('starts at Swap when the same token panel is mounted again after closing', async () => {
    const asset = token();
    const wrapper = render(asset);
    await flushPromises();
    await tab(wrapper, 'depth').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="depth-chart"]').exists()).toBe(true);
    await wrapper.findAll('button').find(button => button.find('.mdi-close').exists())!.trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();

    const reopened = render(asset);
    await flushPromises();
    expect(reopened.get('[data-test="swap-widget"]').isVisible()).toBe(true);
    expect(tab(reopened, 'swap').attributes('aria-selected')).toBe('true');
  });
});
