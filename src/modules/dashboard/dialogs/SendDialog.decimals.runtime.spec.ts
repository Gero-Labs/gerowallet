// Quick Send converts a typed token amount with the decimals gero-backend confirms, and builds
// nothing when it cannot: the decimals the wallet holds come from gero-sync, which is not
// authenticated. gero-backend's asset info is stubbed at the Api client; the check is real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import type { Cardano } from '@cardano-sdk/core';

interface BuildRequest {
  outputs: { address: string; lovelace: string; assets?: { policyId: string; assetName: string; quantity: string }[] }[];
}

const mocks = vi.hoisted(() => ({
  build: vi.fn(), scan: vi.fn(), getAssetsInfo: vi.fn(),
  // A 6-decimal token as gero-sync delivered it.
  token: { unit: `${'cd'.repeat(28)}544b4e`, ticker: 'TKN', decimals: 6 },
}));
vi.mock('@/api/api', () => ({ Api: class { getAssetsInfo(units: string[]) { return mocks.getAssetsInfo(units); } } }));
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
vi.mock('@/utils/networks', () => ({ default: { resolveCurrencyTicker: () => 'ADA', resolveDefaultProvider: () => 1 } }));
vi.mock('@/utils/assets', () => ({ default: { sendSvg: '' } }));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('@/utils/rules', () => ({ default: { recipientRules: () => () => true } }));
vi.mock('@/shared/utils/filters', () => ({ default: { toCurrency: (value: number) => String(value / 1_000_000) } }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key, tc: (key: string) => key }) }));
vi.mock('@/shared/composables/useQuickActionDialogs', () => ({ useQuickActionDialogs: () => ({ openReceiveDialog: vi.fn() }) }));
vi.mock('@/shared/composables/useTransactionSigning', async () => {
  const { ref } = await import('vue');
  return { useTransactionSigning: () => ({
    loading: ref(false), spendingPassword: ref(''), isSubmit: ref(false), isBT: ref(false),
    isPrfWallet: ref(true), isBTSupported: ref(false), canSignOnAnotherDevice: ref(true), requiresRemoteForSend: ref(false),
    passwordRules: ref([]), overlay: ref(false), keystoneType: ref(''), keystoneCbor: ref(''),
    handleSign: vi.fn(), signOnAnotherDevice: vi.fn(), resetState: vi.fn(),
    handlePassKeySuccess: vi.fn(), handlePassKeyError: vi.fn(), handlePassKeyAuthSuccess: vi.fn(), handlePassKeyAuthError: vi.fn(),
    setPasswordFieldRef: vi.fn(), onKeystoneScan: vi.fn(), onKeystoneError: vi.fn(), onKeystoneProgress: vi.fn(),
  }) };
});
vi.mock('@/shared/components/TransactionAuthSection.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/dialogs/KeystoneSignDialog.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./MidnightSendDialog.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/components/CopyButton.vue', () => ({ default: { template: '<button>Copy</button>' } }));
// The card hands back 2 ADA and 1.5 of the token, typed by the user.
vi.mock('../components/SendRecipientCard.vue', () => ({ default: {
  props: ['recipient'], emits: ['update:recipient'],
  data: () => ({ token: mocks.token }),
  template: `<button data-recipient @click="$emit('update:recipient', { ...recipient, address: 'external-address',
    selectedTokens: [{ ...recipient.selectedTokens[0], quantity: '2' }, { ...token, quantity: '1.5' }] })">Amounts</button>`,
} }));

import SendDialog from './SendDialog.vue';
import i18n from '@/plugins/i18n';
import { clearConfirmedDecimals } from '@/shared/utils/verifiedDecimals';

const TOKEN = mocks.token.unit;
const dialog = () => new DOMWrapper(document.body);
const requests = () => mocks.build.mock.calls.map(([request]) => request as BuildRequest);
/** gero-backend answers for the token with this registry entry (null: none, which states 0 decimals). */
const backendStates = (metadata: Record<string, unknown> | null) =>
  mocks.getAssetsInfo.mockImplementation(async (units: string[]) => ({ status: 200, data: units.filter((u) => u === TOKEN).map((asset) => ({ asset, metadata })) }));

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  clearConfirmedDecimals();
  backendStates({ ticker: 'TKN', decimals: 6 });
  mocks.scan.mockImplementation(() => new Promise(() => {}));
  mocks.build.mockImplementation(async (request: BuildRequest) => ({
    tx_cbor: JSON.stringify({ body: { outputs: request.outputs.map(output => ({ address: output.address, value: { coins: output.lovelace } })), fee: '310525' } }),
  }));
});
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

async function typeAmounts() {
  mount(SendDialog, { attachTo: document.body, props: { isOpen: true }, global: {
    plugins: [createTestVuetify()], mocks: { $t: (key: string) => key },
  } });
  await flushPromises();
  await dialog().get('[data-recipient]').trigger('click');
  await vi.advanceTimersByTimeAsync(500);
  await flushPromises();
}

describe('Quick Send token decimals', () => {
  it('builds the token amount with the decimals gero-backend confirms', async () => {
    await typeAmounts();
    expect(mocks.getAssetsInfo).toHaveBeenCalledWith([TOKEN]);
    const [request] = requests();
    expect(request.outputs[0].lovelace).toBe('2000000');
    expect(request.outputs[0].assets).toEqual([{ policyId: TOKEN.slice(0, 56), assetName: TOKEN.slice(56), quantity: '1500000' }]);
  });

  it('builds nothing when gero-backend states other decimals', async () => {
    // A token with no decimals: with gero-sync's 6, "1.5" would send 1,500,000 of it.
    backendStates(null);
    await typeAmounts();
    expect(mocks.build).not.toHaveBeenCalled();
    expect(dialog().text()).toContain(String(i18n.t('txGuard.tokenDecimalsMismatch')));
  });

  it('builds nothing when gero-backend cannot answer', async () => {
    mocks.getAssetsInfo.mockRejectedValue(new Error('Network Error'));
    await typeAmounts();
    expect(mocks.build).not.toHaveBeenCalled();
    expect(dialog().text()).toContain(String(i18n.t('txGuard.tokenDecimalsUnverified')));
  });
});
