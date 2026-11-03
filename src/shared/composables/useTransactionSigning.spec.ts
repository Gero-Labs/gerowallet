import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, effectScope, h, ref, type EffectScope } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import type { Cardano } from '@cardano-sdk/core';
import { Serialization } from '@cardano-sdk/core';
import { walletStore } from '@/stores/walletStore';
import { MessageTypes } from '@/models/MessageTypes';
import { WalletType } from '@/models/types';
import { useTransactionSigning, type TransactionSigningOptions } from './useTransactionSigning';
import i18n from '@/plugins/i18n';
import { CIP113_SIGN_REFUSAL_MESSAGE, MARKED_TO_FAIL_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';

const mocks = vi.hoisted(() => ({ send: vi.fn(), ledger: vi.fn(), evaluatePrf: vi.fn(), decryptPrf: vi.fn(), error: vi.fn(), success: vi.fn(), createQr: vi.fn(), parseQr: vi.fn() }));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive({ loggedWallet: {}, utxos: [], keys: [], config: { txAutoSubmit: true }, isLocked: false }) }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: mocks.send } }));
vi.mock('@/chrome/cardanoJsSdkCbor', () => ({ serializeCardanoJsSdkTx: (tx: unknown) => JSON.stringify(tx) }));
vi.mock('@cardano-sdk/core', () => ({ Serialization: { TransactionWitnessSet: { fromCore: () => ({ toCbor: () => 'witness' }) }, Transaction: { fromCbor: vi.fn() } } }));
vi.mock('@/shared/utils/ledger', () => ({ default: { txToLedger: mocks.ledger, ledgerErrorHandling: vi.fn() } }));
vi.mock('@/shared/utils/trezorDispatch', () => ({ dispatchTrezor: vi.fn() }));
vi.mock('@/shared/utils/keystone', () => ({ createKeystoneSignRequest: mocks.createQr, parseSignature: mocks.parseQr }));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { isCrossDeviceSigningEnabled: () => false, state: { flags: {} } } }));
vi.mock('@/stores/remoteSigningStore', () => ({ remoteSigningStore: { ensureLoaded: async () => {} } }));
vi.mock('@/utils/networks', () => ({ default: { resolveNetwork: () => ({}) } }));
vi.mock('@/utils/rules', () => ({ default: { required: () => () => true } }));
vi.mock('@/plugins/hardwareLoading', () => ({ default: { begin: vi.fn(), end: vi.fn() } }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: mocks.error, fireSuccess: mocks.success } }));
vi.mock('./useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/utils/passkeyPrf', () => ({ evaluateWalletPrf: mocks.evaluatePrf }));
vi.mock('@/shared/utils/webauthn-prf', () => ({ decryptPrivateKeyWithPrf: mocks.decryptPrf }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const scopes: EffectScope[] = [];
const txValue = (id = 'tx-one') => ({ body: { id } }) as unknown as Cardano.Tx;
function signer() {
  const scope = effectScope();
  scopes.push(scope);
  const tx = ref<Cardano.Tx | undefined>(txValue());
  const open = ref(true);
  const signing = scope.run(() => useTransactionSigning({ tx, active: () => open.value, successMessageKey: 'success' }))!;
  signing.spendingPassword.value = 'approved-password';
  return { signing, tx, open, scope };
}
function methods() { return mocks.send.mock.calls.map(call => call[0].method); }

beforeEach(() => {
  vi.clearAllMocks();
  walletStore.loggedWallet = { id: 1, chain: 'Cardano', network: 'Preprod', type: WalletType.Normal, encryptionMethod: 'password' };
  walletStore.config = { txAutoSubmit: true };
  walletStore.isLocked = false;
  mocks.send.mockImplementation(async ({ method }) => {
    if (method === MessageTypes.VERIFY_SPENDING_PASSWORD) return { data: { success: true } };
    if (method === MessageTypes.SIGN_TX) return { data: { witnesses: 'witness' } };
    return { data: { txId: 'submitted' } };
  });
});
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop());
  vi.useRealTimers();
});

