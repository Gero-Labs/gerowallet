import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, shallowMount } from '@vue/test-utils';
import type { Cardano } from '@cardano-sdk/core';
import type { UR } from '@keystonehq/keystone-sdk';
import { deferred } from '@test/helpers/dialogControls';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';

const mocks = vi.hoisted(() => ({ send: vi.fn(), build: vi.fn(), ledger: vi.fn(), trezor: vi.fn(), qr: vi.fn(), parseQr: vi.fn(), success: vi.fn() }));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive({ loggedWallet: {}, utxos: [], keys: {}, tokens: {}, collections: {}, contacts: {}, config: {}, isLocked: false }) }));
vi.mock('@/stores/networkStore', async () => ({ networkStore: (await import('vue')).reactive({ tip: {}, epochParams: {} }) }));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { isCrossDeviceSigningEnabled: () => true, state: { flags: { isTrezorWebUsbEnabled: true } } } }));
vi.mock('@/stores/remoteSigningStore', () => ({ remoteSigningStore: { ensureLoaded: async () => {}, isEnabled: () => true, hasTrustedSigner: () => true, requiresRemoteForSend: () => false } }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: mocks.send } }));
vi.mock('@/chrome/cardanoJsSdkCbor', () => ({ serializeCardanoJsSdkTx: (tx: unknown) => JSON.stringify(tx) }));
vi.mock('@cardano-sdk/core', () => ({ Serialization: {
  Transaction: { fromCbor: (cbor: string) => ({ toCore: () => JSON.parse(cbor) }) },
  TransactionWitnessSet: { fromCore: () => ({ toCbor: () => 'hardware-witness' }) },
} }));
vi.mock('@cardano-sdk/util', () => ({ HexBlob: (value: string) => value }));
vi.mock('@cardano-sdk/tx-construction', () => ({ computeMinimumCoinQuantity: () => () => 1n }));
vi.mock('@/api/nexus-tx-api', () => ({ nexusTxApi: { buildTransferTx: mocks.build }, walletUtxosToNexusInputs: () => [], txOutToNexusOutput: (v: unknown) => v, requiredAssetsFromOutputs: () => [] }));
vi.mock('@/shared/utils/ledger', () => ({ default: { txToLedger: mocks.ledger, ledgerErrorHandling: vi.fn() } }));
vi.mock('@/shared/utils/trezorDispatch', () => ({ dispatchTrezor: mocks.trezor }));
vi.mock('@/shared/utils/keystone', () => ({ createKeystoneSignRequest: mocks.qr, parseSignature: mocks.parseQr }));
vi.mock('@/shared/utils/resolver', () => ({ applyTokenImageOverride: () => '' }));
vi.mock('@/api/ada-handle.api', () => ({ default: { resolve: vi.fn() } }));
vi.mock('@/utils/assets', () => ({ default: { resolveIcon: () => '' } }));
vi.mock('@/utils/networks', () => ({ default: { resolveNetwork: () => ({}), resolveCurrencyTicker: () => 'ADA' } }));
vi.mock('@/utils/rules', () => ({ default: { recipientRules: () => () => true } }));
vi.mock('@/shared/utils/filters', () => ({ default: { toCurrency: String } }));
vi.mock('@/plugins/hardwareLoading', () => ({ default: { begin: vi.fn(), end: vi.fn() } }));
vi.mock('@/plugins/snackbar', () => ({ default: { fireSuccess: mocks.success } }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('../../composables/useChainContext', async () => {
  const { ref } = await import('vue');
  return { useChainContext: () => ({ themeColors: ref({ primary: 'green' }) }) };
});
vi.mock('@/modules/dashboard/dialogs/QRAddressScannerDialog.vue', () => ({ default: { template: '<span />' } }));
vi.mock('@/shared/components/PassKeyAuthButton.vue', () => ({ default: { template: '<span />' } }));
vi.mock('../KeystoneSignSheet.vue', () => ({ default: { template: '<span />' } }));

import SendSheet from './SendSheet.vue';
import { walletStore } from '@/stores/walletStore';
import { MessageTypes } from '@/models/MessageTypes';
import { Blockchain, Network, WalletType } from '@/models/types';

interface View {
  tx: Cardano.Tx | undefined; step: number; address: string; paymentAddress: string; adaAmount: string;
  spendingPassword: string; txSuccess: boolean; txBuilt: boolean; passwordError: string;
  extraTokens: { unit: string; sendAmount: string }[]; selectedNfts: { unit: string; toSendQuantity: number }[];
  signAndSubmit(): Promise<void>; signLedger(): Promise<void>; signTrezor(): Promise<void>;
  signOnAnotherDevice(): Promise<void>; onPassKeySuccess(key: Uint8Array): Promise<void>;
  signKeystone(): void; onKeystoneScan(ur: UR): Promise<void>; onClose(open: boolean): void;
  goToStep(step: number): Promise<void>;
}
const transaction = (id = 'original') => ({ body: { id, fee: 1 } }) as unknown as Cardano.Tx;
const methods = () => mocks.send.mock.calls.map(([message]) => message.method);
function render(realBottomSheet = false) {
  const wrapper = shallowMount(SendSheet, { props: { modelValue: !realBottomSheet }, global: {
    renderStubDefaultSlot: true,
    plugins: realBottomSheet ? [createTestVuetify()] : [],
    stubs: realBottomSheet ? { BottomSheet: false, VBtn: false, VIcon: false } : {},
    config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }), warnHandler: () => {} },
  } });
  const view = wrapper.vm as unknown as View;
  view.step = 4;
  view.tx = transaction();
  view.spendingPassword = 'approved';
  return { wrapper, view };
}
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
  walletStore.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.MAINNET, type: WalletType.Normal } as never;
  walletStore.isLocked = false;
  mocks.send.mockImplementation(async ({ method }) => {
    if (method === MessageTypes.VERIFY_SPENDING_PASSWORD) return { data: { success: true } };
    if (method === MessageTypes.SIGN_TX) return { data: { witnesses: 'witness' } };
    return { data: { txId: 'submitted' } };
  });
});

