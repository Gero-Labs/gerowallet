// A PassKey Bitcoin wallet signs dApp requests with its recovery phrase, which the
// background decrypts with the PassKey's raw PRF output (WalletBg.signBitcoinDappPsbt /
// signBitcoinDappMessage → decryptMnemonicWithPrfOutput). PassKeyAuthButton's `success`
// carries the PRF-decrypted private key instead, which cannot open the phrase. These pin
// that both popup views send the raw PRF output (`prf-output`) and never that key.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import * as bitcoin from 'bitcoinjs-lib';
import { createRequire } from 'node:module';
import { dialogControls } from '@test/helpers/dialogControls';
import { mockGlobalProperties } from '@test/helpers/globalProperties';

const mocks = vi.hoisted(() => ({ request: vi.fn(), returnData: vi.fn(), send: vi.fn(), error: vi.fn() }));
vi.mock('@/chrome/messaging', () => ({ Messaging: {
  createInternalController: () => ({ requestData: mocks.request, returnData: mocks.returnData }),
  sendToBackgroundFromOptions: mocks.send,
} }));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive({ loggedWallet: {}, isLocked: false }) }));
vi.mock('@/stores/featureFlagsStore', async () => ({ featureFlagsStore: (await import('vue')).reactive({ state: { flags: {} } }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: mocks.error } }));
vi.mock('@/plugins/hardwareLoading', () => ({ default: { begin: vi.fn(), end: vi.fn() } }));
vi.mock('@/shared/utils/ledger', () => ({ default: {} }));
vi.mock('@/shared/utils/trezor', () => ({ default: {} }));
vi.mock('@/shared/utils/trezorWeb', () => ({ default: {} }));
// bitcoinjs-lib is externalized to Node by Vitest and checks buffers against Node's
// Buffer, while the sources get the polyfill (see bitcoinSigner.spec.ts).
vi.mock('vite-plugin-node-polyfills/shims/buffer', async () => {
  const { createRequire: requireFrom } = await import('node:module');
  const { Buffer } = requireFrom(import.meta.url)('node:buffer');
  return { default: Buffer, Buffer };
});
vi.mock('@/utils/rules', () => ({ default: { required: () => () => true } }));
vi.mock('@/popup/modules/components/PopupHeader.vue', () => ({ default: { template: '<main><slot /></main>' } }));
vi.mock('@/shared/components/PassKeyPasswordField.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/components/PassKeyAuthButton.vue', () => ({ default: {
  name: 'PassKeyAuthButtonStub', emits: ['prf-output', 'success', 'error'], template: '<div />',
} }));
vi.mock('@/shared/components/AnimatedQRCode.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/components/AnimatedQRScanner.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/components/EmbeddedSiteWarning.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/components/ToggleSwitch.vue', () => ({ default: { template: '<div />' } }));

import BitcoinSignMessage from './BitcoinSignMessage.vue';
import BitcoinSignPsbt from './BitcoinSignPsbt.vue';
import { walletStore } from '@/stores/walletStore';
import { MessageTypes } from '@/models/MessageTypes';
import { WalletType } from '@/models/types';
import { deriveBitcoinAccountXpub, deriveBitcoinRootKey } from '@/chains/bitcoin/bitcoinKeyManager';

// The PSBT spends the wallet's own coin, with its amount: the review lets nothing else be signed.
const { Buffer: NodeBuffer } = createRequire(import.meta.url)('node:buffer') as typeof import('node:buffer');
const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow'; // test vector, no funds
const OWN_SCRIPT = bitcoin.payments.p2wpkh({
  pubkey: NodeBuffer.from(deriveBitcoinRootKey(PHRASE).derive("m/84'/0'/0'/0/0").publicKey!),
}).output!;
const PSBT = new bitcoin.Psbt().addInput({ hash: '01'.repeat(32), index: 0, witnessUtxo: { script: OWN_SCRIPT, value: 2000 } })
  .addOutput({ address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', value: 1000 }).toHex();

const views = [
  { name: 'message', component: BitcoinSignMessage, method: MessageTypes.BITCOIN_DAPP_SIGN_MESSAGE,
    request: { data: { message: 'hello', type: 'bip322-simple' } }, reply: { success: true, signature: 'sig' } },
  { name: 'PSBT', component: BitcoinSignPsbt, method: MessageTypes.BITCOIN_DAPP_SIGN_PSBT,
    request: { data: { psbtHex: PSBT, options: { autoFinalized: false } } }, reply: { success: true, signedHex: 'signed' } },
] as const;

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.returnData.mockResolvedValue(undefined);
  walletStore.loggedWallet = {
    id: 1, type: WalletType.Normal, chain: 'Bitcoin', network: 'Mainnet', addressType: 'segwit',
    publicKey: deriveBitcoinAccountXpub(PHRASE, 'Mainnet', 'segwit', 0),
    encryptionMethod: 'prf', webAuthnCredentialId: 'credential', prfEncryptedPrivateKey: 'encrypted-key',
  } as never;
  walletStore.isLocked = false;
  vi.spyOn(window, 'close').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function render(view: typeof views[number]) {
  mocks.request.mockResolvedValue(view.request);
  mocks.send.mockResolvedValue({ data: view.reply });
  const wrapper = mount(view.component, { global: {
    stubs: { ...dialogControls(async () => ({ valid: true, errors: [] })), 'v-card-subtitle': true, 'v-layout': true },
    config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key, $route: { query: { website: 'https://dapp.example' } } }) },
  } });
  await flushPromises();
  // A PSBT is signed only once the review of what it signs is in.
  if (view.name === 'PSBT') {
    await vi.waitFor(() => expect(wrapper.find('[data-testid="bitcoin-psbt-signed-input"]').exists()).toBe(true));
  }
  return wrapper;
}

const passKey = (wrapper: VueWrapper) => wrapper.findComponent({ name: 'PassKeyAuthButtonStub' });

describe.each(views)('Bitcoin $name popup with a PassKey wallet', view => {
  it('signs with the raw PRF output and wipes the decrypted key', async () => {
    const wrapper = await render(view);
    const decryptedKey = new Uint8Array([1, 2, 3]);

    // PassKeyAuthButton emits the raw PRF output first, then the key it decrypted with it.
    passKey(wrapper).vm.$emit('prf-output', new Uint8Array([9, 8, 7]));
    passKey(wrapper).vm.$emit('success', decryptedKey);

    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.send).toHaveBeenCalledWith({ method: view.method, data: expect.objectContaining({ privateKeyBytes: [9, 8, 7] }) });
    expect(Array.from(decryptedKey)).toEqual([0, 0, 0]);
  });

  it('signs nothing when the PassKey gave no raw PRF output', async () => {
    const wrapper = await render(view);
    passKey(wrapper).vm.$emit('success', new Uint8Array([1, 2, 3]));

    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
