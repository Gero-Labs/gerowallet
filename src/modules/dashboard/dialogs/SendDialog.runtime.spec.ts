import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import type { Cardano } from '@cardano-sdk/core';
import type { TransactionSigningOptions } from '@/shared/composables/useTransactionSigning';

const mocks = vi.hoisted(() => ({
  build: vi.fn(), scan: vi.fn(), sign: vi.fn(),
  signingOptions: undefined as TransactionSigningOptions | undefined,
}));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive({
  loggedWallet: { id: 1, chain: 'Cardano', network: 'Mainnet', type: 0, baseAddress: 'own-address' },
  utxos: [], keys: { payment: [{ address: 'own-address' }], change: [] },
  tokens: { ada: { ticker: 'ADA', name: 'ADA', unit: '', quantity: '100000000', metadata: { ticker: 'ADA', decimals: 6 } } },
  collections: {}, config: {}, isLocked: false,
}) }));
vi.mock('@/stores/networkStore', async () => ({ networkStore: (await import('vue')).reactive({ epochParams: null }) }));
vi.mock('@/stores/priceStore', () => ({ priceStore: { adaUsd: { lastPrice: 1 } } }));
vi.mock('@/stores/loading', () => ({ loadingState: {} }));
vi.mock('@/api/cardano-shield-api', () => ({ default: { scanTx: mocks.scan } }));
vi.mock('@/chrome/cardanoJsSdkCbor', () => ({
  serializeCardanoJsSdkTx: (tx: Cardano.Tx) => JSON.stringify(tx, (_, value) => typeof value === 'bigint' ? String(value) : value),
  BrowserTxConstruction: {},
}));
vi.mock('@cardano-sdk/core', () => ({ Serialization: { Transaction: { fromCbor: (cbor: string) => ({ toCore: () => JSON.parse(cbor) }) } } }));
vi.mock('@cardano-sdk/util', () => ({ HexBlob: (value: string) => value }));
vi.mock('@/chrome/serialization', () => ({ isPaymentAddress: (value: string) => !!value }));
vi.mock('@/api/nexus-tx-api', () => ({
  nexusTxApi: { buildTransferTx: mocks.build }, InputLimitError: class extends Error {},
  selectInputCandidates: () => ({ utxos: [], truncated: false }), cardanoUtxoToNexusInput: (value: unknown) => value,
}));
vi.mock('@/shared/utils/autoWithdraw', () => ({ currentRewardWithdrawals: () => undefined, clearWithdrawableAmount: vi.fn() }));
vi.mock('@/utils/networks', () => ({ default: { resolveCurrencyTicker: () => 'ADA' } }));
vi.mock('@/utils/assets', () => ({ default: { sendSvg: '' } }));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('@/utils/rules', () => ({ default: { recipientRules: () => () => true } }));
vi.mock('@/shared/utils/filters', () => ({ default: { toCurrency: (value: number) => String(value / 1_000_000) } }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key, tc: (key: string) => key }) }));
vi.mock('@/shared/composables/useQuickActionDialogs', () => ({ useQuickActionDialogs: () => ({ openReceiveDialog: vi.fn() }) }));
vi.mock('@/shared/composables/useTransactionSigning', async () => {
  const { ref } = await import('vue');
  return { useTransactionSigning: (options: TransactionSigningOptions) => {
    mocks.signingOptions = options;
    return {
      loading: ref(false), spendingPassword: ref(''), isSubmit: ref(false), isBT: ref(false),
      isPrfWallet: ref(true), isBTSupported: ref(false), canSignOnAnotherDevice: ref(true), requiresRemoteForSend: ref(false),
      passwordRules: ref([]), overlay: ref(false), keystoneType: ref(''), keystoneCbor: ref(''),
      handleSign: mocks.sign, signOnAnotherDevice: mocks.sign, resetState: vi.fn(),
      handlePassKeySuccess: vi.fn(), handlePassKeyError: vi.fn(), handlePassKeyAuthSuccess: vi.fn(), handlePassKeyAuthError: vi.fn(),
      setPasswordFieldRef: vi.fn(), onKeystoneScan: vi.fn(), onKeystoneError: vi.fn(), onKeystoneProgress: vi.fn(),
    };
  } };
});
vi.mock('@/shared/components/TransactionAuthSection.vue', () => ({ default: {
  props: ['loading'], template: '<button data-auth :disabled="loading">Synthetic authentication</button>',
} }));
vi.mock('@/shared/dialogs/KeystoneSignDialog.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./MidnightSendDialog.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../components/SendRecipientCard.vue', () => ({ default: {
  props: ['recipient'], emits: ['update:recipient'],
  template: `<button data-recipient @click="$emit('update:recipient', { ...recipient, address: 'external-address', selectedTokens: [{ ...recipient.selectedTokens[0], quantity: String(Number(recipient.selectedTokens[0].quantity) + 10) }] })">Add synthetic amount</button>`,
} }));
vi.mock('@/shared/components/CopyButton.vue', () => ({ default: { template: '<button>Copy</button>' } }));

