import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { clearHelpSupport, helpSupportIntent, openSupport, openWalletSupport, supportNoticeFor } from './supportIntent';
import { version } from '../../../package.json';

const h = vi.hoisted(() => ({
  wallet: { loggedWallet: null as unknown, isLocked: true, isSyncing: false },
  flags: { isInitialized: false, live: false }, saved: { value: false },
  route: { fullPath: '/help/articles/midnight-dust?chain=midnight', query: {} as Record<string, string> },
  track: vi.fn(),
}));
vi.mock('./helpAnalytics', () => ({ trackHelp: h.track }));
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
vi.mock('@/shared/components/GButton/GButton.vue', async () => {
  const { defineComponent } = await import('vue');
  return { default: defineComponent({
    props: ['to', 'tier', 'href'],
    render(h) {
      return h(this.href ? 'a' : 'button', {
        attrs: { href: this.href, 'data-to': this.to, 'data-tier': this.tier ?? 'secondary' }, on: this.$listeners,
      }, this.$slots['default']);
    },
  }) };
});
import HelpSupportAction from './HelpSupportAction.vue';

const eligible = { id: 42, chain: 'Cardano', network: 'Mainnet', type: 'Normal', stakeAddress: 'stake1test' };
const MAILTO = 'mailto:support@gerowallet.io';
const wrappers: Array<ReturnType<typeof mount>> = [];
function show() {
  const wrapper = mount(HelpSupportAction, { stubs: {
    'v-dialog': { props: ['value'], template: '<div v-if="value"><slot /></div>' },
    'v-icon': { template: '<i :data-icon="$slots.default && $slots.default[0].text.trim()" />' },
  } });
  wrappers.push(wrapper);
  return wrapper;
}
type Wrapper = ReturnType<typeof show>;
function eligibleSession(): void {
  h.wallet.loggedWallet = eligible; h.wallet.isLocked = false;
  h.flags.isInitialized = true; h.flags.live = true;
}
const buttonByText = (wrapper: Wrapper, text: string) => wrapper.findAll('button, a').wrappers.find(el => el.text() === text)!;
const question = (wrapper: Wrapper) => wrapper.find<HTMLTextAreaElement>('#help-support-question');
const contextBox = (wrapper: Wrapper) => wrapper.find<HTMLTextAreaElement>('#help-support-context');
const primaries = (wrapper: Wrapper) => wrapper.findAll('[data-tier="primary"]');

beforeEach(() => {
  clearHelpSupport(); h.track.mockReset(); h.route.query = {};
  h.wallet.loggedWallet = null; h.wallet.isLocked = true; h.wallet.isSyncing = false;
  h.flags.isInitialized = false; h.flags.live = false; h.saved.value = false;
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.destroy()); clearHelpSupport(); vi.unstubAllGlobals(); });

describe('Help support eligibility', () => {
  it.each([
    { chain: 'Bitcoin' }, { chain: 'Midnight' }, { type: 'Ledger' },
    { type: 'Trezor' }, { stakeAddress: 'stake_test1test', network: 'Preprod' },
  ])('uses email for an unsupported wallet: %j', overrides => {
    expect(supportNoticeFor({ wallet: { ...eligible, ...overrides }, locked: false, syncing: false,
      hasWallets: true, flagsReady: true, liveChat: true })).toBe('ineligible');
  });
});

