import Vue, { nextTick } from 'vue';
import Vuetify from 'vuetify';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/geroStore', () => ({
  geroStore: Vue.observable({ config: { locale: 'us' }, wallets: {} }),
  default: { setConfig: vi.fn(), setWalletName: vi.fn() },
}));
vi.mock('@/stores/walletStore', async () => {
  const { geroStore } = await import('@/stores/geroStore');
  return {
    walletStore: Vue.observable({ config: { currency: 'usd' }, loggedWallet: { id: 1, name: 'Test', icon: 'https://example.com/avatar.png' } }),
    default: { setLocale: vi.fn(async (locale: string) => { geroStore.config.locale = locale; }) },
  };
});
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/composables/useCurrencyConverter', () => ({ useCurrencyConverter: () => ({ resetRateLoaded: vi.fn() }) }));
vi.mock('@/shared/composables/useFeatureNotifications', () => ({ isFeatureNew: () => false, markFeatureAsSeen: vi.fn() }));
vi.mock('@/db/wallet-db', () => ({ setWalletConfiguration: vi.fn() }));
vi.mock('@/utils/assets', () => ({ default: { resolveIcon: () => '' } }));
vi.mock('@/utils/rules', () => ({ default: { required: () => true, minCharacters: () => true, maxCharacters: () => true } }));
vi.mock('./EditableTextField.vue', () => ({ default: { render: (h: Vue.CreateElement) => h('div') } }));
vi.mock('@/modules/dashboard/dialogs/ProfilePictureDialog.vue', () => ({ default: { render: (h: Vue.CreateElement) => h('div') } }));

import ProfileTabSfc from './ProfileTab.vue';
import { geroStore } from '@/stores/geroStore';
import WalletStore from '@/stores/walletStore';

Vue.use(Vuetify);
const ProfileTab = ProfileTabSfc as unknown as Parameters<typeof mount>[0];
function mountProfile() {
  return mount(ProfileTab, {
    vuetify: new Vuetify(),
    mocks: { $t: (key: string) => key },
    stubs: { 'v-tab-item': { template: '<div><slot /></div>' }, flag: true, NotificationDot: { template: '<div><slot /></div>' } },
  });
}
function languageSelect(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAllComponents({ name: 'v-select' }).at(1);
}
function chooseLanguage(select: ReturnType<typeof languageSelect>, iso: string) {
  const item = (select.props('items') as { name: string; iso: string }[]).find(language => language.iso === iso)!;
  // Exercise Vuetify's item-to-value conversion, including the item-value prop.
  (select.vm as Vue & { selectItem: (selected: typeof item) => void }).selectItem(item);
}

describe('wallet settings language selection', () => {
  beforeEach(() => {
    geroStore.config.locale = 'us';
    vi.mocked(WalletStore.setLocale).mockClear();
  });

  it('offers Spanish and saves its locale code when selected', async () => {
    const wrapper = mountProfile();
    const select = languageSelect(wrapper);
    expect(select.props('items')).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Español', iso: 'es' })]));
    expect(select.props('itemValue')).toBe('iso');
    chooseLanguage(select, 'es');
    await nextTick();
    expect(WalletStore.setLocale).toHaveBeenCalledWith('es');
    expect(select.props('value')).toBe('es');
    expect(select.text()).toContain('Español');
    wrapper.destroy();
  });

  it('shows saved Spanish after reopening and follows changes from the welcome screen', async () => {
    geroStore.config.locale = 'es';
    const wrapper = mountProfile();
    const select = languageSelect(wrapper);
    expect(select.props('value')).toBe('es');
    expect(select.text()).toContain('Español');
    geroStore.config.locale = 'de';
    await nextTick();
    expect(select.props('value')).toBe('de');
    expect(select.text()).toContain('Deutsch');
    expect(WalletStore.setLocale).not.toHaveBeenCalled();
    wrapper.destroy();
  });

  it('ignores unsupported locales and reselecting the current language', async () => {
    const wrapper = mountProfile();
    const select = languageSelect(wrapper);
    select.vm.$emit('input', 'us');
    select.vm.$emit('input', 'fr');
    await nextTick();
    expect(WalletStore.setLocale).not.toHaveBeenCalled();
    expect(select.props('value')).toBe('us');
    wrapper.destroy();
  });

  it('follows the saved language if the store rolls back a failed change', async () => {
    vi.mocked(WalletStore.setLocale).mockImplementationOnce(async (locale: string) => {
      geroStore.config.locale = locale;
      await nextTick();
      // GeroStore.setLocale restores the previous preference on a DB failure.
      geroStore.config.locale = 'us';
    });
    const wrapper = mountProfile();
    const select = languageSelect(wrapper);
    chooseLanguage(select, 'es');
    await nextTick();
    await nextTick();
    expect(select.props('value')).toBe('us');
    expect(select.text()).toContain('English (US)');
    wrapper.destroy();
  });
});
