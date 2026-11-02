// Which UTxOs Quick Send hands to Nexus: never one a submitted transaction already spends.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import type { Cardano } from '@cardano-sdk/core';
import type { TransactionSigningOptions } from '@/shared/composables/useTransactionSigning';
import { WalletType } from '@/models/types';

interface NexusInput { txHash: string; outputIndex: number; address: string; lovelace: string }
interface BuildRequest {
  outputs: { address: string; lovelace: string; assets?: { policyId: string; assetName: string; quantity: string }[] }[];
  utxos: NexusInput[];
  selectAll?: boolean;
}

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
  props: ['recipient'], emits: ['update:recipient', 'setMax', 'sendEntireWallet'],
  template: `<div>
    <button data-amount @click="$emit('update:recipient', { ...recipient, address: 'external-address', selectedTokens: [{ ...recipient.selectedTokens[0], quantity: '2' }] })">Amount</button>
    <button data-address @click="$emit('update:recipient', { ...recipient, address: 'external-address' })">Address</button>
    <button data-max @click="$emit('setMax', { tokenIndex: 0 })">Max</button>
    <button data-entire @click="$emit('sendEntireWallet')">Entire</button>
    <span data-collectibles>{{ Object.keys(recipient.selectedCollectibles).length }}</span>
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

describe('Quick Send Max over the request limit', () => {
  // 205 UTxOs of about 1 ADA: five more than one Nexus request may carry.
  const fragmented = () => Array.from({ length: 205 }, (_, n) => utxo(n, 1_000_000 + n));
  const isMerge = (request: BuildRequest) => request.outputs.length === 1 && request.outputs[0].address === 'own-address';

  /** What Nexus answers: a merge pays its whole batch less the fee to its one output; a payment echoes its outputs. */
  const buildResponse = (request: BuildRequest) => {
    const merge = isMerge(request);
    const total = request.utxos.reduce((sum, input) => sum + Number(input.lovelace), 0);
    return { tx_cbor: JSON.stringify({
      id: merge ? `merge-${request.utxos[0].txHash.slice(-4)}` : 'payment',
      body: {
        inputs: request.utxos.map((input) => ({ txId: input.txHash, index: input.outputIndex })),
        outputs: request.outputs.map((output) => ({ address: output.address, value: { coins: String(merge ? total - 200_000 : output.lovelace) } })),
        fee: '200000',
      },
    }) };
  };

  beforeEach(() => {
    walletStore.utxos = fragmented() as never;
    mocks.maxAda.mockResolvedValue({ max_lovelace: '204000000', estimated_fee: '400000', change_min_utxo: '0', total_balance: '205020910' });
    mocks.build.mockImplementation(async (request: BuildRequest) => buildResponse(request));
  });

  async function pressMax() {
    await openSend();
    await dialog().get('[data-address]').trigger('click');
    await vi.advanceTimersByTimeAsync(500);
    await dialog().get('[data-max]').trigger('click');
    await flushPromises();
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
  }

  it('merges the smallest UTxOs first so one payment spends the whole wallet', async () => {
    await pressMax();
    const merges = requests().filter(isMerge);
    expect(merges).toHaveLength(1);
    expect(merges[0].selectAll).toBe(true);
    expect(merges[0].utxos.map((input) => input.txHash)).toEqual([0, 1, 2, 3, 4, 5].map(txId));

    const [maxRequest] = mocks.maxAda.mock.calls.at(-1)! as [BuildRequest];
    expect(maxRequest.utxos).toHaveLength(200);
    expect(maxRequest.utxos.map((input) => input.txHash)).toContain('merge-0000');

    expect(mocks.signingOptions?.prerequisites?.value?.cbors.map((cbor) => JSON.parse(cbor).id)).toEqual(['merge-0000']);
    expect(dialog().text()).toContain('send.sweepPlanNote');
    // The fee row is the merge's fee plus the payment's.
    expect(dialog().get('.global-total__fee').text()).toBe('- 0.4');
  });

  it('keeps a hardware wallet on its 200 largest UTxOs and says so', async () => {
    walletStore.loggedWallet = { ...walletStore.loggedWallet, type: WalletType.Ledger };
    await pressMax();
    expect(requests().some(isMerge)).toBe(false);
    const [maxRequest] = mocks.maxAda.mock.calls.at(-1)! as [BuildRequest];
    expect(maxRequest.utxos).toHaveLength(200);
    expect(mocks.signingOptions?.prerequisites?.value).toBeNull();
    expect(dialog().text()).toContain('send.inputLimitMaxNote');
  });

  async function settle() {
    await flushPromises();
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  }

  it('builds the merges once when Max is pressed twice', async () => {
    await openSend();
    await dialog().get('[data-address]').trigger('click');
    await vi.advanceTimersByTimeAsync(500);
    await Promise.all([dialog().get('[data-max]').trigger('click'), dialog().get('[data-max]').trigger('click')]);
    await settle();
    expect(requests().filter(isMerge)).toHaveLength(1);
    expect(mocks.signingOptions?.prerequisites?.value?.cbors).toHaveLength(1);
  });

  it('reuses the merges for the same UTxO set', async () => {
    await pressMax();
    expect(requests().filter(isMerge)).toHaveLength(1);
    // Any change to the recipient rebuilds the payment; the merges stay as they are.
    await dialog().get('[data-address]').trigger('click');
    await settle();
    expect(requests().filter(isMerge)).toHaveLength(1);
    expect(requests().filter((request) => !isMerge(request)).length).toBeGreaterThan(1);
    expect(mocks.signingOptions?.prerequisites?.value?.cbors.map((cbor) => JSON.parse(cbor).id)).toEqual(['merge-0000']);
  });

  it('drops the sweep when the amount is typed by hand', async () => {
    await pressMax();
    expect(dialog().text()).toContain('send.sweepPlanNote');
    await dialog().get('[data-amount]').trigger('click');
    await settle();
    expect(mocks.signingOptions?.prerequisites?.value).toBeNull();
    expect(dialog().text()).not.toContain('send.sweepPlanNote');
    const [request] = requests().slice(-1);
    expect(isMerge(request)).toBe(false);
    expect(request.utxos).toHaveLength(200);
  });

  it('shows the error when a merge cannot be built, and recovers on the next Max', async () => {
    // The merge is the first build of a Max; the payment path keeps the default implementation.
    mocks.build.mockRejectedValueOnce(new Error('nexus down'));
    await pressMax();
    expect(dialog().get('.global-total__error').text()).toContain('nexus down');
    expect(mocks.signingOptions?.prerequisites?.value).toBeNull();
    expect(mocks.maxAda).not.toHaveBeenCalled();

    await dialog().get('[data-max]').trigger('click');
    await settle();
    expect(dialog().find('.global-total__error').exists()).toBe(false);
    expect(requests().filter(isMerge)).toHaveLength(2);
    expect(mocks.signingOptions?.prerequisites?.value?.cbors.map((cbor) => JSON.parse(cbor).id)).toEqual(['merge-0000']);
    expect(dialog().text()).toContain('send.sweepPlanNote');
  });

  it('ignores Send entire wallet while a Max is running', async () => {
    // One token holder beside the ADA-only UTxOs: a rewrite would move its token onto the recipient.
    const unit = 'a'.repeat(56) + '746f6b656e';
    walletStore.utxos = [...fragmented(), [{ txId: txId(999), index: 0 }, { address: 'own-address', value: { coins: 2_000_000, assets: { [unit]: 1 } } }]] as never;
    await openSend();
    await dialog().get('[data-address]').trigger('click');
    await vi.advanceTimersByTimeAsync(500);
    await Promise.all([dialog().get('[data-max]').trigger('click'), dialog().get('[data-entire]').trigger('click')]);
    await settle();
    // The recipient still holds only ADA, and no payment Nexus was asked for carries the token.
    expect(dialog().get('[data-collectibles]').text()).toBe('0');
    expect(requests().filter(isMerge)).toHaveLength(1);
    const payments = requests().filter((request) => !isMerge(request));
    expect(payments.length).toBeGreaterThan(0);
    expect(payments.every((request) => request.outputs.every((output) => !output.assets?.length))).toBe(true);
    expect(mocks.maxAda).toHaveBeenCalledTimes(1);
  });

  it('the previous payment is not signable while the merges are rebuilt', async () => {
    // Max-ada first answers 0, so that Max schedules a plain rebuild instead of building: the one
    // way into runBuild that raises no shimmer. A second Max then builds a payment from the
    // current merges before that rebuild fires.
    mocks.maxAda.mockResolvedValueOnce({ max_lovelace: '0', estimated_fee: '0', change_min_utxo: '0', total_balance: '205020910' });
    await openSend();
    await dialog().get('[data-address]').trigger('click');
    await vi.advanceTimersByTimeAsync(500);
    await dialog().get('[data-max]').trigger('click');
    await flushPromises();
    await dialog().get('[data-max]').trigger('click');
    await flushPromises();
    expect(dialog().get('.continue-button').attributes('disabled')).toBeUndefined();
    expect(mocks.signingOptions?.prerequisites?.value?.cbors).toHaveLength(1);

    // The UTxO set changes before that rebuild fires, so it has to replace the merges: hold that build.
    walletStore.utxos = [...fragmented(), utxo(999, 3_000_000)] as never;
    const held = deferred<{ tx_cbor: string }>();
    let heldRequest!: BuildRequest;
    mocks.build.mockImplementationOnce((request: BuildRequest) => { heldRequest = request; return held.promise; });
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    expect(requests().filter(isMerge)).toHaveLength(2);
    expect(mocks.signingOptions?.prerequisites?.value).toBeNull();
    expect(mocks.signingOptions?.active?.()).toBe(false);
    expect(dialog().get('.continue-button').attributes('disabled')).toBeDefined();

    held.resolve(buildResponse(heldRequest));
    await settle();
    expect(requests().filter(isMerge).at(-1)?.utxos).toHaveLength(7);
    expect(mocks.signingOptions?.prerequisites?.value?.cbors).toHaveLength(1);
    expect(dialog().get('.continue-button').attributes('disabled')).toBeUndefined();
    expect(dialog().get('.global-total__fee').text()).toBe('- 0.4');
  });

  /** Like pressMax, but hands back the wrapper for its emitted events. */
  async function openMax() {
    const wrapper = await openSend();
    await dialog().get('[data-address]').trigger('click');
    await vi.advanceTimersByTimeAsync(500);
    await dialog().get('[data-max]').trigger('click');
    await settle();
    return wrapper;
  }

  it('shows the merges being prepared, then the plan, while Max builds them', async () => {
    // 400 UTxOs take two merges, so the card can count one of them before the other is built.
    walletStore.utxos = Array.from({ length: 400 }, (_, n) => utxo(n, 1_000_000 + n)) as never;
    const held = deferred<{ tx_cbor: string }>();
    let heldRequest!: BuildRequest;
    mocks.build.mockImplementationOnce((request: BuildRequest) => { heldRequest = request; return held.promise; });
    await openSend();
    await dialog().get('[data-address]').trigger('click');
    await vi.advanceTimersByTimeAsync(500);
    await dialog().get('[data-max]').trigger('click');
    await flushPromises();
    const track = dialog().get('.sweep-plan__track');
    expect(track.attributes('aria-valuemax')).toBe('2');
    expect(track.attributes('aria-valuenow')).toBe('1');
    expect(dialog().text()).toContain('send.sweepPreparing');
    expect(dialog().text()).not.toContain('send.sweepPlanTitle');
    expect(dialog().find('.max-limit-note').exists()).toBe(false);

    held.resolve(buildResponse(heldRequest));
    await settle();
    expect(dialog().find('.sweep-plan__track').exists()).toBe(false);
    expect(dialog().text()).toContain('send.sweepPlanTitle');
    expect(dialog().text()).toContain('send.sweepPlanNote');
    expect(dialog().text()).toContain('send.sweepFeeBreakdown');
    expect(dialog().get('.global-total__fee').text()).toBe('- 0.6');
  });

  it('takes the preparing card down when a merge cannot be built', async () => {
    mocks.build.mockRejectedValueOnce(new Error('nexus down'));
    await pressMax();
    expect(dialog().find('.sweep-plan').exists()).toBe(false);
    expect(dialog().get('.global-total__error').text()).toContain('nexus down');
  });

  it('shows where a sweep stopped, offers Try again, and clears the stop on the next attempt', async () => {
    await openMax();
    await dialog().get('.continue-button').trigger('click');
    await flushPromises();
    mocks.signingOptions!.onProgress!({ phase: 'sending', step: 1, total: 2 });
    await flushPromises();
    expect(dialog().get('.sweep-progress').text()).toContain('send.sweepSending');
    expect(dialog().get('.send-dialog__auth').isVisible()).toBe(false);

    mocks.signingOptions!.onProgress!(null);
    mocks.signingOptions!.onInterrupted!({ step: 1, total: 2, mergesSent: 0, reason: 'the node refused it' });
    await flushPromises();
    const alert = dialog().get('.sweep-progress__alert');
    expect(alert.attributes('role')).toBe('alert');
    expect(alert.text()).toContain('send.sweepStoppedTitle');
    expect(alert.text()).toContain('the node refused it');
    expect(dialog().get('.send-dialog__auth').isVisible()).toBe(true);
    expect(dialog().get('.continue-button').text()).toBe('common.tryAgain');

    mocks.signingOptions!.onProgress!({ phase: 'signing', step: 1, total: 2 });
    await flushPromises();
    expect(dialog().find('.sweep-progress__alert').exists()).toBe(false);
    expect(dialog().get('.continue-button').text()).toBe('wallet.sign');
  });

  it('stays open on what went out after a sweep, until Done', async () => {
    const wrapper = await openMax();
    expect(mocks.signingOptions?.closeOnSuccess?.()).toBe(false);
    const paymentId = 'b'.repeat(64);
    mocks.signingOptions!.onSuccess!(paymentId);
    await flushPromises();
    const done = dialog().get('.sweep-done');
    expect(done.text()).toContain('send.sweepDoneTitle');
    expect(done.text()).toContain('send.sweepDoneTransactions');
    expect(done.get('a.sweep-done__explorer').attributes('href')).toBe(`https://cexplorer.io/tx/${paymentId}`);
    expect(dialog().find('.continue-button').exists()).toBe(false);
    expect(wrapper.emitted('close')).toBeUndefined();

    await done.get('.sweep-done__button').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('closes after a single send as before', async () => {
    await openSend();
    await dialog().get('[data-amount]').trigger('click');
    await settle();
    expect(mocks.signingOptions?.prerequisites?.value).toBeNull();
    expect(mocks.signingOptions?.closeOnSuccess?.()).toBe(true);
    mocks.signingOptions!.onSuccess!('c'.repeat(64));
    await flushPromises();
    expect(dialog().find('.sweep-done').exists()).toBe(false);
  });
});