describe('Help support chat dialog (eligible wallet)', () => {
  it('opens the dialog with the prefilled question and context instead of the dock', async () => {
    eligibleSession();
    const wrapper = show(); openSupport('receive'); await nextTick();
    expect(wrapper.find('h2').text()).toBe('help.contact');
    expect(wrapper.find('[role="status"]').text()).toBe('help.notice.eligible');
    expect(wrapper.find('label[for="help-support-question"]').text()).toBe('help.supportDialog.question');
    expect(question(wrapper).element.value).toBe('help.question');
    expect(wrapper.find('label[for="help-support-context"]').text()).toBe('help.context.preview');
    expect(contextBox(wrapper).element.value).toBe([
      'help.context.guide: receive', 'help.context.chain: Cardano', 'help.context.network: Mainnet',
      `help.context.version: ${version}`,
    ].join('\n'));
    expect(contextBox(wrapper).element.value).not.toContain('stake1test');
    expect(wrapper.text()).toContain('help.supportDialog.noRecoveryPhrase');
    expect(wrapper.find('[data-test="support-notice"]').exists()).toBe(false);
    // Nothing reaches the dock until the user presses Start live chat.
    expect(helpSupportIntent.dockRequest).toBeNull();
    expect(helpSupportIntent.active).toBe(false);
  });

  it('leaves out the guide line when no article was passed', async () => {
    eligibleSession();
    const wrapper = show(); openSupport(); await nextTick();
    expect(contextBox(wrapper).element.value).not.toContain('help.context.guide');
    expect(contextBox(wrapper).element.value.split('\n')).toHaveLength(3);
  });

  it('draws one primary action, a secondary alternative and a labelled close button', async () => {
    eligibleSession();
    const wrapper = show(); openSupport(); await nextTick();
    expect(primaries(wrapper)).toHaveLength(1);
    expect(primaries(wrapper).at(0).text()).toBe('help.supportDialog.startChat');
    expect(buttonByText(wrapper, 'help.supportDialog.emailInstead').attributes('data-tier')).toBe('secondary');
    expect(wrapper.find('button[aria-label="common.close"]').exists()).toBe(true);
  });

  it('starts the live chat with the edited question and context, then closes', async () => {
    eligibleSession();
    const wrapper = show(); openSupport('receive'); await nextTick();
    await question(wrapper).setValue('How do I receive ADA?');
    await contextBox(wrapper).setValue('Guide: receive\nNote: first wallet');
    await buttonByText(wrapper, 'help.supportDialog.startChat').trigger('click');
    expect(helpSupportIntent.active).toBe(true);
    expect(helpSupportIntent.dockRequest).toMatchObject({
      walletId: 42,
      draft: 'How do I receive ADA?\n\nhelp.context.preview\nGuide: receive\nNote: first wallet',
    });
    expect(wrapper.find('h2').exists()).toBe(false);
  });

  it('drops the context from the draft after Remove', async () => {
    eligibleSession();
    const wrapper = show(); openSupport('receive'); await nextTick();
    await buttonByText(wrapper, 'common.remove').trigger('click');
    expect(contextBox(wrapper).exists()).toBe(false);
    expect(wrapper.find('label[for="help-support-context"]').exists()).toBe(false);
    await question(wrapper).setValue('Just a question');
    await buttonByText(wrapper, 'help.supportDialog.startChat').trigger('click');
    expect(helpSupportIntent.dockRequest?.draft).toBe('Just a question');
  });

  it('keeps the context out of the draft when it was cleared by hand', async () => {
    eligibleSession();
    const wrapper = show(); openSupport(); await nextTick();
    await contextBox(wrapper).setValue('   ');
    await buttonByText(wrapper, 'help.supportDialog.startChat').trigger('click');
    expect(helpSupportIntent.dockRequest?.draft).toBe('help.question');
  });

  it('switches the same dialog to the email view on "Email instead"', async () => {
    eligibleSession();
    const wrapper = show(); openSupport(); await nextTick();
    await buttonByText(wrapper, 'help.supportDialog.emailInstead').trigger('click');
    expect(wrapper.find('h2').text()).toBe('help.contact');
    expect(wrapper.find('[data-test="support-notice"]').text()).toBe('help.supportDialog.emailAvailable');
    expect(question(wrapper).exists()).toBe(false);
    expect(wrapper.find('a.support-email-link').attributes('href')).toBe(MAILTO);
    expect(primaries(wrapper)).toHaveLength(1);
    expect(primaries(wrapper).at(0).attributes('href')).toBe(MAILTO);
    expect(wrapper.find('[data-to]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('help.eligibility');
    expect(helpSupportIntent.dockRequest).toBeNull();
    expect(helpSupportIntent.active).toBe(false);
  });

  it('closes from the header button without opening the dock', async () => {
    eligibleSession();
    const wrapper = show(); openSupport(); await nextTick();
    await wrapper.find('button[aria-label="common.close"]').trigger('click');
    expect(wrapper.find('h2').exists()).toBe(false);
    expect(helpSupportIntent.dockRequest).toBeNull();
    expect(helpSupportIntent.active).toBe(false);
  });

  it('resets to the chat view with fresh text each time it opens', async () => {
    eligibleSession();
    const wrapper = show(); openSupport('receive'); await nextTick();
    await question(wrapper).setValue('Edited');
    await buttonByText(wrapper, 'common.remove').trigger('click');
    await buttonByText(wrapper, 'help.supportDialog.emailInstead').trigger('click');
    await wrapper.find('button[aria-label="common.close"]').trigger('click');
    openSupport('send'); await nextTick();
    expect(question(wrapper).element.value).toBe('help.question');
    expect(contextBox(wrapper).element.value).toContain('help.context.guide: send');
    expect(wrapper.find('[data-test="support-notice"]').exists()).toBe(false);
  });
});

describe('Help support email dialog (no live chat)', () => {
  function setup(state: 'noWallets' | 'locked' | 'syncing' | 'ineligible' | 'disabled'): void {
    if (state === 'locked') h.saved.value = true;
    if (state === 'ineligible' || state === 'disabled' || state === 'syncing') {
      h.wallet.loggedWallet = { ...eligible, chain: state === 'ineligible' ? 'Midnight' : 'Cardano' };
      h.wallet.isLocked = false; h.wallet.isSyncing = state === 'syncing';
    }
  }

  it.each(['noWallets', 'locked', 'ineligible', 'disabled', 'syncing'] as const)('shows the %s notice with email and never dispatches chat', async state => {
    setup(state);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const wrapper = show();
    openSupport('midnight-dust'); await nextTick();
    expect(wrapper.find('h2').text()).toBe('help.contact');
    expect(wrapper.find('[data-test="support-notice"]').text()).toBe(state === 'ineligible' ? 'support.unavailable.notice' : `help.notice.${state}`);
    expect(wrapper.find('a').attributes('href')).toBe(MAILTO);
    expect(question(wrapper).exists()).toBe(false);
    expect(helpSupportIntent.active).toBe(false);
    expect(helpSupportIntent.dockRequest).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { state: 'noWallets', secondary: 'help.setup', to: '/welcome', caption: true },
    { state: 'locked', secondary: 'help.unlock', to: '/welcome?redirect=' + encodeURIComponent(h.route.fullPath), caption: true },
    { state: 'syncing', secondary: null, to: null, caption: false },
    { state: 'ineligible', secondary: null, to: null, caption: false },
    { state: 'disabled', secondary: null, to: null, caption: false },
  ] as const)('draws the %s footer with one mailto primary', async ({ state, secondary, to, caption }) => {
    setup(state);
    const wrapper = show(); openSupport(); await nextTick();
    expect(primaries(wrapper)).toHaveLength(1);
    expect(primaries(wrapper).at(0).text()).toBe('help.supportDialog.emailSupport');
    expect(primaries(wrapper).at(0).attributes('href')).toBe(MAILTO);
    const routed = wrapper.findAll('[data-to]');
    expect(routed).toHaveLength(secondary ? 1 : 0);
    if (secondary) {
      expect(routed.at(0).text()).toBe(secondary);
      expect(routed.at(0).attributes('data-to')).toBe(to);
      expect(routed.at(0).attributes('data-tier')).toBe('secondary');
    }
    expect(wrapper.text().includes('help.eligibility')).toBe(caption);
    expect(wrapper.text()).not.toContain('help.close');
    expect(wrapper.find('button[aria-label="common.close"]').exists()).toBe(true);
  });

  it('closes the dialog when the create-or-import and unlock links are followed', async () => {
    const wrapper = show(); openSupport(); await nextTick();
    await buttonByText(wrapper, 'help.setup').trigger('click');
    expect(wrapper.find('h2').exists()).toBe(false);
    h.saved.value = true; openSupport(); await nextTick();
    await buttonByText(wrapper, 'help.unlock').trigger('click');
    expect(wrapper.find('h2').exists()).toBe(false);
  });

  it('keeps full Help context in the unlock target', async () => {
    h.saved.value = true;
    const wrapper = show(); openSupport(); await nextTick();
    expect(wrapper.findAll('button').wrappers.some(button => button.attributes('data-to') === '/welcome?redirect=' + encodeURIComponent(h.route.fullPath))).toBe(true);
  });

  it('copies the confirmed email address and reports a failed clipboard operation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const wrapper = show(); openSupport(); await nextTick();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    await buttonByText(wrapper, 'help.copyEmail').trigger('click');
    expect(writeText).toHaveBeenCalledWith('support@gerowallet.io');
    await nextTick();
    expect(wrapper.text()).toContain('help.copied');
    writeText.mockRejectedValueOnce(new Error('clipboard denied'));
    await buttonByText(wrapper, 'help.copied').trigger('click');
    await nextTick();
    expect(wrapper.find('[role="status"]').text()).toBe('help.copyFailed');
    expect(wrapper.text()).not.toContain('help.copied');
  });

  it('forgets a copy result when the dialog opens again', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const wrapper = show(); openSupport(); await nextTick();
    await buttonByText(wrapper, 'help.copyEmail').trigger('click');
    await nextTick();
    expect(wrapper.text()).toContain('help.copied');
    openSupport(); await nextTick();
    expect(wrapper.text()).toContain('help.copyEmail');
  });
});

