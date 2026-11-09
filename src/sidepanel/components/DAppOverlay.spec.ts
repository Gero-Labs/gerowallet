import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { bech32 } from 'bech32';
import { Psbt } from 'bitcoinjs-lib';
import { deferred, dialogControls } from '@test/helpers/dialogControls';

const mocks = vi.hoisted(() => ({
  validate: vi.fn(), send: vi.fn(), approve: vi.fn(), reject: vi.fn(),
  buildSignature: vi.fn(), fromBytes: vi.fn(), ready: vi.fn(),
  ledgerSignData: vi.fn(), knownAddresses: vi.fn(), ledgerError: vi.fn(),
}));
vi.mock('@/services/cip45/signingAuthorization', () => ({ validateCip45Signing: mocks.validate }));
// bitcoinjs-lib is externalized to Node by Vitest and checks buffers against Node's
// Buffer, while the sources get the polyfill (see bitcoinSigner.spec.ts).
vi.mock('vite-plugin-node-polyfills/shims/buffer', async () => {
  const { createRequire } = await import('node:module');
  const { Buffer: NodeBuffer } = createRequire(import.meta.url)('node:buffer');
  return { default: NodeBuffer, Buffer: NodeBuffer };
});
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
// As in the real module, the default export's state is the named walletStore.
vi.mock('@/stores/walletStore', async () => {
  const state = (await import('vue')).reactive({
    loggedWallet: {}, isLocked: false, keys: { payment: [], change: [], stake: [] }, utxos: [],
  });
  return { default: { state }, walletStore: state };
});
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
// Stands in for the effects list: its acknowledgement button reports a tick as the real one does.
vi.mock('@/shared/components/TxApprovalIntents.vue', () => ({ default: {
  props: ['summary'],
  emits: ['update:marketAck'],
  template: '<div data-testid="intents-stub"><button data-testid="ack-market" @click="$emit(\'update:marketAck\', true)">ack</button></div>',
} }));
vi.mock('./KeystoneSignSheet.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/modules/dashboard/dialogs/ShieldedProvingConsentDialog.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./BottomSheet.vue', () => ({ default: { template: '<section><slot /><slot name="footer" /></section>' } }));

import * as bitcoin from 'bitcoinjs-lib';
import { createRequire } from 'node:module';
import DAppOverlay from './DAppOverlay.vue';
import WalletStore from '@/stores/walletStore';
import { deriveBitcoinAccountXpub, deriveBitcoinRootKey } from '@/chains/bitcoin/bitcoinKeyManager';
import { geroStore } from '@/stores/geroStore';
import { useDAppOverlay } from '../composables/useDAppOverlay';
import { MessageTypes } from '@/models/MessageTypes';
import { Blockchain, Network, WalletType } from '@/models/types';
import networks from '@/utils/networks';
import { NFT_MARKET_DEPLOYMENTS_PREPROD } from '@/utils/nftMarketDeployments';
import { inlineDatumFromCbor } from '@/shared/utils/utxoCbor';

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

describe('a request from an embedded frame', () => {
  const TAB_ICON = 'https://host.example/favicon.ico';
  const ask = (embeddedIn?: string) => {
    const base = request();
    overlay.currentRequest.value = { ...base, payload: { ...base.payload, favIconUrl: TAB_ICON, embeddedIn } } as never;
  };
  const icons = (wrapper: View) => wrapper.findAll('img').map((img) => img.attributes('src'));

  it('names the embedding site and never shows the top-level tab’s favicon', () => {
    ask('https://host.example');
    const wrapper = render();

    expect(wrapper.text()).toContain('miniGero.embeddedIn');
    expect(icons(wrapper)).not.toContain(TAB_ICON);
  });

  it('keeps the tab’s favicon for a top-level request', () => {
    ask();
    const wrapper = render();

    expect(wrapper.text()).not.toContain('miniGero.embeddedIn');
    expect(icons(wrapper)).toContain(TAB_ICON);
  });
});

describe('Midnight balanceUnsealedTransaction: the approval names who gets paid', () => {
  it('lists each payment of the dapp’s transaction with its recipient', () => {
    const recipient = 'mn_addr_preprod1recipientxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    overlay.currentRequest.value = {
      requestId: 'balance-1', method: 'midnight_balanceUnsealedTransaction',
      payload: { website: 'https://dapp.example', data: {
        tx: 'abcd', contributions: [], payments: [{ token: '0'.repeat(64), amount: '5000000', recipient }],
      } },
    } as never;
    const wrapper = render();

    const payments = wrapper.findAll('[data-testid="midnight-balance-payment"]');
    expect(payments).toHaveLength(1);
    expect(payments[0].text()).toContain(recipient);
    expect(wrapper.text()).toContain('midnight.balanceReview.paymentsHeading');
  });
});

