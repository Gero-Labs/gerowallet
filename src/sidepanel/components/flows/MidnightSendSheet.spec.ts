import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEDGER8_PROTOCOL_VERSION as L8, LEDGER9_PROTOCOL_VERSION_SAMPLE as L9, useMidnightChains } from '@test/helpers/midnightChains';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { deferred, dialogControls } from '@test/helpers/dialogControls';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { Network, WalletType } from '@/models/types';
import { MidnightDustFeeShortfall } from '@/chains/midnight/midnightFeeCapacity';

const mocks = vi.hoisted(() => ({ send: vi.fn(), pending: vi.fn(), success: vi.fn(), consent: vi.fn(), register: vi.fn(), error: vi.fn(),
  canRecoverNativeRegistration: { value: true }, nativeRegistrationConfirmedAt: { value: 0 } }));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive({ loggedWallet: {}, isLocked: false }) }));
vi.mock('@/stores/geroStore', async () => ({ geroStore: (await import('vue')).reactive({ wallets: {} }) }));
vi.mock('@/stores/midnightStore', async () => ({ midnightStore: (await import('vue')).reactive({
  balances: { nightUnshielded: 10_000_000n }, utxos: [], addresses: {}, dustState: null,
  proofServer: { mode: 'local' }, shieldedProvingConsent: null,
}) }));
vi.mock('@/services/midnight-tx.service', () => ({ sendUnshieldedNight: mocks.send, addPendingMidnightTx: mocks.pending, registerNightForDust: mocks.register }));
vi.mock('@/chains/midnight/midnightProvingConsent', () => ({ hasMidnightProvingConsent: mocks.consent }));
vi.mock('@/chains/midnight/midnightSponsorLinks', () => ({
  loadSponsorLinks: vi.fn(async () => []), linkFor: vi.fn(), saveSponsorLink: vi.fn(), recordSponsoredTx: vi.fn(),
}));
vi.mock('@/shared/composables/useMidnightDustLive', async () => {
  const { ref } = await import('vue');
  const canRecoverNativeRegistration = ref(true);
  const nativeRegistrationConfirmedAt = ref(0);
  Object.assign(mocks, { canRecoverNativeRegistration, nativeRegistrationConfirmedAt });
  return { useMidnightDustLive: () => ({
    canRecoverNativeRegistration, nativeRegistrationConfirmedAt,
    dustBalance: ref(0n), dustCap: ref(0n), settled: ref(true), hasData: ref(true),
    nightRegistered: ref(0n), dustGenerating: ref(0n), registrationStatus: ref('Registered'), nativeRegistrationCleared: ref(false),
  }) };
});
vi.mock('@/shared/composables/useMidnightSendTimeline', async () => ({ useMidnightSendTimeline: () => [] }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../composables/useChainContext', async () => {
  const { ref } = await import('vue');
  return { useChainContext: () => ({ themeColors: ref({ primary: '#fff' }) }) };
});
vi.mock('@/shared/utils/openFullDashboard', () => ({ openFullDashboard: vi.fn() }));
vi.mock('@/plugins/snackbar', () => ({ default: { fireSuccess: mocks.success, setError: mocks.error } }));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('../BottomSheet.vue', () => ({ default: {} }));
vi.mock('@/modules/dashboard/dialogs/MidnightSponsorPicker.vue', () => ({ default: {} }));
vi.mock('@/modules/dashboard/dialogs/QRAddressScannerDialog.vue', () => ({ default: {} }));
vi.mock('@/shared/components/TransactionDetailsCard.vue', () => ({ default: {} }));
vi.mock('@/modules/dashboard/dialogs/ShieldedProvingConsentDialog.vue', () => ({ default: {} }));
vi.mock('@/shared/components/MidnightSendTimeline.vue', () => ({ default: {} }));

import MidnightSendSheet from './MidnightSendSheet.vue';
import DustRegistrationDialog from '@/modules/dashboard/dialogs/DustRegistrationDialog.vue';
import { walletStore } from '@/stores/walletStore';
import { geroStore } from '@/stores/geroStore';
import { midnightStore } from '@/stores/midnightStore';