describe('Help support clearing', () => {
  it.each([
    ['locks', () => { h.wallet.isLocked = true; }],
    ['starts syncing', () => { h.wallet.isSyncing = true; }],
    ['switches wallet', () => { h.wallet.loggedWallet = { ...eligible, id: 43 }; }],
  ] as const)('closes the dialog and clears the dock when the wallet %s', async (_name, change) => {
    eligibleSession();
    const wrapper = show(); openSupport(); await nextTick();
    openWalletSupport('draft', 42);
    expect(helpSupportIntent.active).toBe(true);
    change(); await nextTick();
    expect(helpSupportIntent.active).toBe(false);
    expect(helpSupportIntent.dockRequest).toBeNull();
    expect(wrapper.find('h2').exists()).toBe(false);
  });

  it('falls back to the email view when live chat is switched off while the dialog is open', async () => {
    eligibleSession();
    const wrapper = show(); openSupport(); await nextTick();
    expect(question(wrapper).exists()).toBe(true);
    h.flags.live = false; await nextTick();
    expect(question(wrapper).exists()).toBe(false);
    expect(wrapper.find('[data-test="support-notice"]').text()).toBe('help.notice.disabled');
    expect(helpSupportIntent.dockRequest).toBeNull();
  });

  it('ends an active chat request and shows the email dialog when eligibility is lost', async () => {
    eligibleSession();
    const wrapper = show();
    openWalletSupport('draft', 42);
    expect(wrapper.find('h2').exists()).toBe(false);
    h.flags.live = false; await nextTick();
    expect(helpSupportIntent.active).toBe(false);
    expect(helpSupportIntent.dockRequest).toBeNull();
    expect(wrapper.find('[data-test="support-notice"]').text()).toBe('help.notice.disabled');
  });

  it('clears the support intent when it unmounts', () => {
    eligibleSession();
    const wrapper = show();
    openWalletSupport('draft', 42);
    wrapper.destroy();
    expect(helpSupportIntent.active).toBe(false);
    expect(helpSupportIntent.dockRequest).toBeNull();
  });
});