describe('Midnight makeIntent: the approval shows what the wallet gives and asks for', () => {
  const OWN = 'mn_addr_preprod1ownxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  const OTHER = 'mn_addr_preprod1otherxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  const intentRequest = (payFees: boolean) => ({
    requestId: 'intent-1', method: 'midnight_makeIntent',
    payload: { website: 'https://dapp.example', data: {
      desiredInputs: [{ kind: 'unshielded', type: '0'.repeat(64), value: '30000000' }],
      desiredOutputs: [
        { kind: 'unshielded', type: 'ab'.repeat(32), value: '7', recipient: OWN, toSelf: true },
        { kind: 'unshielded', type: 'ab'.repeat(32), value: '2', recipient: OTHER, toSelf: false },
      ],
      options: { intentId: 'random', payFees },
      ttlMinutes: 60,
    } },
  });

  it('lists the give and the wants, and warns only for a want paid to another address', () => {
    overlay.currentRequest.value = intentRequest(true) as never;
    const wrapper = render();

    expect(wrapper.findAll('[data-testid="midnight-intent-give"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="midnight-intent-want"]')).toHaveLength(2);
    const warnings = wrapper.findAll('[data-testid="midnight-intent-want-other"]');
    expect(warnings).toHaveLength(1);
    expect(wrapper.text()).toContain(OTHER);
    expect(wrapper.text()).not.toContain(OWN);
    expect(wrapper.find('[data-testid="midnight-intent-fees"]').text()).toBe('midnight.connector.transferFeesNote');
  });

  it('says the wallet does not pay the fee when the dapp asks it not to', () => {
    overlay.currentRequest.value = intentRequest(false) as never;
    const wrapper = render();
    expect(wrapper.find('[data-testid="midnight-intent-fees"]').text()).toBe('midnight.connector.intentFeesNotPaid');
  });

  it('builds from the request it showed and approves the sealed tx', async () => {
    mocks.send.mockResolvedValue({ data: { success: true, tx: 'sealed-intent' } });
    overlay.currentRequest.value = intentRequest(true) as never;
    const wrapper = render();
    await wrapper.find('[data-label="miniGero.spendingPassword"]').setValue('password');
    await button(wrapper, 'approve').trigger('click');
    await vi.waitFor(() => expect(mocks.approve).toHaveBeenCalledWith({ tx: 'sealed-intent' }));

    const shown = intentRequest(true).payload.data;
    expect(mocks.send).toHaveBeenCalledWith({
      method: 'BUILD_MIDNIGHT_CONNECTOR_INTENT',
      data: {
        desiredInputs: shown.desiredInputs, desiredOutputs: shown.desiredOutputs, options: shown.options,
        password: 'password', prfSecret: undefined,
      },
    });
  });

  it('answers InsufficientFunds, not Rejected, when the user declines after an insufficient-funds build', async () => {
    mocks.send.mockResolvedValue({ data: { success: false, error: 'Not enough funds', code: 'InsufficientFunds' } });
    overlay.currentRequest.value = intentRequest(true) as never;
    const wrapper = render();
    await wrapper.find('[data-label="miniGero.spendingPassword"]').setValue('password');
    await button(wrapper, 'approve').trigger('click');
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalled());
    await flushPromises();

    await button(wrapper, 'reject').trigger('click');
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(JSON.parse(mocks.reject.mock.calls.at(-1)![0])).toMatchObject({ code: 'InsufficientFunds' });
  });
});

