// Issue 1582: the welcome page previews a network by writing the
// shared --g-accent slots. useChainAccent writes them only when the signed-in
// wallet's chain changes, so a wallet that signed in before or while the welcome
// page was open kept the preview's Cardano accent on the next page.
import * as Vue from 'vue';
import { mount } from '@vue/test-utils';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  stubChild: (name: string) => ({ name, render: () => null }),
}));

vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }));
vi.mock('@/plugins/vuetify', () => ({ updateVuetifyTheme: vi.fn() }));
vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive({ loggedWallet: null as { chain: string } | null }) };
});
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { isMultiAccountEnabled: () => false } }));
vi.mock('@/stores/geroStore', () => ({ geroStore: Vue.reactive({ wallets: {} }) }));
vi.mock('@/utils/networks', () => ({ default: { networks: [{ blockchain: 'Cardano' }], resolveNetwork: () => null } }));
vi.mock('@/utils/assets', () => ({ default: {} }));
vi.mock('@/shared/composables/useAvailableWallets', () => ({ useAvailableWallets: () => ({ hasWallets: Vue.computed(() => true), availableWallets: Vue.computed(() => []) }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key, tc: (key: string) => key }) }));
vi.mock('@/plugins/i18n', () => ({ default: { locale: 'us' } }));
vi.mock('@/modules/welcome/components/WalletOnboarding/WalletOnboarding.vue', () => ({ default: h.stubChild('WalletOnboarding') }));
vi.mock('@/modules/welcome/components/WalletCreation/WalletCreation.vue', () => ({ default: h.stubChild('WalletCreation') }));
vi.mock('@/modules/welcome/components/LegalFooter/LegalFooter.vue', () => ({ default: h.stubChild('LegalFooter') }));
vi.mock('@/modules/navigation/components/LanguageSelector.vue', () => ({ default: h.stubChild('LanguageSelector') }));
vi.mock('@/modules/welcome/components/onboarding/OnboardingHero.vue', () => ({ default: h.stubChild('OnboardingHero') }));
vi.mock('@/modules/welcome/components/WelcomeHelp/WelcomeHelpPanel.vue', () => ({ default: h.stubChild('WelcomeHelpPanel') }));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({ default: h.stubChild('GButton') }));

import { walletStore } from '@/stores/walletStore';
import { chainAccents } from '@/config/themes';
import Welcome from './Welcome.vue';

const accent = (): string => document.documentElement.style.getPropertyValue('--g-accent');

function render() {
  return mount(Welcome, {
    global: { config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) }, stubs: { 'v-icon': true } },
  });
}

afterEach(() => {
  (walletStore as { loggedWallet: { chain: string } | null }).loggedWallet = null;
  document.documentElement.removeAttribute('style');
});

describe('welcome page accent preview', () => {
  it('previews the selected network while open', () => {
    render();
    expect(accent()).toBe(chainAccents.cardano.accent);
  });

  it('hands the accent back to a wallet signed in while it was open', () => {
    const wrapper = render();
    (walletStore as { loggedWallet: { chain: string } | null }).loggedWallet = { chain: 'Bitcoin' };
    wrapper.unmount();
    expect(accent()).toBe(chainAccents.bitcoin.accent);
  });

  it('hands the accent back to a wallet signed in before it opened', () => {
    (walletStore as { loggedWallet: { chain: string } | null }).loggedWallet = { chain: 'Midnight' };
    const wrapper = render();
    wrapper.unmount();
    expect(accent()).toBe(chainAccents.midnight.accent);
  });

  it('leaves the preview when no wallet is signed in', () => {
    const wrapper = render();
    wrapper.unmount();
    expect(accent()).toBe(chainAccents.cardano.accent);
  });
});
