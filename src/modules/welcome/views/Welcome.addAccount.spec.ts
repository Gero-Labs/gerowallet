// "Add account" opens the welcome page on ?addAccount=<wallet id>. Like every
// other way in, it is behind isMultiAccountEnabled.
import * as Vue from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  route: { query: {} as Record<string, string> },
  flags: { multiAccount: false },
  stubChild: (name: string, props: string[] = []) => ({ name, props, render: () => null }),
}));

vi.mock('vue-router', async () => {
  const { reactive } = await import('vue');
  const route = (h.route = reactive(h.route));
  return { useRoute: () => route };
});
vi.mock('@/stores/featureFlagsStore', async () => {
  const { reactive } = await import('vue');
  const flags = (h.flags = reactive(h.flags));
  return { featureFlagsStore: { isMultiAccountEnabled: () => flags.multiAccount } };
});
vi.mock('@/stores/geroStore', () => ({
  geroStore: Vue.reactive({ wallets: { 7: { id: 7, name: 'Daily', chain: 'Cardano', network: 'Mainnet', type: 'Normal', encryptionMethod: 'password' } } }),
}));
vi.mock('@/utils/networks', () => ({ default: { networks: [{ blockchain: 'Cardano' }], resolveNetwork: () => ({ blockchain: 'Cardano', network: 'Mainnet' }) } }));
vi.mock('@/utils/assets', () => ({ default: {} }));
vi.mock('@/shared/composables/useAvailableWallets', () => ({ useAvailableWallets: () => ({ hasWallets: Vue.computed(() => true), availableWallets: Vue.computed(() => []) }) }));
vi.mock('@/shared/composables/useChainAccent', () => ({ applyChainAccent: vi.fn() }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key, tc: (key: string) => key }) }));
vi.mock('@/plugins/i18n', () => ({ default: { locale: 'us' } }));
vi.mock('@/modules/welcome/components/WalletOnboarding/WalletOnboarding.vue', () => ({ default: h.stubChild('WalletOnboarding', ['network', 'devMode', 'addAccountTo']) }));
vi.mock('@/modules/welcome/components/WalletCreation/WalletCreation.vue', () => ({ default: h.stubChild('WalletCreation') }));
vi.mock('@/modules/welcome/components/LegalFooter/LegalFooter.vue', () => ({ default: h.stubChild('LegalFooter') }));
vi.mock('@/modules/navigation/components/LanguageSelector.vue', () => ({ default: h.stubChild('LanguageSelector') }));
vi.mock('@/modules/welcome/components/onboarding/OnboardingHero.vue', () => ({ default: h.stubChild('OnboardingHero') }));
vi.mock('@/modules/welcome/components/WelcomeHelp/WelcomeHelpPanel.vue', () => ({ default: h.stubChild('WelcomeHelpPanel') }));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({ default: h.stubChild('GButton') }));

import Welcome from './Welcome.vue';

function render() {
  return mount(Welcome, {
    global: { config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) }, stubs: { 'v-icon': true } },
  });
}

afterEach(() => {
  h.route.query = {};
  h.flags.multiAccount = false;
});

describe('opening "Add account" from a link', () => {
  it('adds an account to the wallet named, once the flag is on', async () => {
    h.route.query = { addWallet: '1', addAccount: '7' };
    const wrapper = render();
    await flushPromises();
    expect(wrapper.findComponent({ name: 'WalletOnboarding' }).exists()).toBe(false);

    h.flags.multiAccount = true;
    await flushPromises();

    expect(wrapper.findComponent({ name: 'WalletOnboarding' }).props('addAccountTo')).toMatchObject({ id: 7 });
  });
});
