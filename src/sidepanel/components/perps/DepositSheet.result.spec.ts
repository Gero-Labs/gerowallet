import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ref } from 'vue';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';

interface DepositMock {
  quote: Ref<unknown>;
  txHash: Ref<string | null>;
  depositStatus: Ref<string>;
  depositError: Ref<string | null>;
  quoteCountdown: Ref<number>;
  adaToUsdRate: Ref<number>;
  submission: Ref<Record<string, unknown> | null>;
  walletKey: Ref<string>;
  requestQuote: ReturnType<typeof vi.fn>;
  buildAndSign: ReturnType<typeof vi.fn>;
  resetDeposit: ReturnType<typeof vi.fn>;
  acknowledgeSubmission: ReturnType<typeof vi.fn>;
}
const state = vi.hoisted(() => ({ deposit: null as unknown as DepositMock }));
vi.mock('@/modules/market/composables/useStrikeDeposit', async () => {
  const { ref } = await import('vue');
  state.deposit = {
    quote: ref(null),
    txHash: ref(null),
    depositStatus: ref('idle'),
    depositError: ref(null),
    quoteCountdown: ref(0),
    adaToUsdRate: ref(0),
    submission: ref(null),
    walletKey: ref('wallet-a'),
    requestQuote: vi.fn(),
    buildAndSign: vi.fn(),
    resetDeposit: vi.fn(),
    acknowledgeSubmission: vi.fn(),
  };
  return { useStrikeDeposit: () => state.deposit, strikeWalletKey: () => state.deposit.walletKey.value };
});
vi.mock('@/modules/market/composables/useStrikeOnboarding', () => ({
  useStrikeOnboarding: () => ({ isConnected: true }),
}));
vi.mock('@/stores/walletStore', () => ({
  walletStore: { utxos: [[{}, { value: { coins: 25_000_000n } }]], loggedWallet: {} },
}));
vi.mock('@/shared/composables/useExplorer', () => ({
  useExplorer: () => ({ explorerUrl: (_kind: string, hash: string | null) => (hash ? `https://explorer.test/tx/${hash}` : '') }),
}));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import DepositSheet from './DepositSheet.vue';

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
  state.deposit.submission.value = null;
  state.deposit.depositStatus.value = 'idle';
  state.deposit.depositError.value = null;
  state.deposit.txHash.value = null;
  state.deposit.quoteCountdown.value = 0;
  state.deposit.walletKey.value = 'wallet-a';
});

function open() {
  return mount(DepositSheet, {
    props: { modelValue: true },
    global: {
      plugins: [createTestVuetify()],
      stubs: { VDialog: { template: '<section><slot /></section>' }, PassKeyAuthButton: true, StrikeOnboarding: true },
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
    },
  });
}

const TX = 'ab'.repeat(32);
const submitted = (patch: Record<string, unknown>) => ({ requestId: 'req-1', lovelace: '100000000', txHash: null, error: null, ...patch });

describe('the Strike deposit sheet shows a submitted deposit until it has been seen', () => {
  it('opens on the amount form when nothing was submitted', () => {
    const sheet = open();
    expect(sheet.find('.af__input').exists()).toBe(true);
    expect(sheet.find('.status-card').exists()).toBe(false);
  });

  it('reopens on a deposit that is still being submitted, with no way to start another', () => {
    state.deposit.submission.value = submitted({ status: 'submitting' });
    const sheet = open();
    expect(sheet.get('.status-title').text()).toBe('perpetuals.deposit.statusSubmitting');
    expect(sheet.find('.af__input').exists()).toBe(false);
    expect(sheet.find('.action-btn').exists()).toBe(false);
  });

  it('reopens on the confirmed deposit and its transaction', () => {
    state.deposit.submission.value = submitted({ status: 'confirmed', txHash: TX });
    const sheet = open();
    expect(sheet.get('.status-title').text()).toBe('perpetuals.depositConfirmed');
    expect(sheet.get('a.tx-link').attributes('href')).toBe(`https://explorer.test/tx/${TX}`);
    expect(sheet.find('.af__input').exists()).toBe(false);
  });

  it('reopens on a submission that could not be confirmed, and clears it only on Retry', async () => {
    state.deposit.submission.value = submitted({ status: 'error', error: 'errors.submitUnconfirmed' });
    const sheet = open();
    expect(sheet.get('.status-title').text()).toBe('perpetuals.deposit.statusError');
    expect(sheet.get('.error-banner').text()).toContain('errors.submitUnconfirmed');
    expect(state.deposit.acknowledgeSubmission).not.toHaveBeenCalled();
    await sheet.get('.action-btn').trigger('click');
    expect(state.deposit.acknowledgeSubmission).toHaveBeenCalledTimes(1);
  });

  it('acknowledges the result on screen when the sheet is closed', async () => {
    state.deposit.submission.value = submitted({ status: 'confirmed', txHash: TX });
    const sheet = open();
    await sheet.setProps({ modelValue: false });
    expect(state.deposit.acknowledgeSubmission).toHaveBeenCalledTimes(1);
  });

  it('returns to the amount form when the wallet changes, showing none of the first wallet’s progress', async () => {
    state.deposit.requestQuote.mockImplementation(async () => { state.deposit.depositStatus.value = 'quoted'; });
    state.deposit.buildAndSign.mockImplementation(() => {
      state.deposit.depositStatus.value = 'building';
      return new Promise(() => {});
    });
    state.deposit.quoteCountdown.value = 60;
    const sheet = open();
    await sheet.get('.af__input').setValue('5');
    await sheet.get('button.action-btn').trigger('click');
    await flushPromises();
    await sheet.get('input[type="password"]').setValue('test-password');
    await sheet.get('button.action-btn').trigger('click');
    await flushPromises();
    expect(sheet.find('.status-card').exists()).toBe(true);

    state.deposit.depositStatus.value = 'idle';
    state.deposit.walletKey.value = 'wallet-b';
    await flushPromises();
    expect(sheet.find('.status-card').exists()).toBe(false);
    expect(sheet.find('.af__input').exists()).toBe(true);
  });
});