describe('Help support anonymous usage counts', () => {
  const counted = () => h.track.mock.calls.map(([event]) => event);
  const event = (type: string, subject?: string, chain = 'all') => ({ type, ...(subject ? { subject } : {}), surface: 'help', chain });

  it('counts the dialog opening with the eligibility state it opens in, under the Help chain filter', async () => {
    eligibleSession(); h.route.query = { chain: 'midnight' };
    show(); openSupport('receive'); await nextTick();
    expect(counted()).toEqual([event('support_open', 'eligible', 'midnight')]);
  });
  // Without a chain in the URL the Help filter follows a ready wallet's own chain, exactly as the page shows it.
  it.each([['noWallets', 'all'], ['locked', 'all'], ['syncing', 'all'], ['ineligible', 'midnight'], ['disabled', 'cardano']] as const)('counts the %s state when the email dialog opens', async (state, chain) => {
    if (state === 'locked') h.saved.value = true;
    if (state === 'ineligible' || state === 'disabled' || state === 'syncing') {
      h.wallet.loggedWallet = { ...eligible, chain: state === 'ineligible' ? 'Midnight' : 'Cardano' }; h.wallet.isLocked = false; h.wallet.isSyncing = state === 'syncing';
    }
    show(); openSupport(); await nextTick();
    expect(counted()).toEqual([event('support_open', state, chain)]);
  });
  it('counts "Start live chat" once, after the chat is handed to the dock, and nothing about the question or context', async () => {
    eligibleSession();
    const wrapper = show(); openSupport('receive'); await nextTick();
    await question(wrapper).setValue('My secret question');
    await buttonByText(wrapper, 'help.supportDialog.startChat').trigger('click');
    expect(counted()).toEqual([event('support_open', 'eligible', 'cardano'), event('support_chat_started', undefined, 'cardano')]);
    expect(JSON.stringify(counted())).not.toContain('secret');
  });
  it('does not count "Email instead" or closing as anything but what they are', async () => {
    eligibleSession();
    const wrapper = show(); openSupport(); await nextTick();
    await buttonByText(wrapper, 'help.supportDialog.emailInstead').trigger('click');
    await wrapper.find('button[aria-label="common.close"]').trigger('click');
    expect(counted()).toEqual([event('support_open', 'eligible', 'cardano')]);
  });
  it('counts both mailto actions of the email dialog, without cancelling them', async () => {
    const wrapper = show(); openSupport(); await nextTick();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    wrapper.find('a.support-email-link').element.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    await primaries(wrapper).at(0).trigger('click');
    expect(counted()).toEqual([event('support_open', 'noWallets'), event('support_email', 'dialog'), event('support_email', 'dialog')]);
  });
  it('counts a successful copy of the address, but not a failed one', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const wrapper = show(); openSupport(); await nextTick();
    await buttonByText(wrapper, 'help.copyEmail').trigger('click'); await nextTick();
    await buttonByText(wrapper, 'help.copied').trigger('click'); await nextTick();
    expect(counted()).toEqual([event('support_open', 'noWallets'), event('support_email_copied', 'dialog')]);
  });
});
