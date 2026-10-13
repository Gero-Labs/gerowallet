import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { Psbt } from 'bitcoinjs-lib';
import { deferred, dialogControls } from '@test/helpers/dialogControls';
import { mockGlobalProperties } from '@test/helpers/globalProperties';

const mocks = vi.hoisted(() => ({ request: vi.fn(), returnData: vi.fn(), ledger: vi.fn(), trezor: vi.fn(), trezorWeb: vi.fn(), error: vi.fn(), begin: vi.fn(), end: vi.fn() }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { createInternalController: () => ({ requestData: mocks.request, returnData: mocks.returnData }) } }));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive({ loggedWallet: {}, isLocked: false }) }));
vi.mock('@/stores/featureFlagsStore', async () => ({ featureFlagsStore: (await import('vue')).reactive({ state: { flags: { isTrezorWebUsbEnabled: false } } }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: mocks.error } }));
vi.mock('@/plugins/hardwareLoading', () => ({ default: { begin: mocks.begin, end: mocks.end } }));
vi.mock('@/shared/utils/ledger', () => ({ default: { signBitcoinTransaction: mocks.ledger } }));
vi.mock('@/shared/utils/trezor', () => ({ default: { signBitcoinTransaction: mocks.trezor } }));
vi.mock('@/shared/utils/trezorWeb', () => ({ default: { signTransaction: mocks.trezorWeb } }));
vi.mock('@/chains/bitcoin/bitcoinPsbtBuilder', () => ({ getBitcoinNetwork: () => undefined }));
vi.mock('@/utils/rules', () => ({ default: { required: () => () => true } }));
vi.mock('@/popup/modules/components/PopupHeader.vue', () => ({ default: { template: '<main><slot /></main>' } }));
vi.mock('@/shared/components/PassKeyPasswordField.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/components/PassKeyAuthButton.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/components/AnimatedQRCode.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/components/AnimatedQRScanner.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/components/EmbeddedSiteWarning.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/components/ToggleSwitch.vue', () => ({ default: { template: '<div />' } }));

import BitcoinSignPsbt from './BitcoinSignPsbt.vue';
import { walletStore } from '@/stores/walletStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { WalletType } from '@/models/types';

function transaction(value = 1000) {
  return new Psbt().addInput({ hash: '01'.repeat(32), index: 0 })
    .addOutput({ address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', value });
}
const unsigned = transaction().toHex();
const returned = transaction().updateInput(0, { witnessUtxo: { script: transaction().txOutputs[0].script, value: 2000 } }).toHex();
const devices = ['ledger', 'trezor', 'trezorWeb'] as const;
type Device = typeof devices[number];
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.returnData.mockResolvedValue(undefined);
  mocks.request.mockReset().mockResolvedValue({ data: { psbtHex: unsigned, options: { autoFinalized: false } } });
  for (const device of devices) mocks[device].mockReset().mockResolvedValue(returned);
  walletStore.loggedWallet = { id: 1, type: WalletType.Ledger, chain: 'Bitcoin', network: 'Mainnet', addressType: 'native-segwit' } as never;
  walletStore.isLocked = false;
  featureFlagsStore.state.flags.isTrezorWebUsbEnabled = false;
  vi.spyOn(window, 'close').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
async function render(device: Device) {
  walletStore.loggedWallet.type = device === 'ledger' ? WalletType.Ledger : WalletType.Trezor;
  featureFlagsStore.state.flags.isTrezorWebUsbEnabled = device === 'trezorWeb';
  const wrapper = mount(BitcoinSignPsbt, { global: {
    stubs: { ...dialogControls(async () => ({ valid: true, errors: [] })), 'v-card-subtitle': true, 'v-layout': true },
    config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key, $route: { query: { website: 'https://dapp.example' } } }) },
  } });
  await flushPromises();
  return wrapper;
}
type View = Awaited<ReturnType<typeof render>>;
const button = (wrapper: View, label: string) => wrapper.findAll('button').find(entry => entry.text() === label)!;

describe.each(devices)('%s Bitcoin popup device contract', device => {
  it('returns the hardware API raw PSBT without finalizing when explicitly disabled', async () => {
    const finalize = vi.spyOn(Psbt.prototype, 'finalizeAllInputs');
    const wrapper = await render(device);
    await button(wrapper, 'wallet.sign').trigger('click');
    await vi.waitFor(() => expect(mocks.returnData).toHaveBeenCalledExactlyOnceWith({ data: returned }));
    if (device === 'ledger') expect(mocks.ledger).toHaveBeenCalledExactlyOnceWith(unsigned, 'native-segwit', 0, true);
    else expect(mocks[device]).toHaveBeenCalledExactlyOnceWith(unsigned, 'native-segwit');
    expect(finalize).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each([true, undefined])('finalizes the returned PSBT when autoFinalized is %s', async autoFinalized => {
    mocks.request.mockResolvedValue({ data: { psbtHex: unsigned, options: { autoFinalized } } });
    // Device cryptography is outside this component contract. Use a real PSBT
    // to check approval binding, and observe the finalization/extraction API.
    const finalize = vi.spyOn(Psbt.prototype, 'finalizeAllInputs').mockReturnThis();
    const extract = vi.spyOn(Psbt.prototype, 'extractTransaction').mockReturnValue({ toHex: () => 'finalized-transaction' } as never);
    const wrapper = await render(device);
    await button(wrapper, 'wallet.sign').trigger('click');
    await vi.waitFor(() => expect(mocks.returnData).toHaveBeenCalledExactlyOnceWith({ data: 'finalized-transaction' }));
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('rejects a device PSBT that changes the approved transaction', async () => {
    mocks[device].mockResolvedValue(transaction(999).toHex());
    const wrapper = await render(device);
    await button(wrapper, 'wallet.sign').trigger('click');
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
    expect(mocks.returnData).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'wallet', 'network', 'lock', 'unmount'] as const)('drops the hardware result if %s happens during the device roundtrip', async change => {
    const response = deferred<string>();
    mocks[device].mockReturnValueOnce(response.promise);
    const wrapper = await render(device);
    await button(wrapper, 'wallet.sign').trigger('click');
    await vi.waitFor(() => expect(mocks[device]).toHaveBeenCalledTimes(1));
    if (change === 'cancel') {
      const decline = button(wrapper, 'common.decline');
      expect(decline.attributes('disabled')).toBeUndefined();
      await decline.trigger('click');
      expect(mocks.returnData).toHaveBeenCalledWith({ error: { code: 4001, message: 'User rejected the request' } });
    }
    if (change === 'wallet') walletStore.loggedWallet = { ...walletStore.loggedWallet, id: 2 };
    if (change === 'network') walletStore.loggedWallet = { ...walletStore.loggedWallet, network: 'Testnet' };
    if (change === 'lock') walletStore.isLocked = true;
    if (change === 'unmount') wrapper.unmount();
    response.resolve(returned);
    await flushPromises();
    expect(mocks.returnData.mock.calls.filter(([result]) => 'data' in result)).toEqual([]);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });
});
