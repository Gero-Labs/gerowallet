// Which UTxOs Quick Send hands to Nexus: never one a submitted transaction already spends.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import type { Cardano } from '@cardano-sdk/core';
import type { TransactionSigningOptions } from '@/shared/composables/useTransactionSigning';
import { WalletType } from '@/models/types';

interface NexusInput { txHash: string; outputIndex: number; address: string; lovelace: string }
interface BuildRequest { outputs: { address: string; lovelace: string }[]; utxos: NexusInput[]; selectAll?: boolean }

const mocks = vi.hoisted(() => ({
  build: vi.fn(), maxAda: vi.fn(), scan: vi.fn(),
  signingOptions: undefined as TransactionSigningOptions | undefined,
}));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive({
  loggedWallet: { id: 1, chain: 'Cardano', network: 'Mainnet', type: 'Normal', baseAddress: 'own-address' },
  utxos: [] as unknown[], transactions: [] as unknown[],
  keys: { payment: [{ address: 'own-address' }], change: [] },
  tokens: { ada: { ticker: 'ADA', name: 'ADA', unit: '', quantity: '500000000', metadata: { ticker: 'ADA', decimals: 6 } } },
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
vi.mock('@/api/nexus-tx-api', async () => {
  const selection = await vi.importActual<typeof import('@/api/nexusInputSelection')>('@/api/nexusInputSelection');
  return {
    nexusTxApi: { buildTransferTx: mocks.build, calculateMaxAda: mocks.maxAda },
    InputLimitError: selection.InputLimitError,
    selectInputCandidates: selection.selectInputCandidates,
    cardanoUtxoToNexusInput: (utxo: Cardano.Utxo): NexusInput => ({
      txHash: utxo[0].txId, outputIndex: utxo[0].index, address: String(utxo[1].address), lovelace: String(utxo[1].value.coins),
    }),
  };
});
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
      isPrfWallet: ref(false), isBTSupported: ref(false), canSignOnAnotherDevice: ref(false), requiresRemoteForSend: ref(false),
      passwordRules: ref([]), overlay: ref(false), keystoneType: ref(''), keystoneCbor: ref(''),
      handleSign: vi.fn(), signOnAnotherDevice: vi.fn(), resetState: vi.fn(),
      handlePassKeySuccess: vi.fn(), handlePassKeyError: vi.fn(), handlePassKeyAuthSuccess: vi.fn(), handlePassKeyAuthError: vi.fn(),
      setPasswordFieldRef: vi.fn(), onKeystoneScan: vi.fn(), onKeystoneError: vi.fn(), onKeystoneProgress: vi.fn(),
    };
  } };
});
vi.mock('@/shared/components/TransactionAuthSection.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/dialogs/KeystoneSignDialog.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./MidnightSendDialog.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/components/CopyButton.vue', () => ({ default: { template: '<button>Copy</button>' } }));
vi.mock('../components/SendRecipientCard.vue', () => ({ default: {
  props: ['recipient'], emits: ['update:recipient', 'setMax'],
  template: `<div>
    <button data-amount @click="$emit('update:recipient', { ...recipient, address: 'external-address', selectedTokens: [{ ...recipient.selectedTokens[0], quantity: '2' }] })">Amount</button>
    <button data-address @click="$emit('update:recipient', { ...recipient, address: 'external-address' })">Address</button>
    <button data-max @click="$emit('setMax', { tokenIndex: 0 })">Max</button>
  </div>`,
} }));

import SendDialog from './SendDialog.vue';
import { walletStore } from '@/stores/walletStore';

const txId = (n: number) => n.toString(16).padStart(64, '0');
const utxo = (n: number, coins: number) => [{ txId: txId(n), index: 0 }, { address: 'own-address', value: { coins } }];
const dialog = () => new DOMWrapper(document.body);
const requests = () => mocks.build.mock.calls.map(([request]) => request as BuildRequest);

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  walletStore.loggedWallet = { ...walletStore.loggedWallet, type: WalletType.Normal };
  walletStore.transactions = [];
  mocks.scan.mockImplementation(() => new Promise(() => {}));
  mocks.build.mockImplementation(async (request: BuildRequest) => ({
    tx_cbor: JSON.stringify({
      id: 'payment',
      body: {
        inputs: request.utxos.map((input) => ({ txId: input.txHash, index: input.outputIndex })),
        outputs: request.outputs.map((output) => ({ address: output.address, value: { coins: output.lovelace } })),
        fee: '200000',
      },
    }),
  }));
});
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

async function openSend() {
  const wrapper = mount(SendDialog, { attachTo: document.body, props: { isOpen: true }, global: {
    plugins: [createTestVuetify()], mocks: { $t: (key: string) => key },
  } });
  await flushPromises();
  return wrapper;
}

describe('Quick Send inputs', () => {
  it('never offers Nexus a UTxO that a submitted transaction already spends', async () => {
    walletStore.utxos = [utxo(1, 5_000_000), utxo(2, 6_000_000), utxo(3, 7_000_000)] as never;
    walletStore.transactions = [{ pending: true, tx_timestamp: Math.floor(Date.now() / 1000), body: { inputs: [{ txId: txId(2), index: 0 }] } }];
    await openSend();
    await dialog().get('[data-amount]').trigger('click');
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    const [request] = requests();
    expect(request.utxos.map((input) => input.txHash)).toEqual([txId(1), txId(3)]);
  });
});
