import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ref } from 'vue';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';

interface WithdrawMock {
  quote: Ref<unknown>;
  withdrawStatus: Ref<string>;
  withdrawError: Ref<string | null>;
  submission: Ref<Record<string, unknown> | null>;
  requestQuote: ReturnType<typeof vi.fn>;
  signAndSubmit: ReturnType<typeof vi.fn>;
  resetWithdraw: ReturnType<typeof vi.fn>;
  acknowledgeSubmission: ReturnType<typeof vi.fn>;
}
const state = vi.hoisted(() => ({ withdraw: null as unknown as WithdrawMock }));
vi.mock('@/modules/market/composables/useStrikeWithdraw', async () => {
  const { ref } = await import('vue');
  state.withdraw = {
    quote: ref(null),
    withdrawStatus: ref('idle'),
    withdrawError: ref(null),
    submission: ref(null),
    requestQuote: vi.fn(),
    signAndSubmit: vi.fn(),
    resetWithdraw: vi.fn(),
    acknowledgeSubmission: vi.fn(),
  };
  return { useStrikeWithdraw: () => state.withdraw, decodeWithdrawMessageForDisplay: (message: string) => message };
});
vi.mock('@/modules/market/composables/useStrikeOnboarding', () => ({
  useStrikeOnboarding: () => ({ isConnected: true }),
}));
vi.mock('@/modules/market/composables/useStrikeAccount', async () => {
  const { ref } = await import('vue');
  return {
    useStrikeAccount: () => ({
      account: ref({ available_balance: '28.00' }),
      marginRatio: ref(0),
      loadAccount: vi.fn().mockResolvedValue(undefined),
    }),
  };
});
vi.mock('@/stores/walletStore', () => ({ walletStore: { utxos: [], loggedWallet: { id: 1, baseAddress: 'test-address' } } }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));

import WithdrawSheet from './WithdrawSheet.vue';

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
  state.withdraw.submission.value = null;
  state.withdraw.withdrawStatus.value = 'idle';
  state.withdraw.withdrawError.value = null;
  state.withdraw.quote.value = null;
});

function open() {
  return mount(WithdrawSheet, {
    props: { modelValue: true },
    global: {
      plugins: [createTestVuetify()],
      stubs: { VDialog: { template: '<section><slot /></section>' }, PassKeyAuthButton: true, StrikeOnboarding: true },
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
    },
  });
}

const submitted = (patch: Record<string, unknown>) => ({ withdrawId: 'first', usd: '8.00', requestId: null, error: null, ...patch });

describe('the Strike withdrawal sheet shows a submitted withdrawal until it has been seen', () => {
  it('opens on the amount form when nothing was submitted', () => {
    const sheet = open();
    expect(sheet.find('.af__input').exists()).toBe(true);
    expect(sheet.find('.status-pane').exists()).toBe(false);
  });

  it('reopens on a withdrawal that is still being submitted, with no way to start another', () => {
    state.withdraw.submission.value = submitted({ status: 'submitting' });
    const sheet = open();
    expect(sheet.get('.status-title').text()).toBe('perps.withdraw.statusSubmitting');
    expect(sheet.find('.af__input').exists()).toBe(false);
    expect(sheet.find('.action-btn').exists()).toBe(false);
  });

  it('reopens on the accepted withdrawal and acknowledges it once the sheet is closed', async () => {
    state.withdraw.submission.value = submitted({ status: 'settled', requestId: 'receipt' });
    const sheet = open();
    expect(sheet.get('.status-title').text()).toBe('perps.withdraw.statusSettled');
    expect(sheet.find('.af__input').exists()).toBe(false);
    expect(state.withdraw.acknowledgeSubmission).not.toHaveBeenCalled();
    await sheet.get('.action-btn').trigger('click');
    expect(sheet.emitted('update:modelValue')).toEqual([[false]]);
    await sheet.setProps({ modelValue: false });
    expect(state.withdraw.acknowledgeSubmission).toHaveBeenCalledTimes(1);
  });

  it('reopens on a failed submission and clears it only on Retry', async () => {
    state.withdraw.submission.value = submitted({ status: 'error', error: 'Network Error' });
    const sheet = open();
    expect(sheet.get('.status-title').text()).toBe('perps.withdraw.statusError');
    expect(sheet.get('.error-banner').text()).toContain('Network Error');
    expect(state.withdraw.acknowledgeSubmission).not.toHaveBeenCalled();
    await sheet.get('.action-btn').trigger('click');
    expect(state.withdraw.acknowledgeSubmission).toHaveBeenCalledTimes(1);
  });

  it('does not acknowledge anything when it opens', async () => {
    state.withdraw.submission.value = submitted({ status: 'settled', requestId: 'receipt' });
    const sheet = mount(WithdrawSheet, {
      props: { modelValue: false },
      global: {
        plugins: [createTestVuetify()],
        stubs: { VDialog: { template: '<section><slot /></section>' }, PassKeyAuthButton: true, StrikeOnboarding: true },
        config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
      },
    });
    await sheet.setProps({ modelValue: true });
    expect(state.withdraw.acknowledgeSubmission).not.toHaveBeenCalled();
  });
});
