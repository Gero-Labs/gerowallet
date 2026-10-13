import { mockGlobalProperties } from '@test/helpers/globalProperties';
import * as Vue from 'vue';
import { nextTick } from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/geroStore', () => ({
  geroStore: Vue.reactive({ config: { locale: 'us' }, wallets: {} }),
  default: { setConfig: vi.fn(), setWalletName: vi.fn() },
}));
vi.mock('@/stores/walletStore', async () => {
  const { geroStore } = await import('@/stores/geroStore');
  return {
    walletStore: Vue.reactive({ config: { currency: 'usd' }, loggedWallet: { id: 1, name: 'Test', icon: 'https://example.com/avatar.png' } }),
    default: { setLocale: vi.fn(async (locale: string) => { geroStore.config.locale = locale; }) },
  };
});
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/composables/useCurrencyConverter', () => ({ useCurrencyConverter: () => ({ resetRateLoaded: vi.fn() }) }));
vi.mock('@/shared/composables/useFeatureNotifications', () => ({ isFeatureNew: () => false, markFeatureAsSeen: vi.fn() }));
vi.mock('@/db/wallet-db', () => ({ setWalletConfiguration: vi.fn() }));
vi.mock('@/utils/assets', () => ({ default: { resolveIcon: () => '' } }));
vi.mock('@/utils/rules', () => ({ default: { required: () => true, minCharacters: () => true, maxCharacters: () => true } }));
vi.mock('./EditableTextField.vue', () => ({ default: { render: () => Vue.h('div') } }));
vi.mock('@/modules/dashboard/dialogs/ProfilePictureDialog.vue', () => ({ default: { render: () => Vue.h('div') } }));

import ProfileTabSfc from './ProfileTab.vue';
import { geroStore } from '@/stores/geroStore';
import WalletStore from '@/stores/walletStore';

enableAutoUnmount(afterEach);

const ProfileTab = ProfileTabSfc as unknown as Parameters<typeof mount>[0];
function mountProfile() {
  return mount(ProfileTab, { attachTo: document.body, global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) }, stubs: { 'v-window-item': { template: '<div><slot /></div>' }, flag: true, NotificationDot: { template: '<div><slot /></div>' } } } });
}
function languageSelect(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAllComponents({ name: 'VSelect' }).find(select => select.props('itemValue') === 'iso')!;
}
async function chooseLanguage(select: ReturnType<typeof languageSelect>, iso: string) {
  const item = (select.props('items') as { name: string; iso: string }[]).find(language => language.iso === iso)!;
  // Drive the real menu: item-to-value conversion and custom item slot click binding both matter.
  await select.find('input').trigger('keydown', { key: 'ArrowDown' });
  await flushPromises();
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(entry => entry.textContent?.includes(item.name));
  expect(option, 'language option is rendered by the real VSelect menu').toBeDefined();
  option!.click();
  await flushPromises();
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
    await chooseLanguage(select, 'es');
    await nextTick();
    expect(WalletStore.setLocale).toHaveBeenCalledWith('es');
    expect(select.props('modelValue')).toBe('es');
    expect(select.text()).toContain('Español');
  });

  it('shows saved Spanish after reopening and follows changes from the welcome screen', async () => {
    geroStore.config.locale = 'es';
    const wrapper = mountProfile();
    const select = languageSelect(wrapper);
    expect(select.props('modelValue')).toBe('es');
    expect(select.text()).toContain('Español');
    geroStore.config.locale = 'de';
    await nextTick();
    expect(select.props('modelValue')).toBe('de');
    expect(select.text()).toContain('Deutsch');
    expect(WalletStore.setLocale).not.toHaveBeenCalled();
  });

  it('ignores unsupported locales and reselecting the current language', async () => {
    const wrapper = mountProfile();
    const select = languageSelect(wrapper);
    select.vm.$emit('update:modelValue', 'us');
    select.vm.$emit('update:modelValue', 'fr');
    await nextTick();
    expect(WalletStore.setLocale).not.toHaveBeenCalled();
    expect(select.props('modelValue')).toBe('us');
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
    await chooseLanguage(select, 'es');
    await nextTick();
    await nextTick();
    expect(select.props('modelValue')).toBe('us');
    expect(select.text()).toContain('English (US)');
  });
});
