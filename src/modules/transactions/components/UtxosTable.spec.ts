import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';

vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive({ utxos: [], collateral: null }) };
});

import UtxosTable from './UtxosTable.vue';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);
const utxo = (txId: string, coins: bigint) => [
  { txId, index: 0 },
  { address: 'addr_test_fixture', value: { coins, assets: new Map() } },
] as const;
const titles: Record<string, string> = {
  'transactions.utxoRef': 'UTxO reference',
  'transactions.amount': 'Amount',
};
const render = (selectedUtxo?: { id: string }) => mount(UtxosTable, {
  props: { selectedUtxo },
  global: {
    plugins: [createTestVuetify()],
    config: { globalProperties: mockGlobalProperties({ $t: (key: string) => titles[key] ?? key }) },
  },
});
const rows = (wrapper: ReturnType<typeof render>) => wrapper.findAll('tbody tr');

beforeEach(() => {
  walletStore.utxos = [utxo('low-hash', 1_000_000n), utxo('high-hash', 3_000_000n)] as never;
  walletStore.collateral = walletStore.utxos[0] as never;
});

describe('UTxO table with real Vuetify 4', () => {
  it('renders translated headers and uses the native sort array contract', async () => {
    const wrapper = render();
    expect(wrapper.findAll('thead th').map(header => header.text())).toEqual(['UTxO reference', 'Amount']);
    expect(rows(wrapper)[0].text()).toContain('high-hash#0');
    // Vuetify cycles descending -> unsorted -> ascending.
    await wrapper.findAll('thead th')[1].trigger('click');
    expect(wrapper.findComponent({ name: 'VDataTable' }).props('sortBy')).toEqual([]);
    await wrapper.findAll('thead th')[1].trigger('click');
    expect(wrapper.findComponent({ name: 'VDataTable' }).props('sortBy')).toEqual([{ key: 'ada', order: 'asc' }]);
    expect(rows(wrapper)[0].text()).toContain('low-hash#0');
  });

  it('emits the raw domain row and updates the selected row class', async () => {
    const wrapper = render({ id: 'low-hash#0' });
    expect(wrapper.find('tr.selected-utxo').text()).toContain('low-hash#0');
    await rows(wrapper)[0].trigger('click');
    const [row] = wrapper.emitted('row-click')![0];
    expect(row).toMatchObject({ id: 'high-hash#0', lovelace: 3_000_000n, raw: walletStore.utxos[1] });
    expect(row).not.toHaveProperty('internalItem');
    await wrapper.setProps({ selectedUtxo: { id: 'high-hash#0' } });
    expect(wrapper.findAll('tr.selected-utxo')).toHaveLength(1);
    expect(wrapper.find('tr.selected-utxo').text()).toContain('high-hash#0');
  });

  it('filters through the real text field while preserving collateral rendering', async () => {
    const wrapper = render();
    await wrapper.find('input').setValue('low-hash');
    expect(rows(wrapper)).toHaveLength(1);
    expect(rows(wrapper)[0].text()).toContain('low-hash#0');
    expect(rows(wrapper)[0].text()).toContain('transactions.collateral');
  });
});
