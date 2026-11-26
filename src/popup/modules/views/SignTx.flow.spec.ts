import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { dialogControls } from '@test/helpers/dialogControls';
import { mockGlobalProperties } from '@test/helpers/globalProperties';

/**
 * The flow diagram on the popup's dApp signing approval: display only, drawn from the request's
 * own transaction and the wallet's UTxOs, and never in the way of a warning or of Sign.
 */
const OWN_ADDR = 'addr_test1qpdmx56dml9qtej5vxhejju492w9pfv7j9270wjh0pfe9hdzqxa4r35qhuqx29n693k4gqukhk3lfw37xkp4egvh6raq4d4rzj';
const EXT_ADDR = 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';
const OWN_TX = 'a'.repeat(64);
const FOREIGN_TX = 'b'.repeat(64);

const mocks = vi.hoisted(() => ({
  request: vi.fn(), returnData: vi.fn(), ledger: vi.fn(), summary: vi.fn(), decode: vi.fn(),
}));
vi.mock('@/chrome/messaging', () => ({ Messaging: {
  createInternalController: () => ({ requestData: mocks.request, returnData: mocks.returnData }),
  sendToBackgroundFromOptions: vi.fn(),
} }));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive({
  loggedWallet: {}, isLocked: false, config: { txAutoSubmit: false },
  keys: { payment: [{ address: 'addr_test1qpdmx56dml9qtej5vxhejju492w9pfv7j9270wjh0pfe9hdzqxa4r35qhuqx29n693k4gqukhk3lfw37xkp4egvh6raq4d4rzj', cred: 'e'.repeat(56) }], change: [] },
  utxos: [],
}) }));
vi.mock('@/stores/featureFlagsStore', async () => ({ featureFlagsStore: (await import('vue')).reactive({ state: { flags: { isTrezorWebUsbEnabled: false } } }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({
  t: (key: string) => key,
  tc: (key: string) => key,
}) }));
// The UTxOs as given: proving them against their creating transactions is covered by its own spec.
vi.mock('@/shared/composables/useProvenApprovalUtxos', async () => {
  const { ref } = await import('vue');
  return { useProvenApprovalUtxos: (_tx: unknown, claimed: unknown) => ({ ownUtxos: claimed, misreported: ref(false) }) };
});
vi.mock('@/services/cip45/signingAuthorization', () => ({ validateCip45Signing: vi.fn() }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn() } }));
vi.mock('@/plugins/hardwareLoading', () => ({ default: { begin: vi.fn(), end: vi.fn(), setLoading: vi.fn() } }));
vi.mock('@/shared/utils/ledger', () => ({ default: { txToLedger: mocks.ledger } }));
vi.mock('@/shared/utils/trezorDispatch', () => ({ dispatchTrezor: vi.fn() }));
vi.mock('@/chrome/cardanoJsSdkCbor', () => ({ deserializeCardanoJsSdkTx: () => mocks.decode() }));
// The real certificate deposits (the flow reads them); the summary itself is the test's.
vi.mock('@/shared/utils/txApprovalSummary', async (original) => ({
  ...(await original<typeof import('@/shared/utils/txApprovalSummary')>()),
  approvalContextFromKeys: () => ({}),
  approvalMarketContext: () => ({}),
  buildTxApprovalSummary: () => mocks.summary(),
  toTransactionDetailsCardProps: () => null,
}));
vi.mock('@/shared/utils/builder', () => ({ diffAssetsFromIncomingToOutgoing: vi.fn(), getPayAndReceiveTokens: () => ({ payTokens: [], receiveTokens: [] }) }));
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
vi.mock('@/shared/components/TxApprovalIntents.vue', () => ({ default: {
  emits: ['update:marketAck'],
  template: '<div data-testid="intents"><button data-testid="ack-market" @click="$emit(\'update:marketAck\', true)">ack</button></div>',
} }));
vi.mock('@/shared/components/TransactionDetailsCard.vue', () => ({ default: { template: '<div data-testid="details-card" />' } }));
vi.mock('@/shared/components/ToggleSwitch.vue', () => ({ default: { template: '<div />' } }));

import SignTx from './SignTx.vue';
import { walletStore } from '@/stores/walletStore';
import { Blockchain, Network, WalletType } from '@/models/types';

// happy-dom lays nothing out; the diagram draws its boxes only once its container has a width.
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 360 });
});
afterEach(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
});

