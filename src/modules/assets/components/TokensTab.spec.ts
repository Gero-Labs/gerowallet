import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';

vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive({ loggedWallet: { chain: 'Cardano' }, tokens: {}, config: {} }) };
});
vi.mock('@/stores/tokenMetadataStore', () => ({ tokenMetadataStore: { tokens: {} } }));
vi.mock('@/stores/coinGeckoStore', () => ({ coinGeckoStore: { cache: {} } }));
vi.mock('@/stores/priceStore', () => ({ priceStore: { adaUsd: { lastPrice: 1 } } }));
vi.mock('@/shared/composables/useCurrencyConverter', () => ({
  useCurrencyConverter: () => ({ convertFiat: (value: number) => value || 0, getCurrencySymbol: () => '$' }),
}));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/modules/market/components/TokenDetailPanel.vue', () => ({
  default: { name: 'TokenDetailPanel', props: ['token'], template: '<div>{{ token.name }}</div>' },
}));

import TokensTab from './TokensTab.vue';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);
beforeEach(() => {
  walletStore.tokens = Object.fromEntries(['H', 'B', 'F', 'D', 'G', 'A', 'E', 'C'].map(name => [name, {
    unit: name, policy_id: 'policy', name, ticker: name, quantity: '1', metadata: { decimals: 0 },
  }]));
  walletStore.tokens['lovelace'] = { unit: 'lovelace', policy_id: '', name: 'Cardano', quantity: '1000000', metadata: { decimals: 6 } } as never;
});
const render = () => mount(TokensTab, {
  props: { sortOptions: { by: 'name', desc: false } },
  global: {
    plugins: [createTestVuetify()],
    // The dialog is outside the table contract; the real table, rows and pagination remain mounted.
    stubs: { 'v-dialog': { props: ['modelValue'], template: '<div v-if="modelValue"><slot /></div>' } },
  },
});
const visibleNames = (wrapper: ReturnType<typeof render>) =>
  wrapper.findAll('tbody tr:not(.no-hover)').map(row => row.find('td:first-child .v-list-item-title').text());

describe('token table with real Vuetify 4', () => {
  it('pins native currency while sorting the entire token list before pagination', async () => {
    const wrapper = render();
    expect(visibleNames(wrapper)).toEqual(['Cardano', 'A', 'B', 'C', 'D', 'E']);
    expect(wrapper.findAll('thead th').map(header => header.text())).toContain('common.asset');
    await wrapper.findComponent({ name: 'VPagination' }).find('[aria-label="Go to page 2"]').trigger('click');
    expect(visibleNames(wrapper)).toEqual(['F', 'G', 'H']);
  });

  it('translates the sort array back to the parent contract and keeps native currency first', async () => {
    const wrapper = render();
    await wrapper.findAll('thead th')[0].trigger('click');
    expect(wrapper.emitted('update:sortOptions')).toEqual([[{ by: 'name', desc: true }]]);
    await wrapper.setProps({ sortOptions: { by: 'name', desc: true } });
    expect(visibleNames(wrapper)).toEqual(['Cardano', 'H', 'G', 'F', 'E', 'D']);
  });

  it('opens details for the clicked raw token rather than an internal table wrapper', async () => {
    const wrapper = render();
    await wrapper.findAll('tbody tr:not(.no-hover)')[1].trigger('click');
    expect(wrapper.findComponent({ name: 'TokenDetailPanel' }).props('token')).toMatchObject({ unit: 'A', name: 'A', balance: 1 });
  });
});