const result = { txHash: '11'.repeat(32), ledgerTxHash: '22'.repeat(32), status: 'submitted' };
const popup = { close: vi.fn() };
const extensionOrigin = new URL('chrome-extension://test-extension/').origin;
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem('gero.midnightDustRegistrationPending');
  mocks.canRecoverNativeRegistration.value = true;
  mocks.nativeRegistrationConfirmedAt.value = 0;
  mocks.register.mockReset().mockResolvedValue({ status: 'submitted', txHash: 'registration-id' });
  // Mainnet and preprod run ledger 9, whose DUST fee this device proves.
  useMidnightChains({ mainnet: [L9, L8], preprod: [L9, L8] });
  mocks.send.mockReset().mockResolvedValue(result);
  mocks.consent.mockReturnValue(false);
  walletStore.loggedWallet = { id: 1, name: 'Sender', type: WalletType.Normal, chain: 'Midnight', network: Network.MAINNET,
    baseAddress: 'mn_addr1sender', webAuthnCredentialId: 'sender-key', encryptionMethod: 'prf' } as never;
  walletStore.isLocked = false;
  geroStore.wallets = { 2: { id: 2, name: 'Sponsor', type: WalletType.Normal, chain: 'Midnight', network: Network.MAINNET,
    encryptionMethod: 'prf', webAuthnCredentialId: 'sponsor-key' } } as never;
  midnightStore.proofServer = { mode: 'local' } as never;
  vi.stubGlobal('chrome', { runtime: { getURL: (path: string) => `chrome-extension://test-extension/${path}` } });
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
  vi.spyOn(window, 'clearTimeout');
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function render(modelValue = true) {
  return mount(MidnightSendSheet, { props: { modelValue }, global: {
    config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
    stubs: {
      ...dialogControls(async () => ({ valid: true, errors: [] })),
      BottomSheet: { props: ['modelValue', 'persistent'], emits: ['update:modelValue'],
        template: '<section><button data-testid="close" :disabled="persistent" @click="$emit(\'update:modelValue\', false)">Close</button><slot /></section>' },
      MidnightSponsorPicker: { props: ['modelValue'], emits: ['update:modelValue'],
        template: '<button data-testid="sponsor" @click="$emit(\'update:modelValue\', 2)">Choose sponsor</button>' },
      ShieldedProvingConsentDialog: { props: ['isOpen'], emits: ['accepted'],
        template: '<button v-if="isOpen" data-testid="consent" @click="$emit(\'accepted\')">Accept</button>' },
      'v-text-field': { props: ['modelValue', 'placeholder', 'disabled'], emits: ['update:modelValue'],
        template: '<input :placeholder="placeholder" :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
      'v-expand-transition': { template: '<div><slot /></div>' }, 'v-avatar': true,
      TransactionDetailsCard: true, MidnightSendTimeline: true, QRAddressScannerDialog: true, CnightDustSourcesDialog: true,
    },
  } });
}
type View = ReturnType<typeof render>;
async function ready(sponsor = false) {
  const wrapper = render();
  await flushPromises();
  await wrapper.get('input[placeholder="common.recipientAddress"]').setValue(
    walletStore.loggedWallet.network === Network.PREPROD ? 'mn_addr_preprod1recipient' : 'mn_addr1recipient',
  );
  await wrapper.findAll('button').find(button => button.text() === 'common.continue')!.trigger('click');
  await wrapper.get('input[placeholder="0"]').setValue('1');
  if (sponsor) await wrapper.get('[data-testid="sponsor"]').trigger('click');
  await wrapper.findAll('button').find(button => button.text() === 'miniGero.review')!.trigger('click');
  await wrapper.findAll('button').find(button => button.text() === 'miniGero.confirmSend')!.trigger('click');
  if (!walletStore.loggedWallet.webAuthnCredentialId) await wrapper.get('input[placeholder="miniGero.enterPassword"]').setValue('sender-password');
  return wrapper;
}
function confirm(wrapper: View) { return wrapper.findAll('.stepper-step').at(-1)!.findAll('button').find(button => button.text().includes('miniGero.confirmSend'))!; }
async function authenticate(origin = extensionOrigin, source: unknown = popup) {
  const event = new MessageEvent('message', { origin, data: { type: 'PASSKEY_AUTH_RESULT', payload: { success: true, prfOutput: [1, 2, 3] } } });
  Object.defineProperty(event, 'source', { value: source });
  window.dispatchEvent(event);
  await flushPromises();
}
type Change = 'close' | 'wallet' | 'network' | 'recipient' | 'lock' | 'unmount';
async function invalidate(wrapper: View, change: Change) {
  if (change === 'close') {
    expect(wrapper.get('[data-testid="close"]').attributes('disabled')).toBeUndefined();
    await wrapper.get('[data-testid="close"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
    await wrapper.setProps({ modelValue: false });
  }
  if (change === 'wallet') walletStore.loggedWallet = { ...walletStore.loggedWallet, id: 3 };
  if (change === 'network') walletStore.loggedWallet = { ...walletStore.loggedWallet, network: Network.PREPROD };
  // Programmatic replacement models an external route/recipient update while controls are disabled.
  if (change === 'recipient') (wrapper.vm as unknown as { recipient: string }).recipient = 'mn_addr1replacement';
  if (change === 'lock') walletStore.isLocked = true;
  if (change === 'unmount') wrapper.unmount();
  await nextTick();
}

describe('Midnight sidepanel authorization freshness', () => {
  async function openRecovery() {
    walletStore.loggedWallet = { ...walletStore.loggedWallet, network: Network.PREPROD, baseAddress: 'mn_addr_preprod1sender' };
    midnightStore.addresses = { dust: 'dust-test-receiver' } as never;
    mocks.send.mockRejectedValueOnce(new MidnightDustFeeShortfall('fee unavailable'));
    const wrapper = await ready();
    await confirm(wrapper).trigger('click');
    await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
    await authenticate();
    await wrapper.get('[data-test="dust-fee-recovery"]').trigger('click');
    await vi.waitFor(() => expect(wrapper.find('.status-pill').exists()).toBe(true));
    return wrapper;
  }

  it('registers the original wallet once through its PassKey popup after a sender fee failure', async () => {
    const wrapper = await openRecovery();
    await wrapper.get('[data-test="dust-register"]').trigger('click');
    await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(2));
    expect(window.open).toHaveBeenLastCalledWith(expect.stringContaining('mode=rawPrf&walletId=1'), 'PassKeyAuth', expect.any(String));
    expect(mocks.register).not.toHaveBeenCalled();
    await authenticate();
    await vi.waitFor(() => expect(wrapper.get('[data-test="dust-registration-pending"]').isVisible()).toBe(true));
    expect(mocks.register).toHaveBeenCalledExactlyOnceWith(Network.PREPROD, {
      fromAddress: 'mn_addr_preprod1sender', dustReceiverAddressBech32: 'dust-test-receiver',
    }, { prfSecret: expect.any(Uint8Array), password: undefined }, expect.any(Function));
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('keeps the receipt when Portfolio reopens over the old Registered status', async () => {
    const wrapper = await openRecovery();
    await wrapper.get('[data-test="dust-register"]').trigger('click');
    await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(2));
    await authenticate();
    await vi.waitFor(() => expect(wrapper.find('[data-test="dust-registration-pending"]').exists()).toBe(true));
    wrapper.unmount();
    const portfolio = mount(DustRegistrationDialog, { props: { isOpen: true }, global: {
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
      stubs: { ...dialogControls(async () => ({ valid: true, errors: [] })), CnightDustSourcesDialog: true },
    } });
    expect(portfolio.get('[data-test="dust-registration-pending"]').isVisible()).toBe(true);
    expect(portfolio.find('[data-test="dust-register"]').exists()).toBe(false);
    mocks.nativeRegistrationConfirmedAt.value = Date.now() + 1_000;
    await nextTick();
    expect(portfolio.find('[data-test="dust-registration-pending"]').exists()).toBe(false);
    expect(mocks.register).toHaveBeenCalledTimes(1);
  });

  it.each(['lock', 'wallet', 'unmount'] as const)('discards an open registration approval after %s', async change => {
    const wrapper = await openRecovery();
    await wrapper.get('[data-test="dust-register"]').trigger('click');
    await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(2));
    await invalidate(wrapper, change);
    await authenticate();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(popup.close).toHaveBeenCalledTimes(2);
  });

  it('shows an existing registration when native re-registration is ineligible', async () => {
    mocks.canRecoverNativeRegistration.value = false;
    const wrapper = await openRecovery();
    expect(wrapper.get('.status-pill').text()).toContain('midnight.statusRegistered');
    expect(wrapper.find('[data-test="dust-register"]').exists()).toBe(false);
  });

  it.each(['sponsor', 'unrelated'] as const)('keeps sender registration out of a %s failure', async reason => {
    if (reason === 'sponsor') walletStore.loggedWallet = { ...walletStore.loggedWallet, webAuthnCredentialId: undefined };
    mocks.send.mockRejectedValueOnce(reason === 'sponsor' ? new MidnightDustFeeShortfall('fee unavailable') : new Error('fee unavailable'));
    const wrapper = await ready(reason === 'sponsor');
    await confirm(wrapper).trigger('click');
    await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
    await authenticate();
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toBe('fee unavailable'));
    expect(wrapper.find('[data-test="dust-fee-recovery"]').exists()).toBe(false);
  });

  it.each(['sender', 'sponsor'] as const)('%s popup accepts only its own window and extension origin; submits once', async role => {
    if (role === 'sponsor') walletStore.loggedWallet = { ...walletStore.loggedWallet, webAuthnCredentialId: undefined };
    const wrapper = await ready(role === 'sponsor');
    await confirm(wrapper).trigger('click');
    await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
    expect(window.open).toHaveBeenCalledWith(expect.stringContaining(role === 'sponsor' ? 'walletId=2' : 'mode=rawPrf#/'), 'PassKeyAuth', expect.any(String));
    await authenticate('https://untrusted.example');
    await authenticate(extensionOrigin, { close: vi.fn() });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(popup.close).not.toHaveBeenCalled();
    // While the send runs the CTA is gone, so it cannot open a second popup.
    expect(confirm(wrapper)).toBeUndefined();
    expect(window.open).toHaveBeenCalledTimes(1);
    await authenticate();
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.send).toHaveBeenCalledWith(Network.MAINNET,
      expect.objectContaining({ outputs: [{ address: 'mn_addr1recipient', amount: '1000000', token: 'NIGHT' }] }),
      role === 'sender' ? { prfSecret: expect.any(Uint8Array) } : { password: 'sender-password' },
      expect.any(Function), role === 'sponsor' ? { walletId: 2, prfSecret: expect.any(Uint8Array) } : undefined,
      false, expect.any(Function),
      // The busy prover's countdown and still-busy prompt (midnightBusyRetry.ts).
      expect.objectContaining({ onCountdown: expect.any(Function), onStillBusy: expect.any(Function) }));
    await flushPromises();
    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(window.clearTimeout).toHaveBeenCalled();
    expect(mocks.pending).toHaveBeenCalledWith(result.ledgerTxHash, 1_000_000n, 'mn_addr1recipient', false, 'NIGHT', 'mn_addr1sender', true);
    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.success-overlay').exists()).toBe(true);
  });

  describe.each(['sender', 'sponsor'] as const)('%s authentication', role => {
    it.each(['close', 'wallet', 'network', 'recipient', 'lock', 'unmount'] as const)('cancels on %s and ignores a late PRF message', async change => {
      if (role === 'sponsor') walletStore.loggedWallet = { ...walletStore.loggedWallet, webAuthnCredentialId: undefined };
      const wrapper = await ready(role === 'sponsor');
      await confirm(wrapper).trigger('click');
      await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
      await invalidate(wrapper, change);
      await authenticate();
      expect(popup.close).toHaveBeenCalledTimes(1);
      expect(window.clearTimeout).toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
      expect(mocks.pending).not.toHaveBeenCalled();
      expect(mocks.success).not.toHaveBeenCalled();
    });
  });

  it('requires fresh approval for a replacement recipient', async () => {
    const wrapper = await ready();
    await confirm(wrapper).trigger('click');
    await invalidate(wrapper, 'recipient');
    await authenticate();
    expect(mocks.send).not.toHaveBeenCalled();
    await confirm(wrapper).trigger('click');
    expect(window.open).toHaveBeenCalledTimes(2);
    await authenticate();
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.send.mock.calls[0][1].outputs[0].address).toBe('mn_addr1replacement');
  });

  it('does not turn a stale submitted response into success or pending history for the new wallet', async () => {
    const sending = deferred<typeof result>();
    mocks.send.mockReturnValueOnce(sending.promise);
    const wrapper = await ready();
    await confirm(wrapper).trigger('click');
    await authenticate();
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    const current = mocks.send.mock.calls[0][6] as () => boolean;
    expect(current()).toBe(true);
    await invalidate(wrapper, 'wallet');
    expect(current()).toBe(false);
    sending.resolve(result);
    await flushPromises();
    expect(mocks.pending).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(wrapper.find('.success-overlay').exists()).toBe(false);
  });

  it('sends a public transfer in Gero Cloud mode without a consent notice (the fee is proven on this device)', async () => {
    midnightStore.proofServer = { mode: 'remote' } as never;
    const wrapper = await ready();
    await confirm(wrapper).trigger('click');
    await authenticate();
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(wrapper.find('[data-testid="consent"]').exists()).toBe(false);
  });

  it('discards consent approval when its recipient changes and obtains fresh authorization', async () => {
    // zkPaaS still receives a public send's DUST witness, so it still needs consent.
    midnightStore.proofServer = { mode: 'zkpaas' } as never;
    const wrapper = await ready();
    await confirm(wrapper).trigger('click');
    await authenticate();
    expect(wrapper.find('[data-testid="consent"]').exists()).toBe(true);
    expect(mocks.send).not.toHaveBeenCalled();
    await invalidate(wrapper, 'recipient');
    expect(wrapper.find('[data-testid="consent"]').exists()).toBe(false);
    await confirm(wrapper).trigger('click');
    expect(window.open).toHaveBeenCalledTimes(2);
    await authenticate();
    await wrapper.get('[data-testid="consent"]').trigger('click');
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.send.mock.calls[0][1].outputs[0].address).toBe('mn_addr1replacement');
  });
});