describe('transaction approval under asynchronous validation and authentication', () => {
  it('binds Keystone scans to the generated request, including after a new transaction is approved', async () => {
    walletStore.loggedWallet.type = WalletType.Keystone;
    walletStore.loggedWallet['xfp'] = 'synthetic-fingerprint';
    const { signing, tx } = signer();
    mocks.createQr.mockReturnValueOnce({ requestId: 'old-request', ur: { type: 'cardano-sign-request', cbor: Buffer.from('aa', 'hex') } })
      .mockReturnValueOnce({ requestId: 'new-request', ur: { type: 'cardano-sign-request', cbor: Buffer.from('bb', 'hex') } });
    await signing.handleSign();
    expect(signing.overlay.value).toBe(true);
    tx.value = txValue('replacement');
    const ur = {} as Parameters<typeof signing.onKeystoneScan>[0];
    await signing.onKeystoneScan(ur);
    expect(mocks.parseQr).not.toHaveBeenCalled();
    await signing.handleSign();
    mocks.parseQr.mockReturnValue({ requestId: 'old-request', witnessSet: 'old-witness' });
    await signing.onKeystoneScan(ur);
    expect(methods()).not.toContain(MessageTypes.SUBMIT_TX);
    expect(signing.txWitnesses.value).toBeNull();
    // A fresh approval can only consume its matching device response once.
    signing.overlay.value = true;
    mocks.parseQr.mockReturnValue({ requestId: 'new-request', witnessSet: 'new-witness' });
    await signing.onKeystoneScan(ur);
    await signing.onKeystoneScan(ur);
    expect(methods().filter(method => method === MessageTypes.SUBMIT_TX)).toHaveLength(1);
  });
  it('awaits Vuetify validation and blocks repeated clicks while pending; false never signs', async () => {
    const { signing } = signer();
    const validation = deferred<{ valid: boolean }>();
    const form = { validate: vi.fn(() => validation.promise) };
    const first = signing.handleSign(form);
    await signing.handleSign(form);
    expect(form.validate).toHaveBeenCalledTimes(1);
    expect(mocks.send).not.toHaveBeenCalled();
    validation.resolve({ valid: false });
    await first;
    expect(mocks.send).not.toHaveBeenCalled();
    await signing.handleSign({ validate: async () => ({ valid: true }) });
    expect(methods()).toEqual([MessageTypes.VERIFY_SPENDING_PASSWORD, MessageTypes.SIGN_TX, MessageTypes.SUBMIT_TX]);
  });

  for (const change of ['cancel', 'transaction', 'transaction-body', 'wallet', 'network', 'lock', 'unmount'] as const) {
    for (const phase of ['validation', 'password'] as const) {
      it(`drops ${phase} approval after ${change}`, async () => {
        const { signing, tx, open, scope } = signer();
        const pending = deferred<unknown>();
        if (phase === 'password') mocks.send.mockReturnValueOnce(pending.promise);
        const running = signing.handleSign(phase === 'validation' ? { validate: () => pending.promise as Promise<{ valid: boolean }> } : undefined);
        if (change === 'cancel') open.value = false;
        if (change === 'transaction') tx.value = txValue('replacement');
        if (change === 'transaction-body') (tx.value!.body as unknown as { id: string }).id = 'replacement';
        if (change === 'wallet') walletStore.loggedWallet.id = 2;
        if (change === 'network') walletStore.loggedWallet.network = 'Mainnet';
        if (change === 'lock') walletStore.isLocked = true;
        if (change === 'unmount') scope.stop();
        pending.resolve(phase === 'validation' ? { valid: true } : { data: { success: true } });
        await running;
        expect(methods()).not.toContain(MessageTypes.SIGN_TX);
        expect(methods()).not.toContain(MessageTypes.SUBMIT_TX);
        expect(signing.isSubmit.value).toBe(false);
        expect(mocks.error).not.toHaveBeenCalled();
      });
    }
  }

  it('requires fresh approval for a replacement and ignores an older signed response', async () => {
    const { signing, tx } = signer();
    const pendingSignature = deferred<unknown>();
    mocks.send.mockImplementation(async ({ method }) => method === MessageTypes.SIGN_TX ? pendingSignature.promise : { data: { success: true } });
    const old = signing.handleSign();
    await flushPromises();
    expect(methods()).toContain(MessageTypes.SIGN_TX);
    tx.value = txValue('replacement');
    pendingSignature.resolve({ data: { witnesses: 'stale-witness' } });
    await old;
    expect(methods()).not.toContain(MessageTypes.SUBMIT_TX);
    expect(signing.txWitnesses.value).toBeNull();
    mocks.send.mockImplementation(async ({ method }) => method === MessageTypes.SIGN_TX ? { data: { witnesses: 'new-witness' } } : { data: { success: true, txId: 'new-id' } });
    signing.spendingPassword.value = 'fresh-approval';
    await signing.handleSign();
    const submit = mocks.send.mock.calls.find(call => call[0].method === MessageTypes.SUBMIT_TX)![0];
    expect(submit.data.txCbor).toContain('replacement');
    expect(submit.data.witnessHex).toBe('new-witness');
  });

  it('drops a hardware result after wallet replacement without submitting it', async () => {
    walletStore.loggedWallet.type = WalletType.Ledger;
    const { signing } = signer();
    const pending = deferred<Map<string, string>>();
    mocks.ledger.mockReturnValueOnce(pending.promise);
    const signingResult = signing.handleSign();
    walletStore.loggedWallet.id = 2;
    pending.resolve(new Map());
    await signingResult;
    expect(methods()).not.toContain(MessageTypes.SUBMIT_TX);
  });

  it('clears delayed PassKey signing and its key on transaction replacement', async () => {
    vi.useFakeTimers();
    walletStore.loggedWallet.encryptionMethod = 'prf';
    const { signing, tx } = signer();
    const key = new Uint8Array([4, 5, 6]);
    signing.handlePassKeyAuthSuccess(key);
    tx.value = txValue('replacement');
    await vi.advanceTimersByTimeAsync(301);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(key).toEqual(new Uint8Array(3));
  });

  it('never lets a delayed autofill callback submit an already signed manual-confirmation transaction', async () => {
    vi.useFakeTimers();
    walletStore.config.txAutoSubmit = false;
    const { signing } = signer();
    signing.handlePassKeySuccess();
    await signing.handleSign();
    expect(signing.isSubmit.value).toBe(true);
    await vi.advanceTimersByTimeAsync(301);
    expect(methods()).toEqual([MessageTypes.VERIFY_SPENDING_PASSWORD, MessageTypes.SIGN_TX]);
  });

  it('drops a PassKey ceremony started by the real child control when its parent transaction changes', async () => {
    walletStore.loggedWallet.encryptionMethod = 'prf';
    walletStore.loggedWallet.webAuthnCredentialId = 'credential';
    walletStore.loggedWallet.prfEncryptedPrivateKey = 'encrypted-test-key';
    const pending = deferred<ArrayBuffer>();
    mocks.evaluatePrf.mockReturnValueOnce(pending.promise);
    const tx = ref<Cardano.Tx | undefined>(txValue());
    const wrapper = mount(defineComponent({ setup() {
      const signing = useTransactionSigning({ tx: computed(() => tx.value), successMessageKey: 'success' });
      return () => h(PassKeyAuthButton, { onSuccess: signing.handlePassKeyAuthSuccess });
    } }), { global: { stubs: { VBtn: { template: '<button><slot /></button>' }, VIcon: true } } });
    try {
      await wrapper.find('button').trigger('click');
      await flushPromises();
      expect(mocks.evaluatePrf).toHaveBeenCalledOnce();
      tx.value = txValue('replacement');
      const output = new Uint8Array([1, 2, 3]);
      pending.resolve(output.buffer);
      await flushPromises();
      expect(mocks.decryptPrf).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
      expect(output).toEqual(new Uint8Array(3));
    } finally { wrapper.unmount(); }
  });
});

