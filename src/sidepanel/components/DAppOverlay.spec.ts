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
  ledgerSignData: vi.fn(), knownAddresses: vi.fn(), ledgerError: vi.fn(),
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
vi.mock('@/shared/utils/ledger', () => ({ default: {
  signData: mocks.ledgerSignData, createKnownAddressesFromKeys: mocks.knownAddresses, ledgerErrorHandling: mocks.ledgerError,
} }));
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
import { geroStore } from '@/stores/geroStore';
import { useDAppOverlay } from '../composables/useDAppOverlay';
import { MessageTypes } from '@/models/MessageTypes';
import { Blockchain, Network, WalletType } from '@/models/types';
import networks from '@/utils/networks';

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

// A Ledger signs CIP-8 data on the device, from the panel, as the popup does. It used
// to go to the background's SIGN_DATA, which signs with the root key and a password
// and has no Ledger branch (issue 1329).
describe('dApp sign-data with a Ledger', () => {
  const KNOWN = [{ address: ADDRESS }];
  beforeEach(() => {
    WalletStore.state.loggedWallet = { ...WalletStore.state.loggedWallet, type: WalletType.Ledger, encryptionMethod: undefined } as never;
    mocks.knownAddresses.mockReturnValue(KNOWN);
    mocks.ledgerSignData.mockReset().mockResolvedValue({ signatureHex: 'cose-sign1', signingPublicKeyHex: 'cose-key', addressFieldHex: '61' });
  });

  it('signs on the device with the account the key set is at, and approves its COSE signature and key', async () => {
    WalletStore.state.keys = { payment: [{ address: ADDRESS, path: "m/1852'/1815'/2'/0/0" }], change: [], stake: [] } as never;
    const wrapper = render();
    await button(wrapper, 'sign').trigger('click');
    await flushPromises();

    const network = networks.resolveNetwork(Blockchain.CARDANO, Network.MAINNET);
    expect(mocks.knownAddresses).toHaveBeenCalledWith(WalletStore.state.keys, network);
    expect(mocks.ledgerSignData).toHaveBeenCalledExactlyOnceWith(ADDRESS, '6869', network, 2, true, KNOWN);
    expect(mocks.approve).toHaveBeenCalledExactlyOnceWith({ signature: 'cose-sign1', key: 'cose-key' });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('shows the device error and approves nothing when the Ledger refuses', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const refusal = new Error('Action rejected by user');
    mocks.ledgerSignData.mockRejectedValue(refusal);
    const wrapper = render();
    await button(wrapper, 'sign').trigger('click');
    await flushPromises();

    expect(mocks.ledgerError).toHaveBeenCalledWith(refusal);
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('never publishes a device signature once the request is cancelled', async () => {
    const response = deferred<{ signatureHex: string; signingPublicKeyHex: string }>();
    mocks.ledgerSignData.mockReturnValueOnce(response.promise);
    const wrapper = render();
    await button(wrapper, 'sign').trigger('click');
    await flushPromises();
    await interrupt(wrapper, 'cancel');
    response.resolve({ signatureHex: 'cose-sign1', signingPublicKeyHex: 'cose-key' });
    await flushPromises();

    expect(mocks.approve).not.toHaveBeenCalled();
  });
});

describe('dApp connect: the account to connect (#1331)', () => {
  const wallet = { chain: Blockchain.CARDANO, network: Network.MAINNET, type: WalletType.Normal };
  const GROUP = {
    1: { id: 1, name: 'Main', ...wallet },
    2: { id: 2, name: 'Account #1', accountIndex: 1, parentWalletId: 1, ...wallet },
    3: { id: 3, name: 'Account #2', accountIndex: 2, parentWalletId: 1, ...wallet },
  };
  const connect = (method: 'enable' | 'midnight_connect', id = 'connect-1') =>
    ({ requestId: id, method, payload: { website: 'https://dapp.example' } });
  const rows = (wrapper: View) => wrapper.findAll('[role="radio"]');
  const row = (wrapper: View, name: string) => rows(wrapper).find((entry) => entry.text().includes(name))!;

  beforeEach(() => {
    geroStore.wallets = { ...GROUP } as never;
    overlay.currentRequest.value = connect('enable') as never;
  });
  afterEach(() => { geroStore.wallets = {}; });

  it('offers every account of the logged wallet, the logged one chosen', async () => {
    const wrapper = render();
    await flushPromises();

    expect(rows(wrapper).map((entry) => entry.attributes('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(wrapper.text()).not.toContain('accounts.connectSwitches');
    await button(wrapper, 'approve').trigger('click');
    expect(mocks.approve).toHaveBeenCalledExactlyOnceWith({ accountId: 1 });
  });

  it.each(['enable', 'midnight_connect'] as const)('names the account the user picked (%s)', async (method) => {
    overlay.currentRequest.value = connect(method) as never;
    const wrapper = render();
    await row(wrapper, 'Account #2').trigger('click');

    expect(row(wrapper, 'Account #2').attributes('aria-checked')).toBe('true');
    expect(wrapper.text()).toContain('accounts.connectSwitches');
    await button(wrapper, 'approve').trigger('click');
    expect(mocks.approve).toHaveBeenCalledExactlyOnceWith({ accountId: 3 });
  });

  it('starts each new request on the logged account again', async () => {
    const wrapper = render();
    await row(wrapper, 'Account #1').trigger('click');
    overlay.currentRequest.value = connect('enable', 'connect-2') as never;
    await nextTick();

    await button(wrapper, 'approve').trigger('click');
    expect(mocks.approve).toHaveBeenCalledExactlyOnceWith({ accountId: 1 });
  });

  it('asks nothing for a wallet with one account, and answers true as before', async () => {
    geroStore.wallets = { 1: GROUP[1] } as never;
    const wrapper = render();

    expect(rows(wrapper)).toHaveLength(0);
    await button(wrapper, 'approve').trigger('click');
    expect(mocks.approve).toHaveBeenCalledExactlyOnceWith(true);
  });
});
