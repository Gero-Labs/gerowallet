import Vue, { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { clearHelpSupport, helpSupportIntent, openSupport, supportNoticeFor } from './supportIntent';

const h = vi.hoisted(() => ({
  wallet: { loggedWallet: null as unknown, isLocked: true, isSyncing: false },
  flags: { isInitialized: false, live: false }, saved: { value: false },
  route: { fullPath: '/help/articles/midnight-dust?chain=midnight', query: {} },
}));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive(h.wallet) }));
vi.mock('@/stores/featureFlagsStore', async () => {
  const state = (await import('vue')).reactive(h.flags);
  return { featureFlagsStore: { state, isLiveChatEnabled: () => state.live } };
});
vi.mock('@/shared/composables/useAvailableWallets', async () => {
  const { reactive, computed } = await import('vue');
  const saved = reactive(h.saved);
  return { useAvailableWallets: () => ({ hasWallets: computed(() => saved.value) }) };
});
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('vue-router/composables', () => ({ useRoute: () => h.route }));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({ default: {
  props: ['to'], render(h: Vue.CreateElement) { return h('button', { attrs: { 'data-to': this.to }, on: this.$listeners }, this.$slots.default); },
} }));
import HelpSupportAction from './HelpSupportAction.vue';

const eligible = { id: 42, chain: 'Cardano', network: 'Mainnet', type: 'Normal', stakeAddress: 'stake1test' };
const wrappers: Array<ReturnType<typeof mount>> = [];
function show() {
  const wrapper = mount(HelpSupportAction, { stubs: {
    'v-dialog': { props: ['value'], template: '<div v-if="value"><slot /></div>' },
    GButton: { props: ['to'], template: '<button :data-to="to" v-on="$listeners"><slot /></button>' },
  } });
  wrappers.push(wrapper);
  return wrapper;
}
beforeEach(() => {
  clearHelpSupport();
  h.wallet.loggedWallet = null; h.wallet.isLocked = true; h.wallet.isSyncing = false;
  h.flags.isInitialized = false; h.flags.live = false; h.saved.value = false;
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.destroy()); clearHelpSupport(); vi.unstubAllGlobals(); });

describe('Help support entry', () => {
  it.each([
    { chain: 'Bitcoin' }, { chain: 'Midnight' }, { type: 'Ledger' },
    { type: 'Trezor' }, { stakeAddress: 'stake_test1test', network: 'Preprod' },
  ])('uses email for an unsupported wallet: %j', overrides => {
    expect(supportNoticeFor({ wallet: { ...eligible, ...overrides }, locked: false, syncing: false,
      hasWallets: true, flagsReady: true, liveChat: true })).toBe('ineligible');
  });
  it('copies the confirmed email address and reports a failed clipboard operation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const wrapper = show(); openSupport(); await nextTick();
    await wrapper.findAll('button').wrappers.find(button => button.text() === 'help.copyEmail')!.trigger('click');
    expect(writeText).toHaveBeenCalledWith('support@gerowallet.io');
    await nextTick();
    expect(wrapper.text()).toContain('help.copied');
    writeText.mockRejectedValueOnce(new Error('clipboard denied'));
    await wrapper.findAll('button').wrappers.find(button => button.text() === 'help.copied')!.trigger('click');
    await nextTick();
    expect(wrapper.find('[role="status"]').text()).toBe('help.copyFailed');
  });

  it.each(['noWallets', 'locked', 'ineligible', 'disabled', 'syncing'] as const)('shows %s notice with email and never dispatches chat', async state => {
    if (state === 'locked') h.saved.value = true;
    if (state === 'ineligible' || state === 'disabled' || state === 'syncing') {
      h.wallet.loggedWallet = { ...eligible, chain: state === 'ineligible' ? 'Midnight' : 'Cardano' };
      h.wallet.isLocked = false; h.wallet.isSyncing = state === 'syncing';
    }
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const wrapper = show();
    openSupport('midnight-dust'); await nextTick();
    expect(wrapper.find('[data-test="support-notice"]').text()).toBe(state === 'ineligible' ? 'support.unavailable.notice' : `help.notice.${state}`);
    expect(wrapper.find('a').attributes('href')).toBe('mailto:support@gerowallet.io');
    expect(helpSupportIntent.active).toBe(false);
    expect(helpSupportIntent.dockRequest).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requests eligible Support with removable context, without sending', async () => {
    h.wallet.loggedWallet = eligible; h.wallet.isLocked = false;
    h.flags.isInitialized = true; h.flags.live = true;
    const wrapper = show(); openSupport('receive'); await nextTick();
    expect(wrapper.find('[data-test="support-notice"]').exists()).toBe(false);
    expect(helpSupportIntent.dockRequest).toMatchObject({ walletId: 42 });
    expect(helpSupportIntent.dockRequest?.draft).toContain('receive');
    expect(helpSupportIntent.dockRequest?.draft).toContain('Cardano');
    expect(helpSupportIntent.dockRequest?.draft).not.toContain('stake1test');
    h.wallet.isLocked = true; await Vue.nextTick();
    expect(helpSupportIntent.active).toBe(false);
    expect(helpSupportIntent.dockRequest).toBeNull();
  });
  it('keeps full Help context in the unlock target', async () => {
    h.saved.value = true;
    const wrapper = show(); openSupport(); await nextTick();
    expect(wrapper.findAll('button').wrappers.some(button => button.attributes('data-to') === '/welcome?redirect=' + encodeURIComponent(h.route.fullPath))).toBe(true);
  });
});