const txIn = (txId: string, index: number) => ({ txId, index });
const txOut = (address: string, coins: bigint) => ({ address, value: { coins } });
const requestTx = (inputs: ReturnType<typeof txIn>[]) => ({
  body: { inputs, outputs: [txOut(EXT_ADDR, 5_000_000n), txOut(OWN_ADDR, 4_800_000n)], fee: 200_000n },
  witness: {},
});

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.summary.mockReset().mockReturnValue({});
  mocks.decode.mockReset().mockReturnValue(requestTx([txIn(OWN_TX, 0)]));
  mocks.request.mockResolvedValue({ data: { tx: 'synthetic-cbor-decoder-fixture' } });
  mocks.returnData.mockResolvedValue(undefined);
  walletStore.loggedWallet = { id: 1, type: WalletType.Ledger, chain: Blockchain.CARDANO, network: Network.PREPROD } as never;
  walletStore.utxos = [[{ txId: OWN_TX, index: 0, address: OWN_ADDR }, txOut(OWN_ADDR, 10_000_000n)]] as never;
  vi.spyOn(window, 'close').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function render() {
  const view = mount(SignTx, { global: {
    stubs: {
      ...dialogControls(async () => ({ valid: true, errors: [] })), 'v-card-subtitle': true, 'v-progress-circular': true, 'v-tooltip': true,
      'v-checkbox': { props: ['modelValue'], emits: ['update:modelValue'], template: '<input type="checkbox" data-testid="decode-ack" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />' },
    },
    config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key, $route: { query: {} } }) },
  } });
  await flushPromises();
  return view;
}
type View = Awaited<ReturnType<typeof render>>;
const signButton = (view: View) => view.findAll('button').find((entry) => entry.text() === 'wallet.sign')!;
const flow = (view: View) => view.find('[data-testid="tx-approval-flow"]');

describe('popup dApp approval: the flow diagram', () => {
  it('draws the wallet\'s own input with its value and the outputs and fee', async () => {
    const view = await render();
    expect(flow(view).exists()).toBe(true);
    const boxes = flow(view).findAll('.tx-flow__box');
    expect(boxes.map((box) => box.classes().find((name) => name.startsWith('tx-flow__box--')))).toEqual([
      'tx-flow__box--own', 'tx-flow__box--other', 'tx-flow__box--own', 'tx-flow__box--fee',
    ]);
    expect(boxes[0].text()).toContain('10');
    expect(flow(view).find('.tx-flow__box--unknown').exists()).toBe(false);
  });

  it('shows an input the wallet cannot resolve as "value unknown", never as 0', async () => {
    mocks.decode.mockReturnValue(requestTx([txIn(OWN_TX, 0), txIn(FOREIGN_TX, 2)]));
    const view = await render();
    const unknown = flow(view).find('.tx-flow__box--unknown');
    expect(unknown.exists()).toBe(true);
    expect(unknown.text()).toContain('transactions.flow.unknownInput');
    expect(unknown.text()).toContain('transactions.flow.unknownValue');
    expect(unknown.text()).not.toMatch(/\b0([.,]0+)?\b/);
  });

  it('draws nothing when the transaction does not parse, and the decode-failed hold still stands', async () => {
    // The request's CBOR yields no transaction body: no summary, no model.
    mocks.decode.mockReturnValue({});
    mocks.summary.mockReturnValue(null);
    const view = await render();
    expect(flow(view).exists()).toBe(false);
    expect(view.find('[data-testid="tx-decode-failed-banner"]').exists()).toBe(true);
    expect(signButton(view).attributes('disabled')).toBeDefined();
  });

  it('sits after the warnings and leaves the market acknowledgement holding Sign', async () => {
    mocks.summary.mockReturnValue({ requiresMarketAck: true });
    const view = await render();
    const html = view.html();
    expect(flow(view).exists()).toBe(true);
    expect(html.indexOf('data-testid="details-card"')).toBeLessThan(html.indexOf('data-testid="tx-approval-flow"'));
    expect(html.indexOf('data-testid="intents"')).toBeLessThan(html.indexOf('data-testid="tx-approval-flow"'));
    expect(signButton(view).attributes('disabled')).toBeDefined();
    // Using the diagram (collapsing it) never touches the hold.
    await flow(view).find('.tx-approval-flow__toggle').trigger('click');
    expect(flow(view).find('.tx-flow').exists()).toBe(false);
    expect(signButton(view).attributes('disabled')).toBeDefined();
    await view.find('[data-testid="ack-market"]').trigger('click');
    expect(signButton(view).attributes('disabled')).toBeUndefined();
  });
});