// Issue 1470: a send that went out is recorded as pending even when the sheet
// has moved on, but only for the wallet that sent it; Send again fills it in.
describe('Midnight sidepanel pending rows and Send again', () => {
  it('records the pending row for the sending wallet after the view moved on', async () => {
    const sending = deferred<typeof result>();
    mocks.send.mockReturnValueOnce(sending.promise);
    const wrapper = await ready();
    await confirm(wrapper).trigger('click');
    await authenticate();
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    await invalidate(wrapper, 'recipient');
    sending.resolve(result);
    await flushPromises();
    expect(mocks.pending).toHaveBeenCalledWith(result.ledgerTxHash, 1_000_000n, 'mn_addr1recipient', false, 'NIGHT', 'mn_addr1sender', true);
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('Send again fills in the recipient and amount and sends nothing by itself', async () => {
    const { requestMidnightSendAgain } = await import('@/chains/midnight/midnightSendPrefill');
    const wrapper = render(false);
    requestMidnightSendAgain({ recipient: 'mn_addr1again', amount: 2_500_000n, token: 'NIGHT', shielded: false });
    await wrapper.setProps({ modelValue: true });
    await flushPromises();
    const vm = wrapper.vm as unknown as { recipient: string; amount: string };
    expect(vm.recipient).toBe('mn_addr1again');
    expect(vm.amount).toBe('2.5');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.pending).not.toHaveBeenCalled();
  });
});
