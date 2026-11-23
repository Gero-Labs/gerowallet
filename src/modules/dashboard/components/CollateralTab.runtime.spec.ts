import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';

const api = vi.hoisted(() => ({ build: vi.fn(), error: vi.fn() }));
vi.mock('@/api/nexus-tx-api', () => ({
  nexusTxApi: { buildTransferTx: api.build }, walletUtxosToNexusInputs: () => [],
}));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: api.error } }));
vi.mock('@/shared/utils/autoWithdraw', () => ({ currentRewardWithdrawals: () => [] }));
vi.mock('@/shared/composables/useFeatureNotifications', () => ({ isFeatureNew: () => false, markFeatureAsSeen: vi.fn() }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/utils/filters', () => ({ default: { toCurrency: (amount: string) => amount } }));
vi.mock('@/shared/composables/useTransactionSigning', () => ({
  useTransactionSigning: () => ({
    loading: false, valid: true, isPrfWallet: false, isSubmit: false, overlay: false,
    keystoneType: '', keystoneCbor: '', resetState: vi.fn(),
  }),
}));
vi.mock('@/stores/walletStore', async () => ({
  walletStore: (await import('vue')).reactive({
    loggedWallet: { id: 1, chain: 'Cardano', network: 'MAINNET', accountIndex: 0, baseAddress: '', type: 'normal' },
    utxos: [], keys: { payment: [{ address: '' }] }, collateral: null, isLocked: false,
  }),
}));

import { walletStore } from '@/stores/walletStore';
import CollateralTab from './CollateralTab.vue';

const own = Cardano.PaymentAddress(Cardano.Address.fromBytes(HexBlob('61' + '11'.repeat(28))).toBech32());
const other = Cardano.PaymentAddress(Cardano.Address.fromBytes(HexBlob('61' + '22'.repeat(28))).toBech32());
const tokens = new Map([[Cardano.AssetId('aa'.repeat(28) + '01'), 1n]]);
const output = (coins: bigint, assets?: Cardano.TokenMap, address = own): Cardano.TxOut => ({ address, value: { coins, assets } });
const build = (outputs: Cardano.TxOut[]) => ({
  tx_cbor: Serialization.Transaction.fromCore({
    id: Cardano.TransactionId('00'.repeat(32)), body: { inputs: [], outputs, fee: 180000n }, witness: { signatures: new Map() },
  }).toCbor(),
});

const slot = { template: '<div><slot /></div>' };
const button = { template: '<button><slot /></button>' };
function mountTab() {
  const wrappers = ['VWindowItem', 'VCard', 'VCardTitle', 'VCardSubtitle', 'VCardText', 'VAlert', 'VCardActions', 'VRow', 'VCol', 'VTooltip', 'VIcon'];
  return mount(CollateralTab, { global: {
    mocks: { $t: (key: string) => key },
    stubs: {
      ...Object.fromEntries(wrappers.map(name => [name, slot])),
      VBtn: button, GButton: button, VForm: { ...slot, methods: { resetValidation() {} } },
      BaseDialog: { props: ['isOpen'], template: '<section v-if="isOpen" class="review"><button class="cancel" @click="$emit(\'close\')">Cancel</button><slot/></section>' },
      TransactionAuthSection: true, KeystoneSignDialog: true, CopyButton: true,
    },
  } });
}

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(walletStore.loggedWallet!, { id: 1, baseAddress: own, accountIndex: 0 });
  walletStore.isLocked = false;
  walletStore.keys!.payment[0].address = own;
});

describe('Set Collateral review', () => {
  it.each([
    ['ADA change first', output(17_000_000n)],
    ['token change at the same amount', output(5_000_000n, tokens)],
  ] as const)('reviews the pure 5 ADA output and fee with %s', async (_, change) => {
    api.build.mockResolvedValue(build([change, output(5_000_000n)]));
    const wrapper = mountTab();
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.get('.review').findAll('strong').map(el => el.text())).toEqual(['5000000', '180000']);
    expect(api.build.mock.calls[0][0].outputs).toEqual([{ address: own, lovelace: '5000000' }]);
  });

  it('keeps the review closed if the wallet has only token change or another address has the pure output', async () => {
    api.build.mockResolvedValue(build([output(5_000_000n, tokens), output(5_000_000n, undefined, other)]));
    const wrapper = mountTab();
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.find('.review').exists()).toBe(false);
    expect(api.error).toHaveBeenCalledWith('settings.failedToBuildCollateral');
  });

  const shortfall = 'Insufficient ADA to cover minimum UTXO for change output containing native tokens.';
  it.each([
    [400, shortfall, 'Transaction Build Failed', 'Request failed', 'settings.insufficientAdaForCollateral'],
    [400, 'Transaction Build Failed', shortfall, 'Request failed', 'settings.insufficientAdaForCollateral'],
    [400, 'Transaction Build Failed', 'Invalid request', shortfall, 'settings.insufficientAdaForCollateral'],
    [400, 'Transaction Build Failed', 'Invalid request', 'Request failed', 'settings.failedToBuildCollateral'],
    [429, shortfall, 'Transaction Build Failed', 'Request failed', 'settings.failedToBuildCollateral'],
  ] as const)('handles HTTP %i with separate message, error and client text', async (status, message, error, client, expected) => {
    api.build.mockRejectedValue({ message: client, response: { status, data: { error, message } } });
    const wrapper = mountTab();
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.find('.review').exists()).toBe(false);
    expect(api.error).toHaveBeenCalledWith(expected);
  });

  it('aborts the pending build on unmount and ignores a late server failure', async () => {
    let reject!: (err: Error) => void;
    api.build.mockImplementation(() => new Promise((_, no) => { reject = no; }));
    const wrapper = mountTab();
    await wrapper.get('button').trigger('click');
    const signal = api.build.mock.calls[0][2].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    wrapper.unmount();
    expect(signal.aborted).toBe(true);
    reject(new Error('late response'));
    await flushPromises();
    expect(api.error).not.toHaveBeenCalled();
  });

  it('discards an old wallet build even after switching back, and allows a fresh review after cancellation', async () => {
    let finish!: (result: ReturnType<typeof build>) => void;
    api.build.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const wrapper = mountTab();
    await wrapper.get('button').trigger('click');
    walletStore.loggedWallet!.id = 2;
    walletStore.loggedWallet!.id = 1;
    finish(build([output(5_000_000n)]));
    await flushPromises();
    expect(wrapper.find('.review').exists()).toBe(false);
    expect(api.error).not.toHaveBeenCalled();

    api.build.mockResolvedValue(build([output(5_000_000n)]));
    await wrapper.get('button').trigger('click');
    await flushPromises();
    await wrapper.get('.cancel').trigger('click');
    expect(wrapper.find('.review').exists()).toBe(false);
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.find('.review').exists()).toBe(true);
    walletStore.isLocked = true;
    await flushPromises();
    expect(wrapper.find('.review').exists()).toBe(false);
  });
});
