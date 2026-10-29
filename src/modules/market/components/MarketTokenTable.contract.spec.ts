import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createTestVuetify } from '../../../../test/helpers/vuetify';
import i18n, { i18nPlugin } from '@/plugins/i18n';
import type { MarketToken } from '../composables/useMarketData';

vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: { chain: 'Cardano', network: 'mainnet', stakeAddress: 'stake_fixture' }, config: {}, tokens: {} } }));
vi.mock('@/modules/market/composables/useWatchlist', () => ({ useWatchlist: () => ({ isWatched: () => false, toggleWatchlist: vi.fn() }) }));
vi.mock('@/modules/market/composables/useColumnPreferences', () => ({ useColumnPreferences: () => ({ isColumnVisible: (key: string) => ['mcap', 'allocation'].includes(key) }) }));
vi.mock('@/shared/composables/useCurrencyConverter', () => ({ useCurrencyConverter: () => ({ convertFiat: (value: number) => value, getCurrencySymbol: () => '$' }) }));
vi.mock('@/modules/market/composables/useNativeCurrency', () => ({ useNativeCurrency: () => ({ currencySymbol: 'ADA' }) }));
vi.mock('@/utils/networks', () => ({ default: { resolveCurrencyImage: () => '' } }));
vi.mock('@/shared/composables/useCnightDustRegistration', () => ({ CNIGHT_ASSETS: { mainnet: { policyId: 'night', assetNameHex: 'unit' } }, isDustLineDismissed: () => false, dismissDustLineFor: vi.fn() }));
vi.mock('@/modules/dashboard/components/DustGenerationLine.vue', () => ({ default: { emits: ['dismiss'], template: '<button class="dismiss-dust" @click="$emit(\'dismiss\')">DUST</button>' } }));

import MarketTokenTable from './MarketTokenTable.vue';

enableAutoUnmount(afterEach);
function token(ticker: string, mcap: number, overrides: Partial<MarketToken> = {}): MarketToken {
  return { unit: ticker, rowKey: ticker, name: ticker, ticker, img: '', verified: false, price: 1, priceAda: 1, priceEur: 1,
    change1h: 0, change24h: 0, change7d: 0, volume24h: 0, mcap, tvl: null, liquidity: 0, holders: 0,
    isNew: false, policyLocked: false, fingerprint: '', decimals: 6, allocation: mcap, ...overrides };
}
const render = (tokens: MarketToken[], showHoldingsColumns = false) => mount(MarketTokenTable, {
  props: { tokens, showHoldingsColumns },
  global: { plugins: [createTestVuetify(), i18nPlugin] },
});
const tickers = (wrapper: ReturnType<typeof render>) => wrapper.findAll('.token-ticker').map(row => row.text());

describe('market table real Vuetify 4 contract', () => {
  it('pins native currency, sorts before pagination, and emits the raw clicked token', async () => {
    const native = token('ADA', 0, { isNative: true });
    const tokens = [native, ...Array.from({ length: 26 }, (_, i) => token(`T${i + 1}`, i + 1))];
    const wrapper = render(tokens);
    expect(tickers(wrapper).slice(0, 3)).toEqual(['ADA', 'T26', 'T25']);
    expect(tickers(wrapper)).toHaveLength(25);
    const header = wrapper.findAll('thead th').find(item => item.text().includes(i18n.t('market.marketCap')));
    expect(header).toBeDefined();
    await header!.trigger('click');
    await header!.trigger('click');
    expect(tickers(wrapper).slice(0, 3)).toEqual(['ADA', 'T1', 'T2']);
    await wrapper.findAll('tbody tr')[1]!.trigger('click');
    expect(wrapper.emitted('token-click')?.[0]?.[0]).toEqual(tokens[1]);
    expect(wrapper.emitted('token-click')?.[0]?.[0]).not.toHaveProperty('internalItem');
    await wrapper.findAll('.v-pagination__item button')[1]!.trigger('click');
    expect(tickers(wrapper)).toEqual(['T25', 'T26']);
  });
  it('expands only the NIGHT row by stable identity and removes the complete row when dismissed', async () => {
    const wrapper = render([token('NIGHT', 10, { unit: 'nightunit', rowKey: 'spendable:nightunit' }), token('OTHER', 1)], true);
    expect(wrapper.findAll('tr.night-dust-row')).toHaveLength(1);
    expect(wrapper.find('tr.night-dust-attached .token-ticker').text()).toBe('NIGHT');
    expect(wrapper.find('tr.night-dust-row td').attributes('colspan')).toBe(String(wrapper.findAll('thead th').length));
    await wrapper.find('.dismiss-dust').trigger('click');
    expect(wrapper.find('tr.night-dust-row').exists()).toBe(false);
    expect(wrapper.find('tr.night-dust-attached').exists()).toBe(false);
  });
  it('badges launchpad rows: CIP-113 lock, then snek.fun, then Solada, then verified', () => {
    const wrapper = render([
      token('SNEK', 6, { isSnekFun: true }),
      token('SOL', 5, { isSolada: true }),
      token('SOLV', 4, { isSolada: true, verified: true }),
      token('VER', 3, { verified: true }),
      token('LOCK', 2, { unit: 'lovelace', rowKey: 'locked:lovelace', isProgrammable: true, isSolada: true }),
      token('PLAIN', 1),
    ]);
    const row = (ticker: string) => wrapper.findAll('tbody tr').find(tr => tr.find('.token-ticker').text() === ticker)!;
    const badges = (ticker: string) => ['.programmable-badge', '.snek-badge', '.solada-badge', '.verified-check']
      .filter(sel => row(ticker).find(sel).exists());

    expect(badges('SNEK')).toEqual(['.snek-badge']);
    expect(badges('SOL')).toEqual(['.solada-badge']);
    expect(badges('SOLV')).toEqual(['.solada-badge']);
    expect(badges('VER')).toEqual(['.verified-check']);
    expect(badges('LOCK')).toEqual(['.programmable-badge']);
    expect(badges('PLAIN')).toEqual([]);

    const snek = row('SNEK').find('.snek-badge');
    expect(snek.attributes('title')).toBe('snek.fun');
    expect(snek.classes()).toContain('mdi-snake');
    const solada = row('SOL').find('.solada-badge');
    expect(solada.attributes('title')).toBe('Solada');
    expect(solada.classes()).toContain('mdi-rocket-launch-outline');
    expect(solada.attributes('style')).toContain('var(--g-info)');
  });
});
