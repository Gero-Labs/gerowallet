import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { bech32 } from 'bech32';
import { deferred, dialogControls } from '@test/helpers/dialogControls';

const mocks = vi.hoisted(() => ({
  validate: vi.fn(), send: vi.fn(), approve: vi.fn(), reject: vi.fn(),
  buildSignature: vi.fn(), fromBytes: vi.fn(), ready: vi.fn(),
}));
vi.mock('@/services/cip45/signingAuthorization', () => ({ validateCip45Signing: mocks.validate }));
vi.mock('../composables/useDAppOverlay', async () => {
  const { ref } = await import('vue');
  const state = { isVisible: ref(true), currentRequest: ref(null), requestQueue: ref([]),
    approve: mocks.approve, reject: mocks.reject, rejectQueued: vi.fn(), rejectAll: vi.fn(), setOverlayReady: mocks.ready };
  return { useDAppOverlay: () => state };
});
vi.mock('../composables/useChainContext', async () => {
  const { ref } = await import('vue');
  return { useChainContext: () => ({ themeColors: ref({ primary: '#fff' }) }) };
});
vi.mock('@/stores/walletStore', async () => ({ default: { state: (await import('vue')).reactive({
  loggedWallet: {}, isLocked: false, keys: { payment: [], change: [], stake: [] }, utxos: [],
}) } }));
vi.mock('@/stores/networkStore', () => ({ networkStore: { tip: null }, isBitcoinTip: () => false }));
vi.mock('@/stores/priceStore', () => ({ priceStore: {} }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: { privateSyncStatus: 'idle', proofServer: { mode: 'local' } } }));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { state: { flags: {} } } }));
vi.mock('@/shared/composables/useCurrencyConverter', () => ({ useCurrencyConverter: () => ({ convertFiat: (n: number) => n, getCurrencySymbol: () => '$' }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: mocks.send } }));
vi.mock('@/shared/utils/converter', () => ({ buildSignatureAndCoseKey: mocks.buildSignature }));
vi.mock('@cardano-sdk/crypto', async original => ({ ...(await original<object>()), Bip32PrivateKey: { fromBytes: mocks.fromBytes } }));
vi.mock('@/shared/utils/ledger', () => ({ default: {} }));
vi.mock('@/shared/utils/trezorDispatch', () => ({ dispatchTrezor: vi.fn() }));
vi.mock('@/shared/utils/keystone', () => ({ createKeystoneDataSignRequest: vi.fn(), createKeystoneSignRequest: vi.fn(), parseDataSignature: vi.fn(), parseSignature: vi.fn() }));
vi.mock('@/plugins/hardwareLoading', () => ({ default: { begin: vi.fn(), end: vi.fn() } }));
vi.mock('@/api/cardano-shield-api', () => ({ default: { scanTx: vi.fn() } }));
vi.mock('@/shared/components/TransactionDetailsCard.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/components/TxApprovalIntents.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./KeystoneSignSheet.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/modules/dashboard/dialogs/ShieldedProvingConsentDialog.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./BottomSheet.vue', () => ({ default: { template: '<section><slot /><slot name="footer" /></section>' } }));

import DAppOverlay from './DAppOverlay.vue';
import WalletStore from '@/stores/walletStore';
import { useDAppOverlay } from '../composables/useDAppOverlay';
import { MessageTypes } from '@/models/MessageTypes';
import { Blockchain, Network, WalletType } from '@/models/types';

// Synthetic enterprise address from a fixed public payment-key hash.
const ADDRESS = Cardano.Address.fromBytes(HexBlob(`61${'01'.repeat(28)}`)).toBech32();
const overlay = useDAppOverlay();
const request = (id = 'request-1') => ({ requestId: id, method: 'signData', payload: { website: 'https://dapp.example', address: ADDRESS, payload: id === 'request-1' ? '6869' : '627965' } });
const signature = { signature: 'signed-message', key: 'public-key' };
// The account public key the stub root key derives, and the record's xpub over it.
const ACCOUNT_PUBLIC_KEY = 'ab'.repeat(64);
const accountXpub = (publicKeyHex: string) => bech32.encode('xpub', bech32.toWords(Buffer.from(publicKeyHex, 'hex')), 1023);
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.validate.mockReset().mockResolvedValue(undefined);
  mocks.send.mockReset().mockResolvedValue({ data: signature });
  mocks.buildSignature.mockReturnValue(signature);
  const signingKey = {};
  const key = { derive: vi.fn(), toRawKey: () => signingKey, toPublic: () => ({ hex: () => ACCOUNT_PUBLIC_KEY }) };
  key.derive.mockReturnValue(key);
  mocks.fromBytes.mockReturnValue(key);
  WalletStore.state.loggedWallet = {
    id: 1, type: WalletType.Normal, chain: Blockchain.CARDANO, network: Network.MAINNET, encryptionMethod: 'password',
    publicKey: accountXpub(ACCOUNT_PUBLIC_KEY),
  } as never;
  WalletStore.state.keys = { payment: [{ address: ADDRESS, path: "m/1852'/1815'/0'/0/0" }], change: [], stake: [] } as never;
  WalletStore.state.isLocked = false;
  overlay.currentRequest.value = request() as never;
  overlay.isVisible.value = true;
  vi.stubGlobal('chrome', { runtime: { getURL: (path: string) => `chrome-extension://test-extension/${path}` } });
  vi.spyOn(window, 'open').mockReturnValue(null);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function render() {
  return mount(DAppOverlay, { global: {
    stubs: { ...dialogControls(async () => ({ valid: true, errors: [] })), 'v-tooltip': true, 'v-progress-linear': true },
    config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
  } });
}
type View = ReturnType<typeof render>;
const button = (wrapper: View, label: string) => wrapper.findAll('button').find(entry => entry.text() === `miniGero.${label}`)!;
async function signPassword(wrapper: View) {
  await wrapper.find('[data-label="miniGero.spendingPassword"]').setValue('password');
  await button(wrapper, 'sign').trigger('click');
}
type Change = 'cancel' | 'request' | 'payload' | 'wallet' | 'network' | 'lock' | 'unmount';
async function interrupt(wrapper: View, change: Change) {
  if (change === 'cancel') await button(wrapper, 'reject').trigger('click');
  if (change === 'request') overlay.currentRequest.value = request('request-2') as never;
  if (change === 'payload') (overlay.currentRequest.value!.payload as { payload: string }).payload = '627965';
  if (change === 'wallet') WalletStore.state.loggedWallet = { ...WalletStore.state.loggedWallet, id: 2 };
  if (change === 'network') WalletStore.state.loggedWallet = { ...WalletStore.state.loggedWallet, network: Network.PREPROD };
  if (change === 'lock') WalletStore.state.isLocked = true;
  if (change === 'unmount') wrapper.unmount();
  await nextTick();
}
function finishPassKey() {
  window.dispatchEvent(new MessageEvent('message', {
    origin: new URL(chrome.runtime.getURL('')).origin,
    data: { type: 'PASSKEY_AUTH_RESULT', payload: { success: true, privateKeyBytes: [1, 2, 3] } },
  }));
}

