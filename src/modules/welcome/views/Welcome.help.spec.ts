import { mockGlobalProperties } from '@test/helpers/globalProperties';
import * as Vue from 'vue';
import { nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  hasWallets: { value: false },
  // A page section that only renders a marker and, for each listed event, a button that emits it.
  stubChild: (name: string, props: string[] = [], emits: string[] = []) => ({
    name,
    props,
    render(this: Vue.ComponentPublicInstance) {
    return Vue.h('div', { class: name }, emits.map(event => Vue.h('button', { class: `${name}-${event}`, onClick: () => this.$emit(event, { blockchain: 'Cardano' }) })));
},
  }),
}));

vi.mock('@/utils/networks', () => ({
  default: { networks: [{ blockchain: 'Cardano' }] },
}));
vi.mock('@/utils/assets', () => ({ default: {} }));
vi.mock('@/shared/composables/useAvailableWallets', async () => {
  const { computed, reactive } = await import('vue');
  const state = (h.hasWallets = reactive(h.hasWallets));
  return { useAvailableWallets: () => ({ hasWallets: computed(() => state.value), availableWallets: computed(() => []) }) };
});
vi.mock('@/shared/composables/useChainAccent', () => ({ applyChainAccent: vi.fn() }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key, tc: (key: string) => key }) }));
vi.mock('@/plugins/i18n', () => ({ default: { locale: 'us' } }));
vi.mock('@/api/help.api', () => ({
  getHelpUpdates: vi.fn().mockResolvedValue({ items: [], total: 0, nextCursor: null, sources: [] }),
  helpLocale: () => 'en-US',
}));
vi.mock('@/modules/navigation/helpAccess', () => ({ openWelcomeHelp: vi.fn().mockResolvedValue(true) }));
vi.mock('@/shared/components/iso/IsoScene.vue', () => ({ default: { render: () => Vue.h('svg') } }));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({
  default: {
    inheritAttrs: false,
    render(this: Vue.ComponentPublicInstance) {
    const link = !!this.$attrs['href'];
    return Vue.h(link ? 'a' : 'button', { ...(link ? {} : { type: 'button' }), ...this.$attrs, ...this.$attrs }, this.$slots['default']?.());
},
  },
}));
vi.mock('@/modules/welcome/components/WalletOnboarding/WalletOnboarding.vue', () => ({ default: h.stubChild('WalletOnboarding', ['network', 'devMode']) }));
vi.mock('@/modules/welcome/components/WalletCreation/WalletCreation.vue', () => ({ default: h.stubChild('WalletCreation', ['selectedNetwork']) }));
vi.mock('@/modules/welcome/components/LegalFooter/LegalFooter.vue', () => ({ default: h.stubChild('LegalFooter') }));
vi.mock('@/modules/navigation/components/LanguageSelector.vue', () => ({ default: h.stubChild('LanguageSelector') }));
vi.mock('@/modules/welcome/components/onboarding/OnboardingHero.vue', () => ({ default: h.stubChild('OnboardingHero', ['variant'], ['get-started']) }));
import Welcome from './Welcome.vue';

const stubs = { 'v-icon': { render: () => Vue.h('i', { class: 'v-icon' }) } };
const mounted: VueWrapper[] = [];
const roots: HTMLElement[] = [];

function show() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  roots.push(root);
  const wrapper = mount(Welcome, { attachTo: root, global: { stubs, config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } } });
  mounted.push(wrapper);
  return wrapper;
}
const button = (wrapper: VueWrapper) => wrapper.find('[data-test="help-button"]');
const panel = (wrapper: VueWrapper) => wrapper.find('#whelp-panel');
const sections = (wrapper: VueWrapper) => wrapper.findAll('[data-section]').map(section => section.attributes('data-section'));

beforeEach(() => {
  h.hasWallets.value = false;
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  localStorage.clear();
});
afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount());
  roots.splice(0).forEach(root => root.remove());
});

describe('Welcome: Help button and panel', () => {
  it('has one Help button that starts collapsed and points at the panel it controls', () => {
    const wrapper = show();
    expect(wrapper.findAll('.language-selector-container button').filter(b => b.attributes('data-test') === 'help-button')).toHaveLength(1);
    expect(button(wrapper).text()).toBe('help.welcome.title');
    expect(button(wrapper).attributes('aria-expanded')).toBe('false');
    expect(button(wrapper).attributes('aria-controls')).toBe('whelp-panel');
    expect(button(wrapper).classes()).not.toContain('welcome-help-button--open');
    expect(panel(wrapper).exists()).toBe(false);
    expect(wrapper.find('.LanguageSelector').exists()).toBe(true);
  });

  it('toggles the panel and the pressed state from the Help button', async () => {
    const wrapper = show();
    await button(wrapper).trigger('click');
    expect(panel(wrapper).exists()).toBe(true);
    expect(button(wrapper).attributes('aria-expanded')).toBe('true');
    expect(button(wrapper).classes()).toContain('welcome-help-button--open');
    await button(wrapper).trigger('click');
    expect(panel(wrapper).exists()).toBe(false);
    expect(button(wrapper).attributes('aria-expanded')).toBe('false');
  });

  it('closes on Escape and from the panel close button, then gives focus back to the Help button', async () => {
    const wrapper = show();
    const helpButton = button(wrapper).element as HTMLElement;
    helpButton.focus();
    await button(wrapper).trigger('click');
    await nextTick();
    expect(document.activeElement).toBe(wrapper.find('#whelp-search').element);

    wrapper.find('#whelp-search').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(panel(wrapper).exists()).toBe(false);
    expect(button(wrapper).attributes('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(helpButton);

    await button(wrapper).trigger('click');
    await wrapper.find('[data-test="close"]').trigger('click');
    expect(panel(wrapper).exists()).toBe(false);
    expect(document.activeElement).toBe(helpButton);
  });

  it('leaves focus on the Help button when the button itself closes the panel', async () => {
    const wrapper = show();
    const helpButton = button(wrapper).element as HTMLElement;
    helpButton.focus();
    await button(wrapper).trigger('click');
    await nextTick();
    helpButton.focus();
    await button(wrapper).trigger('click');
    expect(document.activeElement).toBe(helpButton);
  });

  it('keeps the welcome screen usable while the panel is open, and the panel follows it', async () => {
    h.hasWallets.value = true;
    const wrapper = show();
    await button(wrapper).trigger('click');
    expect(sections(wrapper)).toEqual(['gettingBack', 'common']);
    expect(wrapper.find('.whelp-scrim').exists()).toBe(false);
    expect(wrapper.find('.OnboardingHero').exists()).toBe(true);

    // Get Started on the page behind the panel: setup opens, the panel switches to "About this step".
    await wrapper.find('.OnboardingHero-get-started').trigger('click');
    await nextTick();
    expect(wrapper.find('.WalletOnboarding').exists()).toBe(true);
    expect(panel(wrapper).exists()).toBe(true);
    expect(sections(wrapper)).toEqual(['aboutStep', 'common']);
  });

  it('shows the first-run list when there are no saved wallets', async () => {
    const wrapper = show();
    await button(wrapper).trigger('click');
    expect(sections(wrapper)).toEqual(['newToGero', 'common']);
  });

  it('never shows the old page-level open failure', async () => {
    const wrapper = show();
    await button(wrapper).trigger('click');
    expect(wrapper.find('.welcome-help-error').exists()).toBe(false);
    expect(wrapper.find('.language-selector-container').text()).not.toContain('help.openFailed');
  });
});
