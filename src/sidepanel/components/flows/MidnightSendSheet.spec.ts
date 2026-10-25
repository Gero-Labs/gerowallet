import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { deferred, dialogControls } from '@test/helpers/dialogControls';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { Network, WalletType } from '@/models/types';

const mocks = vi.hoisted(() => ({ send: vi.fn(), pending: vi.fn(), success: vi.fn(), consent: vi.fn() }));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive({ loggedWallet: {}, isLocked: false }) }));
vi.mock('@/stores/geroStore', async () => ({ geroStore: (await import('vue')).reactive({ wallets: {} }) }));
vi.mock('@/stores/midnightStore', async () => ({ midnightStore: (await import('vue')).reactive({
  balances: { nightUnshielded: 10_000_000n }, utxos: [], addresses: {}, dustState: null,
  proofServer: { mode: 'local' }, shieldedProvingConsent: null,
}) }));
vi.mock('@/services/midnight-tx.service', () => ({ sendUnshieldedNight: mocks.send, addPendingMidnightTx: mocks.pending }));
vi.mock('@/chains/midnight/midnightProvingConsent', () => ({ hasMidnightProvingConsent: mocks.consent }));
vi.mock('@/chains/midnight/midnightSponsorLinks', () => ({
  loadSponsorLinks: vi.fn(async () => []), linkFor: vi.fn(), saveSponsorLink: vi.fn(), recordSponsoredTx: vi.fn(),
}));
vi.mock('@/shared/composables/useMidnightDustLive', async () => {
  const { ref } = await import('vue');
  return { useMidnightDustLive: () => ({ dustBalance: ref(0n), dustCap: ref(0n), settled: ref(true) }) };
});
vi.mock('@/shared/composables/useMidnightSendTimeline', async () => ({ useMidnightSendTimeline: () => [] }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../composables/useChainContext', async () => {
  const { ref } = await import('vue');
  return { useChainContext: () => ({ themeColors: ref({ primary: '#fff' }) }) };
});
vi.mock('@/shared/utils/openFullDashboard', () => ({ openFullDashboard: vi.fn() }));
vi.mock('@/plugins/snackbar', () => ({ default: { fireSuccess: mocks.success } }));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('../BottomSheet.vue', () => ({ default: {} }));
vi.mock('@/modules/dashboard/dialogs/MidnightSponsorPicker.vue', () => ({ default: {} }));
vi.mock('@/modules/dashboard/dialogs/QRAddressScannerDialog.vue', () => ({ default: {} }));
vi.mock('@/shared/components/TransactionDetailsCard.vue', () => ({ default: {} }));
vi.mock('@/modules/dashboard/dialogs/ShieldedProvingConsentDialog.vue', () => ({ default: {} }));
vi.mock('@/shared/components/MidnightSendTimeline.vue', () => ({ default: {} }));

import MidnightSendSheet from './MidnightSendSheet.vue';
import { walletStore } from '@/stores/walletStore';
import { geroStore } from '@/stores/geroStore';
import { midnightStore } from '@/stores/midnightStore';

const result = { txHash: '11'.repeat(32), ledgerTxHash: '22'.repeat(32), status: 'submitted' };
const popup = { close: vi.fn() };
const extensionOrigin = new URL('chrome-extension://test-extension/').origin;
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
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

function render() {
  return mount(MidnightSendSheet, { props: { modelValue: true }, global: {
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
      TransactionDetailsCard: true, MidnightSendTimeline: true, QRAddressScannerDialog: true,
    },
  } });
}
type View = ReturnType<typeof render>;
async function ready(sponsor = false) {
  const wrapper = render();
  await flushPromises();
  await wrapper.get('input[placeholder="common.recipientAddress"]').setValue('mn_addr1recipient');
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
    await confirm(wrapper).trigger('click');
    expect(window.open).toHaveBeenCalledTimes(1);
    await authenticate();
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.send).toHaveBeenCalledWith(Network.MAINNET,
      expect.objectContaining({ outputs: [{ address: 'mn_addr1recipient', amount: '1000000', token: 'NIGHT' }] }),
      role === 'sender' ? { prfSecret: expect.any(Uint8Array) } : { password: 'sender-password' },
      expect.any(Function), role === 'sponsor' ? { walletId: 2, prfSecret: expect.any(Uint8Array) } : undefined,
      false, expect.any(Function));
    await flushPromises();
    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(window.clearTimeout).toHaveBeenCalled();
    expect(mocks.pending).toHaveBeenCalledWith(result.ledgerTxHash, 1_000_000n, 'mn_addr1recipient', false, 'NIGHT');
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

  it('discards consent approval when its recipient changes and obtains fresh authorization', async () => {
    midnightStore.proofServer = { mode: 'cloud' } as never;
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