describe('dApp sign-data authorization freshness', () => {
  it('runs repeated password clicks in one flight and signs only the approved payload', async () => {
    const validation = deferred<void>();
    mocks.validate.mockReturnValueOnce(validation.promise);
    const wrapper = render();
    await signPassword(wrapper);
    await button(wrapper, 'sign').trigger('click');
    expect(mocks.validate).toHaveBeenCalledTimes(1);
    expect(mocks.send).not.toHaveBeenCalled();
    validation.resolve();
    await flushPromises();
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ method: MessageTypes.SIGN_DATA, data: {
      address: ADDRESS, payload: '6869', password: 'password', cip45Authorization: undefined, isUsb: true,
    } });
    expect(mocks.approve).toHaveBeenCalledExactlyOnceWith(signature);
  });

  it.each(['cancel', 'request', 'payload', 'wallet', 'network', 'lock', 'unmount'] as const)(
    'never dispatches a signature if %s happens during CIP45 validation', async change => {
      const validation = deferred<void>();
      mocks.validate.mockReturnValueOnce(validation.promise);
      const wrapper = render();
      await signPassword(wrapper);
      expect(mocks.validate).toHaveBeenCalledTimes(1);
      await interrupt(wrapper, change);
      validation.resolve();
      await flushPromises();
      expect(mocks.send).not.toHaveBeenCalled();
      expect(mocks.approve).not.toHaveBeenCalled();
    },
  );

  it('requires a fresh explicit approval after replacing a pending request', async () => {
    const validation = deferred<void>();
    mocks.validate.mockReturnValueOnce(validation.promise);
    const wrapper = render();
    await signPassword(wrapper);
    await interrupt(wrapper, 'request');
    validation.resolve();
    await flushPromises();
    expect(mocks.send).not.toHaveBeenCalled();
    await signPassword(wrapper);
    await flushPromises();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: '627965' }) }));
    expect(mocks.approve).toHaveBeenCalledExactlyOnceWith(signature);
  });

  it('does not publish a signature returned after cancellation', async () => {
    const response = deferred<{ data: typeof signature }>();
    mocks.send.mockReturnValueOnce(response.promise);
    const wrapper = render();
    await signPassword(wrapper);
    await flushPromises();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    await interrupt(wrapper, 'cancel');
    response.resolve({ data: signature });
    await flushPromises();
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.validate).toHaveBeenCalledTimes(1);
  });

  it('authenticates once on repeated PassKey clicks and signs the current request', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    WalletStore.state.loggedWallet.encryptionMethod = 'prf';
    const wrapper = render();
    await button(wrapper, 'sign').trigger('click');
    await flushPromises();
    await button(wrapper, 'sign').trigger('click');
    expect(window.open).toHaveBeenCalledTimes(1);
    finishPassKey();
    await vi.waitFor(() => expect(mocks.approve).toHaveBeenCalledExactlyOnceWith(signature));
    expect(mocks.buildSignature).toHaveBeenCalledTimes(1);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('refuses to sign with PassKey when the derived account key is not the wallet’s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    WalletStore.state.loggedWallet = {
      ...WalletStore.state.loggedWallet, encryptionMethod: 'prf', publicKey: accountXpub('cd'.repeat(64)),
    } as never;
    const wrapper = render();
    await button(wrapper, 'sign').trigger('click');
    await flushPromises();
    finishPassKey();
    await flushPromises();
    expect(mocks.fromBytes).toHaveBeenCalledTimes(1);
    expect(mocks.buildSignature).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'request', 'payload', 'wallet', 'network', 'lock', 'unmount'] as const)(
    'never builds a signature if %s happens during PassKey authentication', async change => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      WalletStore.state.loggedWallet.encryptionMethod = 'prf';
      const wrapper = render();
      await button(wrapper, 'sign').trigger('click');
      await flushPromises();
      expect(window.open).toHaveBeenCalledTimes(1);
      await interrupt(wrapper, change);
      finishPassKey();
      await flushPromises();
      expect(mocks.fromBytes).not.toHaveBeenCalled();
      expect(mocks.buildSignature).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
      expect(mocks.approve).not.toHaveBeenCalled();
    },
  );
});