describe('side-panel submission dismissal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const matchMedia = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation(query => {
      const media = matchMedia(query);
      if (query === '(prefers-reduced-motion: reduce)') Object.defineProperty(media, 'matches', { value: true });
      return media;
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  async function openSheet() {
    const result = render(true);
    await result.wrapper.setProps({ modelValue: true });
    result.view.step = 4;
    result.view.tx = transaction();
    result.view.spendingPassword = 'approved';
    await flushPromises();
    return result;
  }

  it.each(['close button', 'Escape'] as const)('preserves a dispatched transaction after %s and allows dismissal after success', async action => {
    const { wrapper, view } = await openSheet();
    const submission = deferred<unknown>();
    mocks.send.mockResolvedValueOnce({ data: { success: true } })
      .mockResolvedValueOnce({ data: { witnesses: 'witness' } })
      .mockReturnValueOnce(submission.promise);
    const running = view.signAndSubmit();
    await flushPromises();
    expect(methods()).toContain(MessageTypes.SUBMIT_TX);
    expect(wrapper.get('.bottom-sheet-header button').attributes('disabled')).toBeDefined();
    if (action === 'close button') await wrapper.get('.bottom-sheet-header button').trigger('click');
    else await wrapper.get('.bottom-sheet-container').trigger('keydown', { key: 'Escape' });
    await vi.advanceTimersByTimeAsync(250);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    // The parent must also reject a late child dismissal event during dispatch.
    view.onClose(false);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    submission.resolve({ data: { txId: 'submitted' } });
    await running;
    await flushPromises();
    expect(view.txSuccess).toBe(true);
    expect(mocks.success).toHaveBeenCalledOnce();
    expect(wrapper.get('.success-overlay button').attributes('disabled')).toBeUndefined();
    await wrapper.get('.success-overlay button').trigger('click');
    await vi.advanceTimersByTimeAsync(250);
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
  });

  it.each(['response error', 'rejection'] as const)('restores dismissal and exposes submission %s', async failure => {
    const { wrapper, view } = await openSheet();
    const submission = deferred<unknown>();
    mocks.send.mockResolvedValueOnce({ data: { success: true } })
      .mockResolvedValueOnce({ data: { witnesses: 'witness' } })
      .mockReturnValueOnce(submission.promise);
    const running = view.signAndSubmit();
    await flushPromises();
    expect(wrapper.get('.bottom-sheet-header button').attributes('disabled')).toBeDefined();
    if (failure === 'response error') submission.resolve({ data: { error: 'Submission failed' } });
    else submission.reject(new Error('Submission failed'));
    await running;
    await flushPromises();
    expect(view.passwordError).toBe('Submission failed');
    expect(view.txSuccess).toBe(false);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(wrapper.get('.bottom-sheet-header button').attributes('disabled')).toBeUndefined();
    await wrapper.get('.bottom-sheet-header button').trigger('click');
    await vi.advanceTimersByTimeAsync(250);
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
  });

  it('keeps explicit cancellation available during password verification', async () => {
    const { wrapper, view } = await openSheet();
    const password = deferred<unknown>();
    mocks.send.mockReturnValueOnce(password.promise);
    const running = view.signAndSubmit();
    await flushPromises();
    expect(wrapper.get('.bottom-sheet-header button').attributes('disabled')).toBeUndefined();
    await wrapper.get('.bottom-sheet-header button').trigger('click');
    await vi.advanceTimersByTimeAsync(250);
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
    password.resolve({ data: { success: true } });
    await running;
    expect(methods()).toEqual([MessageTypes.VERIFY_SPENDING_PASSWORD]);
  });
});

