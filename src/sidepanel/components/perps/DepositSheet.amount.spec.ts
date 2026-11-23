import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';

const api = vi.hoisted(() => ({ quote: vi.fn() }));
vi.mock('@/api/strike-v2.user', () => ({ strikeUserApi: { getDepositQuote: api.quote } }));
vi.mock('@/api/strike-v2.client', () => ({ hasStrikeApiKeys: () => true }));
vi.mock('@/modules/market/composables/useStrikeOnboarding', () => ({
  useStrikeOnboarding: () => ({ isConnected: true }),
}));
vi.mock('@/stores/walletStore', () => ({ walletStore: { utxos: [], loggedWallet: {} } }));
vi.mock('@/stores/priceStore', () => ({ priceStore: {} }));
vi.mock('@/shared/composables/useExplorer', () => ({ useExplorer: () => ({ explorerUrl: () => '' }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import DepositSheet from './DepositSheet.vue';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);
beforeEach(() => {
  api.quote.mockReset();
  api.quote.mockResolvedValue({
    request_id: 'review', deposit_address: 'deposit-address',
    quote: { asset_amount: '1000001', expiration_at: Math.floor(Date.now() / 1000) + 60 },
  });
});

function openSheet(lovelace: bigint) {
  Object.assign(walletStore, { utxos: [[{}, { value: { coins: lovelace } }]] });
  return mount(DepositSheet, {
    props: { modelValue: true },
    global: {
      plugins: [createTestVuetify()],
      stubs: { VDialog: { template: '<section><slot /></section>' }, PassKeyAuthButton: true, StrikeOnboarding: true },
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
    },
  });
}

describe('Strike deposit amount entry', () => {
  it('quotes Max at the spendable amount when rounding to two decimals would exceed the balance', async () => {
    const sheet = openSheet(18_015_872n);
    await sheet.get('.af__max').trigger('click');
    expect(sheet.get('input').element.value).toBe('16.015872');
    const next = sheet.get('button.action-btn');
    expect(next.attributes('disabled')).toBeUndefined();
    await next.trigger('click');
    await flushPromises();
    expect(api.quote).toHaveBeenCalledExactlyOnceWith({ blockchain: 'cardano', asset_symbol: 'ADA', asset_amount: '16015872' });
  });

  it('sends the exact lovelace the user typed and disables amounts below one lovelace', async () => {
    const sheet = openSheet(4_000_000n);
    await sheet.get('input').setValue('0.0000001');
    expect(sheet.get('button.action-btn').attributes('disabled')).toBeDefined();
    await sheet.get('input').setValue('1.000001');
    await sheet.get('button.action-btn').trigger('click');
    await flushPromises();
    expect(api.quote).toHaveBeenCalledExactlyOnceWith({ blockchain: 'cardano', asset_symbol: 'ADA', asset_amount: '1000001' });
  });
});