import SendDialog from './SendDialog.vue';
import SummaryStep from '../components/SummaryStep.vue';

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.scan.mockImplementation(() => new Promise(() => {}));
  mocks.build.mockImplementation(async (request: { outputs: { address: string; lovelace: string }[] }) => ({
    tx_cbor: JSON.stringify({ body: { outputs: request.outputs.map(output => ({ address: output.address, value: { coins: output.lovelace } })), fee: '310525' } }),
  }));
});
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

const dialog = () => new DOMWrapper(document.body);
async function readySend() {
  const wrapper = mount(SendDialog, { attachTo: document.body, props: { isOpen: true }, global: {
    plugins: [createTestVuetify()], mocks: { $t: (key: string) => key },
  } });
  await flushPromises();
  await dialog().get('[data-recipient]').trigger('click');
  await vi.advanceTimersByTimeAsync(500);
  await flushPromises();
  return wrapper;
}

describe('Quick Send review integration', () => {
  it('renders the first summary before allowing authentication and disables approval on Back/close', async () => {
    const wrapper = await readySend();
    expect(wrapper.findComponent(SummaryStep).exists()).toBe(false);
    expect(mocks.signingOptions?.active?.()).toBe(false);
    await dialog().get('.continue-button').trigger('click');
    await flushPromises();
    const summary = wrapper.getComponent(SummaryStep);
    expect(summary.get('.tx-details').isVisible()).toBe(true);
    expect(summary.text()).toContain('10.310525');
    expect(dialog().get('[data-auth]').attributes('disabled')).toBeUndefined();
    expect(mocks.signingOptions?.active?.()).toBe(true);
    const back = dialog().findAll('button').find(button => button.text().includes('common.back'))!;
    await back.trigger('click');
    expect(mocks.signingOptions?.active?.()).toBe(false);
    await dialog().get('.continue-button').trigger('click');
    await flushPromises();
    expect(mocks.signingOptions?.active?.()).toBe(true);
    await wrapper.setProps({ isOpen: false });
    expect(mocks.signingOptions?.active?.()).toBe(false);
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it('blocks Continue during a replacement build instead of reviewing the previous transaction', async () => {
    const wrapper = await readySend();
    expect(dialog().get('.continue-button').attributes('disabled')).toBeUndefined();
    let finish!: () => void;
    mocks.build.mockImplementationOnce((request: { outputs: { address: string; lovelace: string }[] }) => new Promise(resolve => {
      finish = () => resolve({ tx_cbor: JSON.stringify({ body: { outputs: request.outputs.map(output => ({ address: output.address, value: { coins: output.lovelace } })), fee: '400000' } }) });
    }));
    await dialog().get('[data-recipient]').trigger('click');
    expect(dialog().get('.continue-button').attributes('disabled')).toBeDefined();
    await vi.advanceTimersByTimeAsync(500);
    expect(dialog().get('.continue-button').attributes('disabled')).toBeDefined();
    expect(mocks.signingOptions?.active?.()).toBe(false);
    finish();
    await flushPromises();
    await dialog().get('.continue-button').trigger('click');
    await flushPromises();
    expect(wrapper.getComponent(SummaryStep).text()).toContain('20.4');
    expect(mocks.signingOptions?.active?.()).toBe(true);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