describe('side-panel Cardano approval', () => {
  it('preserves approval when an equal wallet snapshot arrives during password verification', async () => {
    const { view } = render();
    const approvedTransaction = view.tx;
    view.txBuilt = true;
    const password = deferred<unknown>();
    mocks.send.mockReturnValueOnce(password.promise);
    const running = view.signAndSubmit();
    walletStore.loggedWallet = { ...walletStore.loggedWallet };
    password.resolve({ data: { success: true } });
    await running;
    expect(view.tx).toBe(approvedTransaction);
    expect(view.txBuilt).toBe(true);
    expect(methods()).toEqual([MessageTypes.VERIFY_SPENDING_PASSWORD, MessageTypes.SIGN_TX, MessageTypes.SUBMIT_TX]);
    expect(view.txSuccess).toBe(true);
    expect(mocks.success).toHaveBeenCalledOnce();
  });
  it('preserves submission confirmation when an equal wallet snapshot arrives after dispatch', async () => {
    const { view } = render();
    const approvedTransaction = view.tx;
    view.txBuilt = true;
    const submission = deferred<unknown>();
    mocks.send.mockResolvedValueOnce({ data: { success: true } })
      .mockResolvedValueOnce({ data: { witnesses: 'witness' } })
      .mockReturnValueOnce(submission.promise);
    const running = view.signAndSubmit();
    await flushPromises();
    expect(methods()).toContain(MessageTypes.SUBMIT_TX);
    walletStore.loggedWallet = { ...walletStore.loggedWallet };
    submission.resolve({ data: { txId: 'submitted' } });
    await running;
    expect(view.tx).toBe(approvedTransaction);
    expect(view.txBuilt).toBe(true);
    expect(view.txSuccess).toBe(true);
    expect(mocks.success).toHaveBeenCalledOnce();
  });
  it.each(['wallet', 'chain', 'network', 'recipient', 'payment-address', 'amount', 'token-amount', 'nft-quantity'] as const)(
    'synchronously clears the transaction and invalidates approval for a real %s change', async change => {
      const { view } = render();
      view.extraTokens = [{ unit: 'token', sendAmount: '1' }];
      view.selectedNfts = [{ unit: 'nft', toSendQuantity: 1 }];
      view.tx = transaction();
      view.txBuilt = true;
      view.spendingPassword = 'approved';
      const password = deferred<unknown>();
      mocks.send.mockReturnValueOnce(password.promise);
      const running = view.signAndSubmit();
      if (change === 'wallet') walletStore.loggedWallet.id = 2;
      if (change === 'chain') walletStore.loggedWallet.chain = Blockchain.BITCOIN;
      if (change === 'network') walletStore.loggedWallet.network = Network.PREPROD;
      if (change === 'recipient') view.address = 'replacement-address';
      if (change === 'payment-address') view.paymentAddress = 'replacement-address';
      if (change === 'amount') view.adaAmount = '9';
      if (change === 'token-amount') view.extraTokens[0].sendAmount = '2';
      if (change === 'nft-quantity') view.selectedNfts[0].toSendQuantity = 2;
      const clearedSynchronously = view.tx === undefined && !view.txBuilt;
      password.resolve({ data: { success: true } });
      await running;
      expect(clearedSynchronously).toBe(true);
      expect(methods()).toEqual([MessageTypes.VERIFY_SPENDING_PASSWORD]);
      expect(mocks.success).not.toHaveBeenCalled();
    },
  );
  it.each(['close', 'wallet', 'network', 'lock', 'transaction', 'raw-body', 'recipient', 'amount'] as const)(
    'does not sign or submit after %s changes during password verification', async change => {
      const { wrapper, view } = render();
      const password = deferred<unknown>();
      mocks.send.mockReturnValueOnce(password.promise);
      const running = view.signAndSubmit();
      if (change === 'close') view.onClose(false);
      if (change === 'wallet') walletStore.loggedWallet.id = 2;
      if (change === 'network') walletStore.loggedWallet.network = Network.PREPROD;
      if (change === 'lock') walletStore.isLocked = true;
      if (change === 'transaction') view.tx = transaction('replacement');
      if (change === 'raw-body') (view.tx!.body as unknown as { id: string }).id = 'changed';
      if (change === 'recipient') view.address = 'replacement-address';
      if (change === 'amount') view.adaAmount = '9';
      password.resolve({ data: { success: true } });
      await running;
      expect(methods()).toEqual([MessageTypes.VERIFY_SPENDING_PASSWORD]);
      expect(mocks.success).not.toHaveBeenCalled();
      expect(wrapper.exists()).toBe(true);
    },
  );
  it('requires a new approval after replacement and serializes repeated clicks', async () => {
    const { view } = render();
    const password = deferred<unknown>();
    mocks.send.mockReturnValueOnce(password.promise);
    const running = view.signAndSubmit();
    await view.signAndSubmit();
    expect(methods()).toHaveLength(1);
    view.tx = transaction('replacement');
    password.resolve({ data: { success: true } });
    await running;
    view.spendingPassword = 'fresh-password';
    await view.signAndSubmit();
    const submit = mocks.send.mock.calls.find(([message]) => message.method === MessageTypes.SUBMIT_TX)![0];
    expect(submit.data.txCbor).toContain('replacement');
    expect(view.txSuccess).toBe(true);
  });
  it.each(['ledger', 'trezor', 'remote', 'passkey'] as const)('discards %s signing after cancellation', async signer => {
    const { view } = render();
    const result = deferred<unknown>();
    const key = new Uint8Array([1, 2, 3]);
    mocks.ledger.mockReturnValueOnce(result.promise);
    mocks.trezor.mockReturnValueOnce(result.promise);
    mocks.send.mockReturnValueOnce(result.promise);
    const running = signer === 'ledger' ? view.signLedger() : signer === 'trezor' ? view.signTrezor()
      : signer === 'remote' ? view.signOnAnotherDevice() : view.onPassKeySuccess(key);
    view.onClose(false);
    result.resolve(signer === 'ledger' ? new Map() : { data: { success: true, signatures: [], witnesses: 'stale', decision: 'approved', witnessSetCbor: 'stale' } });
    await running;
    expect(methods()).not.toContain(MessageTypes.SUBMIT_TX);
    expect(mocks.success).not.toHaveBeenCalled();
    if (signer === 'passkey') expect(key).toEqual(new Uint8Array(3));
  });
  it('rejects old Keystone responses after a new QR approval and accepts the matching response once', async () => {
    const { view } = render();
    mocks.qr.mockReturnValueOnce({ requestId: 'first', ur: { type: 'cardano', cbor: Buffer.from('aa', 'hex') } })
      .mockReturnValueOnce({ requestId: 'second', ur: { type: 'cardano', cbor: Buffer.from('bb', 'hex') } });
    view.signKeystone();
    view.tx = transaction('replacement');
    await view.onKeystoneScan({} as UR);
    expect(mocks.parseQr).not.toHaveBeenCalled();
    view.signKeystone();
    mocks.parseQr.mockReturnValueOnce({ requestId: 'first', witnessSet: 'old' });
    await view.onKeystoneScan({} as UR);
    expect(methods()).not.toContain(MessageTypes.SUBMIT_TX);
    mocks.parseQr.mockReturnValue({ requestId: 'second', witnessSet: 'fresh' });
    await view.onKeystoneScan({} as UR);
    await view.onKeystoneScan({} as UR);
    expect(methods()).toEqual([MessageTypes.SUBMIT_TX]);
  });
  it('discards a built transaction when its recipient changes before the builder returns', async () => {
    const { view } = render();
    view.step = 2;
    view.address = 'first-address';
    view.paymentAddress = 'first-address';
    view.adaAmount = '2';
    const built = deferred<{ tx_cbor: string }>();
    mocks.build.mockReturnValueOnce(built.promise);
    const running = view.goToStep(3);
    await flushPromises();
    expect(mocks.build).toHaveBeenCalledOnce();
    view.address = 'new-address';
    built.resolve({ tx_cbor: JSON.stringify(transaction()) });
    await running;
    expect(view.txBuilt).toBe(false);
    expect(view.step).toBe(2);
  });
});