// A refusal on THIS device, before the relay, names its own reason: the other device never saw it.
describe('cross-device signing refused before the relay', () => {
  it.each([
    [CIP113_SIGN_REFUSAL_MESSAGE, 'programmableTokens.signRefused'],
    [MARKED_TO_FAIL_SIGN_REFUSAL_MESSAGE, 'errors.markedToFailRefused'],
  ])('shows why for %s', async (reason, key) => {
    mocks.send.mockImplementation(async ({ method }) => (method === MessageTypes.REQUEST_CROSS_DEVICE_SIGNATURE
      ? { data: { decision: 'rejected', reason } }
      : { data: {} }));
    const { signing } = signer();

    await signing.signOnAnotherDevice();

    expect(mocks.error).toHaveBeenCalledWith(i18n.t(key));
    expect(mocks.error).not.toHaveBeenCalledWith('crossDevice.requestRejected');
  });
});

describe('sweep prerequisites', () => {
  const merge = (id: string) => ({
    id, body: { inputs: [{ txId: `in-${id}`, index: 0 }], outputs: [{ address: 'own', value: { coins: 5 } }], fee: 1 },
  }) as unknown as Cardano.Tx;
  const payment = (...spends: string[]) =>
    ({ id: 'payment', body: { inputs: spends.map((txId) => ({ txId, index: 0 })), outputs: [], fee: 1 } }) as unknown as Cardano.Tx;
  const output = (id: string) => [{ txId: id, index: 0, address: 'own' }, { address: 'own', value: { coins: 5n } }] as unknown as Cardano.Utxo;
  const sentIds = (method: string) => mocks.send.mock.calls
    .filter(([message]) => message.method === method)
    .map(([message]) => JSON.parse(message.data.txCbor).id as string);

  function sweeper(merges: string[], spends = merges, mergeOf = merge, extra: Partial<TransactionSigningOptions> = {}) {
    const scope = effectScope();
    scopes.push(scope);
    const tx = ref<Cardano.Tx | undefined>(payment(...spends));
    const prerequisites = ref({ cbors: merges.map((id) => JSON.stringify(mergeOf(id))), outputs: merges.map(output) });
    const progress: unknown[] = [];
    const signing = scope.run(() => useTransactionSigning({
      tx, active: () => true, successMessageKey: 'success', prerequisites, onProgress: (step) => progress.push(step), ...extra,
    }))!;
    signing.spendingPassword.value = 'approved-password';
    return { signing, progress };
  }

  let previousKeys: typeof walletStore.keys;

  beforeEach(() => {
    walletStore.utxos = [];
    // The merges pay 'own': the binder must find it among the wallet's own addresses.
    previousKeys = walletStore.keys;
    walletStore.keys = { payment: [{ address: 'own' }], change: [] } as never;
    vi.mocked(Serialization.Transaction.fromCbor).mockImplementation(((cbor: string) => ({
      getId: () => JSON.parse(cbor).id,
      toCore: () => JSON.parse(cbor),
    })) as never);
  });

  afterEach(() => {
    walletStore.keys = previousKeys;
  });

  it('signs every merge and the payment after one password check, then submits them in order', async () => {
    const { signing, progress } = sweeper(['m1', 'm2']);
    await signing.handleSign();
    await flushPromises();
    expect(methods()).toEqual([
      MessageTypes.VERIFY_SPENDING_PASSWORD,
      MessageTypes.SIGN_TX, MessageTypes.SIGN_TX, MessageTypes.SIGN_TX,
      MessageTypes.SUBMIT_TX, MessageTypes.SUBMIT_TX, MessageTypes.SUBMIT_TX,
    ]);
    expect(sentIds(MessageTypes.SIGN_TX)).toEqual(['m1', 'm2', 'payment']);
    expect(sentIds(MessageTypes.SUBMIT_TX)).toEqual(['m1', 'm2', 'payment']);
    // The payment's signer is shown the merge outputs it spends.
    const paymentSign = mocks.send.mock.calls.filter(([message]) => message.method === MessageTypes.SIGN_TX).at(-1)![0];
    expect(paymentSign.data.utxos.map(([txIn]: Cardano.Utxo) => txIn.txId)).toEqual(['m1', 'm2']);
    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(progress).toContainEqual({ phase: 'signing', step: 1, total: 3 });
    expect(progress).toContainEqual({ phase: 'sending', step: 3, total: 3 });
    expect(progress.at(-1)).toBeNull();
  });

  // runtime.sendMessage sends JSON: one bigint fails the whole message, as the merge
  // outputs' coins (decoded from CBOR) did for every sweep signed in the extension.
  it('sends the payment\'s signer the merge outputs as a runtime message can carry them', async () => {
    const { signing } = sweeper(['m1']);
    await signing.handleSign();
    await flushPromises();
    for (const [message] of mocks.send.mock.calls) expect(() => JSON.stringify(message)).not.toThrow();
    const paymentSign = mocks.send.mock.calls.filter(([message]) => message.method === MessageTypes.SIGN_TX).at(-1)![0];
    expect(paymentSign.data.utxos[0][1].value.coins).toBe('5');
    expect(mocks.success).toHaveBeenCalledTimes(1);
  });

  it('reports a SIGN_TX the runtime could not send as its error, and sends nothing', async () => {
    mocks.send.mockImplementation(async ({ method }) => {
      if (method === MessageTypes.VERIFY_SPENDING_PASSWORD) return { data: { success: true } };
      // What Messaging resolves when runtime.sendMessage throws: no `data`.
      if (method === MessageTypes.SIGN_TX) return { error: 'Could not serialize message.' };
      return { data: { txId: 'submitted' } };
    });
    const { signing } = sweeper(['m1']);
    await signing.handleSign();
    await flushPromises();
    expect(methods()).not.toContain(MessageTypes.SUBMIT_TX);
    expect(mocks.error).toHaveBeenCalledWith('Could not serialize message.');
  });

  it('refuses a merge the payment does not spend, before asking for the password', async () => {
    const { signing } = sweeper(['m1', 'm2'], ['m1']);
    await signing.handleSign();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('txGuard.builtTxMismatch');
  });

  it('stops at a failed merge and, signed again, skips the merges already sent', async () => {
    let failSecond = true;
    mocks.send.mockImplementation(async ({ method, data }) => {
      if (method === MessageTypes.VERIFY_SPENDING_PASSWORD) return { data: { success: true } };
      if (method === MessageTypes.SIGN_TX) return { data: { witnesses: 'witness' } };
      if (JSON.parse(data.txCbor).id === 'm2' && failSecond) { failSecond = false; return { data: { error: 'node busy' } }; }
      return { data: { txId: 'submitted' } };
    });
    const { signing } = sweeper(['m1', 'm2']);
    await signing.handleSign();
    await flushPromises();
    expect(sentIds(MessageTypes.SUBMIT_TX)).toEqual(['m1', 'm2']);
    expect(mocks.error).toHaveBeenCalledWith('send.sweepInterrupted');
    mocks.send.mockClear();
    await signing.handleSign();
    await flushPromises();
    expect(sentIds(MessageTypes.SUBMIT_TX)).toEqual(['m2', 'payment']);
    expect(mocks.success).toHaveBeenCalledTimes(1);
  });

  it('waits for the merges to land and resends the payment a node did not accept yet', async () => {
    vi.useFakeTimers();
    let paymentTries = 0;
    mocks.send.mockImplementation(async ({ method, data }) => {
      if (method === MessageTypes.VERIFY_SPENDING_PASSWORD) return { data: { success: true } };
      if (method === MessageTypes.SIGN_TX) return { data: { witnesses: 'witness' } };
      if (JSON.parse(data.txCbor).id === 'payment' && ++paymentTries === 1) return { data: { error: 'BadInputsUTxO' } };
      return { data: { txId: 'submitted' } };
    });
    const { signing, progress } = sweeper(['m1']);
    const done = signing.handleSign();
    await vi.advanceTimersByTimeAsync(2000);
    expect(progress).toContainEqual({ phase: 'waiting', step: 2, total: 2 });
    expect(paymentTries).toBe(1);
    walletStore.utxos = [output('m1')];
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    expect(paymentTries).toBe(2);
    expect(mocks.success).toHaveBeenCalledTimes(1);
  });

  it('refuses a sweep on a hardware wallet without reaching the device', async () => {
    walletStore.loggedWallet.type = WalletType.Ledger;
    const { signing } = sweeper(['m1']);
    await signing.handleSign();
    expect(mocks.ledger).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('send.sweepSoftwareOnly');
  });

  it('refuses a merge that pays outside the wallet', async () => {
    const stray = (id: string) => ({
      id, body: { inputs: [{ txId: `in-${id}`, index: 0 }], outputs: [{ address: 'elsewhere', value: { coins: 1 } }], fee: 1 },
    }) as unknown as Cardano.Tx;
    const { signing } = sweeper(['m1'], ['m1'], stray);
    await signing.handleSign();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('txGuard.builtTxMismatch');
  });

  it('fails closed on an empty merge witness', async () => {
    mocks.send.mockImplementation(async ({ method, data }) => {
      if (method === MessageTypes.VERIFY_SPENDING_PASSWORD) return { data: { success: true } };
      if (method === MessageTypes.SIGN_TX) return JSON.parse(data.txCbor).id === 'm1' ? { data: {} } : { data: { witnesses: 'witness' } };
      return { data: { txId: 'submitted' } };
    });
    const { signing } = sweeper(['m1']);
    await signing.handleSign();
    await flushPromises();
    expect(methods()).not.toContain(MessageTypes.SUBMIT_TX);
    expect(mocks.error).toHaveBeenCalled();
  });

  it('hands the PassKey key to every SIGN_TX', async () => {
    walletStore.loggedWallet.encryptionMethod = 'prf';
    const { signing } = sweeper(['m1', 'm2']);
    signing.privateKeyBytes.value = new Uint8Array([1, 2]);
    await signing.handleSign();
    await flushPromises();
    expect(methods()).not.toContain(MessageTypes.VERIFY_SPENDING_PASSWORD);
    const signs = mocks.send.mock.calls.filter(([message]) => message.method === MessageTypes.SIGN_TX);
    expect(signs).toHaveLength(3);
    for (const [message] of signs) expect(message.data.privateKeyBytes).toEqual([1, 2]);
  });

  it('gives up waiting after five minutes without resending', async () => {
    vi.useFakeTimers();
    mocks.send.mockImplementation(async ({ method, data }) => {
      if (method === MessageTypes.VERIFY_SPENDING_PASSWORD) return { data: { success: true } };
      if (method === MessageTypes.SIGN_TX) return { data: { witnesses: 'witness' } };
      if (JSON.parse(data.txCbor).id === 'payment') return { data: { error: 'BadInputsUTxO' } };
      return { data: { txId: 'submitted' } };
    });
    const { signing } = sweeper(['m1']);
    const done = signing.handleSign();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 2000);
    await done;
    expect(sentIds(MessageTypes.SUBMIT_TX).filter((id) => id === 'payment')).toHaveLength(1);
    expect(mocks.error).toHaveBeenCalledWith('send.sweepInterrupted');
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('reports a stopped sweep to the dialog instead of a snackbar', async () => {
    mocks.send.mockImplementation(async ({ method, data }) => {
      if (method === MessageTypes.VERIFY_SPENDING_PASSWORD) return { data: { success: true } };
      if (method === MessageTypes.SIGN_TX) return { data: { witnesses: 'witness' } };
      if (JSON.parse(data.txCbor).id === 'm2') return { data: { error: 'node busy' } };
      return { data: { txId: 'submitted' } };
    });
    const onInterrupted = vi.fn();
    const { signing } = sweeper(['m1', 'm2'], ['m1', 'm2'], merge, { onInterrupted });
    await signing.handleSign();
    await flushPromises();
    expect(sentIds(MessageTypes.SUBMIT_TX)).toEqual(['m1', 'm2']);
    expect(onInterrupted).toHaveBeenCalledTimes(1);
    expect(onInterrupted).toHaveBeenCalledWith({ step: 2, total: 3, mergesSent: 1, reason: 'node busy' });
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('keeps the dialog open after a sweep when asked', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    const { signing } = sweeper(['m1'], ['m1'], merge, { onSuccess, onClose, closeOnSuccess: () => false });
    await signing.handleSign();
    await flushPromises();
    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith('submitted');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes after success by default', async () => {
    const onClose = vi.fn();
    const { signing } = sweeper(['m1'], ['m1'], merge, { onClose });
    await signing.handleSign();
    await flushPromises();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