describe('dApp Bitcoin PSBT: signing waits on the review', () => {
  const { Buffer: NodeBuffer } = createRequire(import.meta.url)('node:buffer') as typeof import('node:buffer');
  // Fixed test vectors — never used to hold funds.
  const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
  const OTHER_PHRASE = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';
  const pubkey = (phrase: string) => NodeBuffer.from(deriveBitcoinRootKey(phrase).derive("m/84'/0'/0'/0/0").publicKey!);
  const payment = (phrase: string) => bitcoin.payments.p2wpkh({ pubkey: pubkey(phrase) });
  const attacker = payment(OTHER_PHRASE).address!;
  // The wallet's coin and another party's coin, both paid to the attacker.
  const psbtHex = new bitcoin.Psbt()
    .addInput({ hash: NodeBuffer.alloc(32, 1), index: 0, witnessUtxo: { script: payment(PHRASE).output!, value: 50_000 } })
    .addInput({ hash: NodeBuffer.alloc(32, 2), index: 0, witnessUtxo: { script: payment(OTHER_PHRASE).output!, value: 50_000 } })
    .addOutput({ address: attacker, value: 99_000 })
    .toHex();
  const signPsbt = (options?: unknown) => ({
    requestId: 'psbt-1', method: 'btcSignPsbt', payload: { website: 'https://dapp.example', psbtHex, options },
  });

  beforeEach(() => {
    WalletStore.state.loggedWallet = {
      id: 1, type: WalletType.Normal, chain: Blockchain.BITCOIN, network: Network.MAINNET, encryptionMethod: 'password',
      addressType: 'segwit', publicKey: deriveBitcoinAccountXpub(PHRASE, Network.MAINNET, 'segwit', 0),
    } as never;
    mocks.send.mockResolvedValue({ data: { success: true, signedHex: 'signed' } });
  });

  it('shows where the coins go and signs the PSBT it showed', async () => {
    overlay.currentRequest.value = signPsbt() as never;
    const wrapper = render();
    await vi.waitFor(() => expect(wrapper.find('[data-testid="bitcoin-psbt-output"]').exists()).toBe(true));

    expect(wrapper.find('[data-testid="bitcoin-psbt-output"]').text()).toContain(attacker);
    await signPassword(wrapper);
    await flushPromises();
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({
      method: MessageTypes.BITCOIN_DAPP_SIGN_PSBT, data: { psbtHex, options: undefined, password: 'password' },
    });
    expect(mocks.approve).toHaveBeenCalledExactlyOnceWith('signed');
  });

  it('refuses to sign another party’s input, however the site asks', async () => {
    overlay.currentRequest.value = signPsbt({ toSignInputs: [{ index: 1 }] }) as never;
    const wrapper = render();
    await vi.waitFor(() => expect(wrapper.find('[data-testid="bitcoin-psbt-problem"]').exists()).toBe(true));

    expect(wrapper.find('[data-testid="bitcoin-psbt-problem"]').text()).toContain('bitcoin.psbtReview.problemNotOwn');
    await wrapper.find('[data-label="miniGero.spendingPassword"]').setValue('password');
    expect(button(wrapper, 'sign').attributes('disabled')).toBeDefined();
    await button(wrapper, 'sign').trigger('click');
    await flushPromises();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

// The Bitcoin signer decrypts a PassKey wallet's recovery phrase with the raw PRF output
// (WalletBg.signBitcoinDappPsbt / signBitcoinDappMessage). The popup's `privateKey` mode
// answers with the PRF-decrypted private key instead, which cannot open the phrase.
describe('Bitcoin dApp signing with a PassKey', () => {
  // The PSBT spends the wallet's own coin, with its amount: the review lets nothing else be signed.
  const { Buffer: NodeBuffer } = createRequire(import.meta.url)('node:buffer') as typeof import('node:buffer');
  const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow'; // test vector, no funds
  const ownScript = bitcoin.payments.p2wpkh({
    pubkey: NodeBuffer.from(deriveBitcoinRootKey(PHRASE).derive("m/84'/0'/0'/0/0").publicKey!),
  }).output!;
  const psbtHex = new Psbt().addInput({ hash: '01'.repeat(32), index: 0, witnessUtxo: { script: ownScript, value: 2000 } })
    .addOutput({ address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', value: 1000 }).toHex();
  const btcRequests = [
    ['message', { requestId: 'btc-message', method: 'btcSignMessage', payload: { message: 'hello', type: 'bip322-simple' } },
      MessageTypes.BITCOIN_DAPP_SIGN_MESSAGE, { success: true, signature: 'btc-signature' }, 'btc-signature'],
    ['PSBT', { requestId: 'btc-psbt', method: 'btcSignPsbt', payload: { psbtHex, options: { autoFinalized: false } } },
      MessageTypes.BITCOIN_DAPP_SIGN_PSBT, { success: true, signedHex: 'signed-psbt' }, 'signed-psbt'],
  ] as const;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    WalletStore.state.loggedWallet = {
      id: 1, type: WalletType.Normal, chain: Blockchain.BITCOIN, network: Network.MAINNET, encryptionMethod: 'prf',
      addressType: 'segwit', publicKey: deriveBitcoinAccountXpub(PHRASE, Network.MAINNET, 'segwit', 0),
    } as never;
  });

  function finishRawPrf(prfOutput: number[]) {
    window.dispatchEvent(new MessageEvent('message', {
      origin: new URL(chrome.runtime.getURL('')).origin,
      data: { type: 'PASSKEY_AUTH_RESULT', payload: { success: true, prfOutput } },
    }));
  }

  it.each(btcRequests)('signs a %s with the raw PRF output from the PassKey popup', async (_kind, btcRequest, method, reply, approved) => {
    overlay.currentRequest.value = btcRequest as never;
    mocks.send.mockResolvedValue({ data: reply });
    const wrapper = render();
    // A PSBT's Sign waits on the review of what it signs.
    await vi.waitFor(() => expect(button(wrapper, 'sign').attributes('disabled')).toBeUndefined());

    await button(wrapper, 'sign').trigger('click');
    await flushPromises();
    expect(window.open).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('mode=rawPrf'), 'PassKeyAuth', expect.any(String));

    finishRawPrf([9, 8, 7]);
    await vi.waitFor(() => expect(mocks.approve).toHaveBeenCalledExactlyOnceWith(approved));
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ method, data: expect.objectContaining({ privateKeyBytes: [9, 8, 7] }) });
  });
});

// A dApp can list the user's NFT with itself as owner and seller, and the worker signs such a
// transaction once the user approves it (dApp market pass): Sign must wait for an explicit
// acknowledgement of a created listing that pays someone else, and not otherwise.
describe('dApp signTx: a Gero listing the transaction creates', () => {
  const V1 = NFT_MARKET_DEPLOYMENTS_PREPROD[0];
  const OWN_PAYMENT = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c';
  const STAKE = '2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c';
  const STRANGER = '77'.repeat(28);
  const NFT = `${'b'.repeat(56)}${Buffer.from('NFT').toString('hex')}`;
  const key = (hash: string, type = Cardano.CredentialType.KeyHash) => ({ hash: Hash28ByteBase16(hash), type });
  const baseAddress = (payment: string, stake: string, paymentIsScript = false) => Cardano.BaseAddress.fromCredentials(
    Cardano.NetworkId.Testnet, key(payment, paymentIsScript ? Cardano.CredentialType.ScriptHash : Cardano.CredentialType.KeyHash), key(stake),
  ).toAddress().toBech32();
  const OWN = baseAddress(OWN_PAYMENT, STAKE);

  // A listing datum, encoded by hand (the contract's indefinite-length constructors).
  const bstr = (h: string) => `581c${h}`;
  const constr = (index: 0 | 1, fields: string[]) => `${index === 0 ? 'd879' : 'd87a'}9f${fields.join('')}ff`;
  const addressData = (payment: string, stake: string) => constr(0, [constr(0, [bstr(payment)]), constr(0, [constr(0, [constr(0, [bstr(stake)])])])]);
  const datum = (owner: string, sellerPayment: string) =>
    constr(0, [bstr(owner), addressData(sellerPayment, STAKE), '1a017d7840', '9fff', 'd87a80']);

  const signTxRequest = (datumHex: string) => {
    const core = {
      id: '0'.repeat(64),
      body: {
        inputs: [{ txId: '1'.repeat(64), index: 0 }],
        outputs: [
          { address: baseAddress(V1.scriptHash, STAKE, true), value: { coins: 2_000_000n, assets: new Map([[NFT, 1n]]) }, datum: inlineDatumFromCbor(HexBlob(datumHex)) },
          { address: OWN, value: { coins: 9_000_000n } },
        ],
        fee: 200_000n,
      },
      witness: { signatures: new Map() },
    };
    const tx = Serialization.Transaction.fromCore(core as never).toCbor();
    return { requestId: 'tx-market', method: 'signTx', payload: { website: 'https://dapp.example', tx } };
  };

  beforeEach(() => {
    WalletStore.state.loggedWallet = {
      ...WalletStore.state.loggedWallet, network: Network.PREPROD, encryptionMethod: 'prf',
    } as never;
    // The wallet's stake key is what a listing of its own sits under.
    const rewardAddress = Cardano.RewardAddress.fromCredentials(Cardano.NetworkId.Testnet, key(STAKE)).toAddress().toBech32();
    WalletStore.state.keys = { payment: [{ address: OWN, cred: OWN_PAYMENT }], change: [], stake: [{ address: rewardAddress, cred: STAKE }] } as never;
    expect(networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.PREPROD)).toEqual([V1]);
  });

  const sign = (wrapper: View) => wrapper.findAll('button').find(entry => entry.text() === 'miniGero.sign')!;

  it('holds Sign until a listing owned by someone else is acknowledged, then lets it through', async () => {
    overlay.currentRequest.value = signTxRequest(datum(STRANGER, OWN_PAYMENT)) as never;
    const wrapper = render();
    await flushPromises();
    expect(sign(wrapper).attributes('disabled')).toBeDefined();
    await wrapper.find('[data-testid="ack-market"]').trigger('click');
    expect(sign(wrapper).attributes('disabled')).toBeUndefined();
  });

  it('holds Sign for a listing whose seller is someone else, too', async () => {
    overlay.currentRequest.value = signTxRequest(datum(OWN_PAYMENT, STRANGER)) as never;
    const wrapper = render();
    await flushPromises();
    expect(sign(wrapper).attributes('disabled')).toBeDefined();
  });

  it('does not hold Sign for the wallet\'s own plain listing', async () => {
    overlay.currentRequest.value = signTxRequest(datum(OWN_PAYMENT, OWN_PAYMENT)) as never;
    const wrapper = render();
    await flushPromises();
    expect(sign(wrapper).attributes('disabled')).toBeUndefined();
  });

  // Enter in the password field, and every other way into a signer, must wait for the same gate the
  // Sign button does: the button is disabled, but the field's own handler is not the button.
  const signTxCalls = () => mocks.send.mock.calls.filter(([message]) => message?.method === MessageTypes.SIGN_TX);

  it('does not sign on Enter in the password field until the market acknowledgement is ticked', async () => {
    WalletStore.state.loggedWallet = { ...WalletStore.state.loggedWallet, encryptionMethod: 'password' } as never;
    mocks.send.mockResolvedValue({ data: { witnesses: 'a100' } });
    overlay.currentRequest.value = signTxRequest(datum(STRANGER, OWN_PAYMENT)) as never;
    const wrapper = render();
    await flushPromises();
    const input = wrapper.find('[data-label="miniGero.spendingPassword"]');
    await input.setValue('password');
    expect(sign(wrapper).attributes('disabled')).toBeDefined();

    await input.trigger('keyup', { key: 'Enter' });
    await flushPromises();
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(signTxCalls()).toHaveLength(0);
    expect(mocks.approve).not.toHaveBeenCalled();

    await wrapper.find('[data-testid="ack-market"]').trigger('click');
    await input.trigger('keyup', { key: 'Enter' });
    await flushPromises();
    expect(signTxCalls()).toHaveLength(1);
    expect(mocks.approve).toHaveBeenCalledExactlyOnceWith('a100');
  });

  it('starts none of the signers (password, PassKey, Ledger, Trezor, Keystone) while the gate holds', async () => {
    WalletStore.state.loggedWallet = { ...WalletStore.state.loggedWallet, encryptionMethod: 'password' } as never;
    overlay.currentRequest.value = signTxRequest(datum(STRANGER, OWN_PAYMENT)) as never;
    const wrapper = render();
    await flushPromises();
    await wrapper.find('[data-label="miniGero.spendingPassword"]').setValue('password');
    const signers = wrapper.vm as unknown as Record<'signNormal' | 'signPrf' | 'signLedger' | 'signTrezor' | 'signKeystone', () => Promise<unknown>>;
    for (const name of ['signNormal', 'signPrf', 'signLedger', 'signTrezor', 'signKeystone'] as const) {
      await signers[name]();
      await flushPromises();
    }
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it('asks again for the next request: an acknowledgement is not carried over', async () => {
    overlay.currentRequest.value = signTxRequest(datum(STRANGER, OWN_PAYMENT)) as never;
    const wrapper = render();
    await flushPromises();
    await wrapper.find('[data-testid="ack-market"]').trigger('click');
    expect(sign(wrapper).attributes('disabled')).toBeUndefined();
    overlay.currentRequest.value = { ...signTxRequest(datum(STRANGER, OWN_PAYMENT)), requestId: 'tx-market-2' } as never;
    await flushPromises();
    expect(sign(wrapper).attributes('disabled')).toBeDefined();
  });
});
