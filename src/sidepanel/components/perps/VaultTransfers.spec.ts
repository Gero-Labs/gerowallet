import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';

const calls = vi.hoisted(() => ({ deposit: vi.fn(), withdraw: vi.fn(), detail: vi.fn() }));
vi.mock('@/modules/market/composables/useStrikeDeposit', () => ({ useStrikeDeposit: calls.deposit }));
vi.mock('@/modules/market/composables/useStrikeWithdraw', () => ({ useStrikeWithdraw: calls.withdraw }));
vi.mock('@/modules/market/composables/useStrikeVaults', () => ({ useStrikeVaults: () => ({
  getVaultDetail: calls.detail, getVaultPortfolio: async () => ({ history: [] }),
  getVaultDepositors: async () => [], getUserPosition: async () => null,
}) }));
vi.mock('../../composables/useChainContext', () => ({ useChainContext: () => ({ themeColors: { value: { primary: 'teal' } } }) }));

import VaultDetailSheet from './VaultDetailSheet.vue';

const global = () => ({
  plugins: [createTestVuetify()],
  stubs: {
    BottomSheet: { template: '<section><slot /><button data-close @click="$emit(\'update:modelValue\', false)">close</button></section>' },
    VaultPortfolioChart: true,
  },
  config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
});
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
  calls.deposit.mockImplementation(() => { throw new Error('Vault UI must not initialize account funding'); });
  calls.withdraw.mockImplementation(() => { throw new Error('Vault UI must not initialize account withdrawal'); });
});

describe('unsupported vault transfers fail closed', () => {
  it('disables vault detail actions while keeping vault data visible', async () => {
    calls.detail.mockResolvedValue({ id: 'vault-a', name: 'Vault A', pnl: '0', apr: '1', tvl: '100', sharpe_ratio: '1', max_drawdown: '0', depositor_count: 1 });
    const wrapper = mount(VaultDetailSheet, { props: { modelValue: false, vaultId: 'vault-a' }, global: global() });
    await wrapper.setProps({ modelValue: true });
    await flushPromises();
    expect(wrapper.text()).toContain('Vault A');
    expect(wrapper.get('[role="status"]').text()).toBe('vaults.transfersUnavailable');
    for (const action of wrapper.findAll('.vds-actions button')) {
      expect(action.attributes()).toHaveProperty('disabled');
      await action.trigger('click');
    }
    expect(wrapper.findAll('.vds-actions button')).toHaveLength(2);
    expect(wrapper.emitted('deposit')).toBeUndefined();
    expect(wrapper.emitted('withdraw')).toBeUndefined();
    expect(calls.deposit).not.toHaveBeenCalled();
    expect(calls.withdraw).not.toHaveBeenCalled();
  });
});
