import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';

const api = vi.hoisted(() => ({ quote: vi.fn(), withdraw: vi.fn() }));
vi.mock('@/api/strike-v2.user', () => ({ strikeUserApi: { getDepositQuote: api.quote, getWithdrawQuote: api.withdraw } }));
vi.mock('@/api/strike-v2.client', () => ({ hasStrikeApiKeys: () => true }));
vi.mock('@/modules/market/composables/useStrikeOnboarding', () => ({
  useStrikeOnboarding: () => ({ isConnected: true }),
}));
vi.mock('@/stores/walletStore', () => ({ walletStore: { utxos: [], loggedWallet: {} } }));
vi.mock('@/stores/priceStore', () => ({ priceStore: {} }));
vi.mock('@/modules/market/composables/useStrikeAccount', async () => {
  const { ref } = await import('vue');
  return {
    useStrikeAccount: () => ({
      account: ref({ available_balance: '28.0199' }),
      marginRatio: ref(0),
      loadAccount: vi.fn().mockResolvedValue(undefined),
    }),
  };
});
vi.mock('@/shared/composables/useExplorer', () => ({ useExplorer: () => ({ explorerUrl: () => '' }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import DepositSheet from './DepositSheet.vue';
import WithdrawSheet from './WithdrawSheet.vue';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);
beforeEach(() => {
  api.quote.mockReset();
  api.withdraw.mockReset();
  api.withdraw.mockResolvedValue({ withdraw_id: 'withdraw', message_to_sign: '74657374' });
  api.quote.mockResolvedValue({
    request_id: 'review', deposit_address: 'deposit-address',
    quote: { asset_amount: '1000001', expiration_at: Math.floor(Date.now() / 1000) + 60 },
  });
});

function sheetOptions() {
  return {
    props: { modelValue: true },
    global: {
      plugins: [createTestVuetify()],
      stubs: { VDialog: { template: '<section><slot /></section>' }, PassKeyAuthButton: true, StrikeOnboarding: true },
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
    },
  };
}

function openSheet(lovelace: bigint) {
  Object.assign(walletStore, { utxos: [[{}, { value: { coins: lovelace } }]] });
  return mount(DepositSheet, sheetOptions());
}

describe('Strike deposit amount entry', () => {
  it('quotes a decimal comma as a fraction of ADA', async () => {
    const sheet = openSheet(25_000_000n);
    await sheet.get('input').setValue('1,5');
    await sheet.get('button.action-btn').trigger('click');
    await flushPromises();
    expect(api.quote).toHaveBeenCalledExactlyOnceWith({ blockchain: 'cardano', asset_symbol: 'ADA', asset_amount: '1500000' });
  });

  it.each(['1.0000019', '1,2.3', '-1', '1e2'])('keeps an invalid deposit from requesting a quote for %s', async (text) => {
    const sheet = openSheet(30_000_000n);
    await sheet.get('input').setValue(text);
    expect(sheet.get('button.action-btn').attributes('disabled')).toBeDefined();
    await sheet.get('input').trigger('keydown.enter');
    expect(api.quote).not.toHaveBeenCalled();
  });
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

describe('Strike withdrawal amount entry', () => {
  beforeEach(() => { Object.assign(walletStore, { loggedWallet: { id: 1, baseAddress: 'test-address' } }); });

  it('rounds the withdrawable balance down to spendable cents for Max', async () => {
    const sheet = mount(WithdrawSheet, sheetOptions());
    await sheet.get('.af__max').trigger('click');
    expect(sheet.get('input').element.value).toBe('28.01');
    await sheet.get('button.action-btn').trigger('click');
    await flushPromises();
    expect(api.withdraw).toHaveBeenCalledExactlyOnceWith({ blockchain: 'cardano', asset: 'USDM', usd_value: '28.01' });
  });

  it('keeps the decimal comma and refuses partial cents or malformed input', async () => {
    const sheet = mount(WithdrawSheet, sheetOptions());
    for (const text of ['1.015', '1,2.3', '-1', '1e2']) {
      await sheet.get('input').setValue(text);
      expect(sheet.get('button.action-btn').attributes('disabled'), text).toBeDefined();
      await sheet.get('input').trigger('keydown.enter');
    }
    expect(api.withdraw).not.toHaveBeenCalled();
    await sheet.get('input').setValue('1,5');
    await sheet.get('input').trigger('keydown.enter');
    await flushPromises();
    expect(api.withdraw).toHaveBeenCalledExactlyOnceWith({ blockchain: 'cardano', asset: 'USDM', usd_value: '1.50' });
  });
});
