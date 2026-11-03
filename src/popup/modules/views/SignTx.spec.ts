import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { deferred, dialogControls } from '@test/helpers/dialogControls';
import { mockGlobalProperties } from '@test/helpers/globalProperties';

const mocks = vi.hoisted(() => ({
  request: vi.fn(), returnData: vi.fn(), ledger: vi.fn(), trezor: vi.fn(), background: vi.fn(),
  authorize: vi.fn(), error: vi.fn(), begin: vi.fn(), end: vi.fn(), setLoading: vi.fn(),
  summary: vi.fn(),
}));
vi.mock('@/chrome/messaging', () => ({ Messaging: {
  createInternalController: () => ({ requestData: mocks.request, returnData: mocks.returnData }),
  sendToBackgroundFromOptions: mocks.background,
} }));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive({
  loggedWallet: {}, isLocked: false, config: { txAutoSubmit: false }, keys: { payment: [], change: [] }, utxos: [],
}) }));
vi.mock('@/stores/featureFlagsStore', async () => ({ featureFlagsStore: (await import('vue')).reactive({ state: { flags: { isTrezorWebUsbEnabled: false } } }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/services/cip45/signingAuthorization', () => ({ validateCip45Signing: mocks.authorize }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: mocks.error } }));
vi.mock('@/plugins/hardwareLoading', () => ({ default: { begin: mocks.begin, end: mocks.end, setLoading: mocks.setLoading } }));
vi.mock('@/shared/utils/ledger', () => ({ default: { txToLedger: mocks.ledger } }));
vi.mock('@/shared/utils/trezorDispatch', () => ({ dispatchTrezor: mocks.trezor }));
vi.mock('@/chrome/cardanoJsSdkCbor', () => ({ deserializeCardanoJsSdkTx: () => ({ body: { inputs: [], outputs: [], fee: 170000n }, witness: {} }) }));
vi.mock('@/shared/utils/txApprovalSummary', () => ({ approvalContextFromKeys: () => ({}), approvalDepositsFrom: () => ({}), approvalMarketContext: () => ({}), buildTxApprovalSummary: () => mocks.summary(), toTransactionDetailsCardProps: () => null }));
vi.mock('@/shared/utils/builder', () => ({ diffAssetsFromIncomingToOutgoing: vi.fn(), getPayAndReceiveTokens: vi.fn() }));
vi.mock('@/shared/utils/keystone', () => ({ createKeystoneSignRequest: vi.fn(), parseSignature: vi.fn() }));
vi.mock('@/api/cardano-shield-api', () => ({ default: { scanTx: vi.fn() } }));
vi.mock('@/utils/rules', () => ({ default: { required: () => () => true } }));
vi.mock('@/popup/modules/components/PopupHeader.vue', () => ({ default: { template: '<main><slot /></main>' } }));
vi.mock('@/popup/modules/components/DappAddress.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/popup/modules/components/TransactionCard.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/popup/modules/components/TransactionRisk.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/components/PassKeyPasswordField.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/components/PassKeyAuthButton.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/components/AnimatedQRCode.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/components/AnimatedQRScanner.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/components/EmbeddedSiteWarning.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/components/CopyButton.vue', () => ({ default: { template: '<div />' } }));
// Stands in for the effects list: its acknowledgement button reports a tick as the real one does.
vi.mock('@/shared/components/TxApprovalIntents.vue', () => ({ default: {
  emits: ['update:marketAck'],
  template: '<div><button data-testid="ack-market" @click="$emit(\'update:marketAck\', true)">ack</button></div>',
} }));
vi.mock('@/shared/components/TransactionDetailsCard.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/shared/components/ToggleSwitch.vue', () => ({ default: { template: '<div />' } }));

import SignTx from './SignTx.vue';
import { walletStore } from '@/stores/walletStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { Blockchain, Network, WalletType } from '@/models/types';
import { TxSignError } from '@/chrome/config';
import { NFT_MARKET_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.summary.mockReset().mockReturnValue({});
  mocks.request.mockResolvedValue({ data: { tx: 'synthetic-cbor-decoder-fixture' } });
  mocks.returnData.mockResolvedValue(undefined);
  mocks.authorize.mockReset().mockResolvedValue(undefined);
  walletStore.loggedWallet = { id: 1, type: WalletType.Ledger, chain: Blockchain.CARDANO, network: Network.PREPROD } as never;
  walletStore.isLocked = false;
  walletStore.config.txAutoSubmit = false;
  featureFlagsStore.state.flags.isTrezorWebUsbEnabled = false;
  vi.spyOn(window, 'close').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
const devices = ['ledger', 'trezor-bridge', 'trezor-webusb'] as const;
async function render(device: typeof devices[number] | 'keystone') {
  walletStore.loggedWallet.type = device === 'ledger' ? WalletType.Ledger : device === 'keystone' ? WalletType.Keystone : WalletType.Trezor;
  featureFlagsStore.state.flags.isTrezorWebUsbEnabled = device === 'trezor-webusb';
  const view = mount(SignTx, { global: {
    stubs: {
      ...dialogControls(async () => ({ valid: true, errors: [] })), 'v-card-subtitle': true, 'v-progress-circular': true, 'v-tooltip': true,
      // A checkbox that reports what the user does, as Vuetify's would.
      'v-checkbox': { props: ['modelValue'], emits: ['update:modelValue'], template: '<input type="checkbox" data-testid="decode-ack" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />' },
    },
    config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key, $route: { query: {} } }) },
  } });
  await flushPromises();
  return view;
}
type View = Awaited<ReturnType<typeof render>>;
const button = (view: View, text: string) => view.findAll('button').find(entry => entry.text() === text)!;

describe.each(devices)('Cardano %s signing busy state', device => {
  const signer = () => device === 'ledger' ? mocks.ledger : device === 'trezor-webusb' ? mocks.trezor : mocks.background;
  it('prevents Decline and window closure while the hardware call is pending, then permits decline after failure', async () => {
    const pending = deferred<never>();
    signer().mockReturnValueOnce(pending.promise);
    const view = await render(device);
    expect(button(view, 'wallet.decline').attributes('disabled')).toBeUndefined();
    await button(view, 'wallet.sign').trigger('click');
    await vi.waitFor(() => expect(signer()).toHaveBeenCalledTimes(1));
    expect(button(view, 'wallet.decline').attributes('disabled')).toBeDefined();
    await button(view, 'wallet.decline').trigger('click');
    expect(mocks.returnData).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
    pending.reject(new Error('Device rejected synthetic test request'));
    await flushPromises();
    expect(button(view, 'wallet.decline').attributes('disabled')).toBeUndefined();
    await button(view, 'wallet.decline').trigger('click');
    expect(mocks.returnData).toHaveBeenCalledExactlyOnceWith({ data: undefined, error: TxSignError.UserDeclined });
    expect(window.close).toHaveBeenCalledTimes(1);
  });

  // The worker refuses a market transaction in fixed English once its dApp approval has run out;
  // the popup must show that in the user's language, as the side panel does.
  it('shows the worker\'s market signing refusal in the user\'s language, not as raw English', async () => {
    signer().mockRejectedValueOnce(new Error(NFT_MARKET_SIGN_REFUSAL_MESSAGE));
    const view = await render(device);
    await button(view, 'wallet.sign').trigger('click');
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
    expect(mocks.error).toHaveBeenCalledWith('This took too long. Start it again.');
    expect(mocks.error).not.toHaveBeenCalledWith(NFT_MARKET_SIGN_REFUSAL_MESSAGE);
  });

  it.each(['wallet', 'network', 'lock', 'unmount'] as const)('still discards a late hardware response after %s changes', async change => {
    const pending = deferred<unknown>();
    signer().mockReturnValueOnce(pending.promise);
    const view = await render(device);
    await button(view, 'wallet.sign').trigger('click');
    await vi.waitFor(() => expect(signer()).toHaveBeenCalledTimes(1));
    if (change === 'wallet') walletStore.loggedWallet = { ...walletStore.loggedWallet, id: 2 };
    if (change === 'network') walletStore.loggedWallet = { ...walletStore.loggedWallet, network: Network.MAINNET };
    if (change === 'lock') walletStore.isLocked = true;
    if (change === 'unmount') view.unmount();
    pending.resolve(device === 'ledger' ? new Map() : { data: { success: true, signatures: [] } });
    await flushPromises();
    expect(mocks.returnData).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalled();
  });
});

describe('Cardano Keystone signing: the worker\'s market signing refusal', () => {
  it('shows the refusal in the user\'s language, not as raw English', async () => {
    // The first authorization is the gate of sign(); the Keystone branch asks again, and is refused.
    mocks.authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error(NFT_MARKET_SIGN_REFUSAL_MESSAGE));
    const view = await render('keystone');
    await button(view, 'wallet.sign').trigger('click');
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
    expect(mocks.error).toHaveBeenCalledWith('This took too long. Start it again.');
  });
});

// A dApp can list the user's NFT with itself as owner and seller, and the worker signs such a
// transaction once the user approves it: Sign waits for an explicit acknowledgement.
describe('Cardano signing: a Gero listing the transaction creates', () => {
  const signButton = (view: View) => view.findAll('button').find(entry => entry.text() === 'wallet.sign')!;

  it('holds Sign until a listing that pays someone else is acknowledged', async () => {
    mocks.summary.mockReturnValue({ requiresMarketAck: true });
    const view = await render('ledger');
    expect(signButton(view).attributes('disabled')).toBeDefined();
    await view.find('[data-testid="ack-market"]').trigger('click');
    expect(signButton(view).attributes('disabled')).toBeUndefined();
  });

  it('does not hold Sign for a transaction with nothing to acknowledge', async () => {
    mocks.summary.mockReturnValue({ requiresMarketAck: false });
    const view = await render('ledger');
    expect(signButton(view).attributes('disabled')).toBeUndefined();
  });
});

// The summary is the user's only view of what they sign. When it cannot be built from a transaction
// that was sent, Sign waits for the same explicit acknowledgement the side panel asks for.
describe('Cardano signing: a transaction whose summary cannot be built', () => {
  const signButton = (view: View) => view.findAll('button').find(entry => entry.text() === 'wallet.sign')!;

  it('holds Sign behind the decode-failed acknowledgement, and lets it through once ticked', async () => {
    mocks.summary.mockReturnValue(null);
    const view = await render('ledger');
    expect(view.find('[data-testid="tx-decode-failed-banner"]').text()).toContain('signTx.decodeFailedTitle');
    expect(signButton(view).attributes('disabled')).toBeDefined();
    await signButton(view).trigger('click');
    expect(mocks.ledger).not.toHaveBeenCalled();
    await view.find('[data-testid="decode-ack"]').setValue(true);
    expect(signButton(view).attributes('disabled')).toBeUndefined();
  });

  it('shows no banner and holds nothing when the summary builds', async () => {
    mocks.summary.mockReturnValue({});
    const view = await render('ledger');
    expect(view.find('[data-testid="tx-decode-failed-banner"]').exists()).toBe(false);
    expect(signButton(view).attributes('disabled')).toBeUndefined();
  });
});
