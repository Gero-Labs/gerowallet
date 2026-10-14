import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import i18n, { i18nPlugin, loadLanguage } from '@/plugins/i18n';
import { Network } from '@/models/types';
import type { MidnightUnshieldedUtxo } from '@/chains/midnight/midnightTypes';
import { MIDNIGHT_TOKENS } from '@/chains/midnight/midnightTokenRegistry';

vi.mock('@/stores/midnightStore', async () => {
  const { reactive } = await import('vue');
  return { midnightStore: reactive({ balances: { nightUnshielded: 0n }, utxos: [] }) };
});
vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive({ loggedWallet: { network: 'Mainnet' } }) };
});
vi.mock('@/shared/composables/useMidnightLoading', async () => {
  const { ref } = await import('vue');
  return { useMidnightLoading: () => ref(false) };
});
vi.mock('@/shared/composables/useNightFiat', async () => {
  const { ref } = await import('vue');
  return { useNightFiat: () => ({
    usd: ref(0.5), change24h: ref(2.5), hasPrice: ref(true), refresh: vi.fn(),
  }) };
});
vi.mock('@/modules/market/composables/useMarketData', () => ({
  getTokenByUnit: () => ({ price: 1, change24h: -1.2 }),
}));
// The private-balance panel owns separate SDK/sync behavior. Keep the real
// holdings table, its row slots, token derivation, formatters and i18n intact.
vi.mock('./MidnightPrivateBalances.vue', () => ({ default: { template: '<aside />' } }));

import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';
import MidnightHoldingsTable from './MidnightHoldingsTable.vue';

enableAutoUnmount(afterEach);
const knownColor = Object.keys(MIDNIGHT_TOKENS)[0]!;
const unknownColor = 'ab'.repeat(32);
const headerKeys = ['rank', 'token', 'balance', 'price', 'value', 'change24h', 'marketCap', 'avgCost', 'totalPnl'];
const utxo = (tokenType: string, value: bigint): MidnightUnshieldedUtxo => ({
  tokenType, value, owner: 'fixture-owner', intentHash: 'fixture-intent', outputIndex: 0,
  initialNonce: '', registeredForDustGeneration: false,
});
const render = () => mount(MidnightHoldingsTable, {
  global: { plugins: [createTestVuetify(), i18nPlugin] },
});

beforeEach(() => {
  i18n.locale = 'us';
  walletStore.loggedWallet.network = Network.MAINNET;
  midnightStore.balances.nightUnshielded = 12_500_000n;
  midnightStore.utxos = [utxo(knownColor, 2_250_000n), utxo(unknownColor, 123n)];
});
afterEach(() => { i18n.locale = 'us'; });

describe('Midnight holdings with the real Vuetify 4 table', () => {
  it('renders all nine translated headers and updates them when the locale changes', async () => {
    const wrapper = render();
    await flushPromises();
    for (const locale of ['us', 'de', 'es']) {
      await loadLanguage(locale);
      i18n.locale = locale;
      await nextTick();
      const titles = wrapper.findAll('thead th').map(header => header.text());
      expect(titles).toEqual(headerKeys.map(key => i18n.t(`market.${key}`)));
      expect(titles.every(title => title.length > 0 && !title.startsWith('market.'))).toBe(true);
    }
  });

  it('keeps every slot aligned for native, listed and unknown-token holdings', async () => {
    const wrapper = render();
    await flushPromises();
    const rows = wrapper.findAll('tbody tr');
    expect(rows).toHaveLength(3);
    const cells = rows.map(row => row.findAll('td').map(cell => cell.text()));
    expect(cells).toEqual([
      ['1', 'NIGHTMidnight Native Token', '12.50 NIGHTNIGHT is public', '$0.5000', '$6.25', '▲ 2.5%', '—', '—', '—'],
      ['2', 'USDMMidnight USDM', '2.25 USDM', '$1.00', '$2.25', '▼ 1.2%', '—', '—', '—'],
      ['3', 'abababab…abababUnknown token', '123Raw amount, decimals unknown', '—', '—', '—', '—', '—', '—'],
    ]);
    expect(rows[0]!.findAll('td')[5]!.find('.delta-up').exists()).toBe(true);
    expect(rows[1]!.findAll('td')[5]!.find('.delta-down').exists()).toBe(true);

    // Reactive balance updates reach the same column; changing networks removes
    // mainnet-only NIGHT prices without moving or dropping any cells.
    midnightStore.balances.nightUnshielded = 20_000_000n;
    walletStore.loggedWallet.network = Network.PREPROD;
    await nextTick();
    const nightCells = wrapper.findAll('tbody tr')[0]!.findAll('td').map(cell => cell.text());
    expect(nightCells).toEqual([
      '1', 'tNIGHTMidnight Native Token', '20.00 tNIGHTNIGHT is public', '—', '—', '—', '—', '—', '—',
    ]);
  });
});
