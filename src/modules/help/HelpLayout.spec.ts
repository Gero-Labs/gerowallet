import Vue, { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  wallet: { loggedWallet: null as unknown, isLocked: true, isSyncing: false },
  route: { fullPath: '/help/articles/backup?q=recovery&chain=midnight', path: '/help/articles/backup', query: {} },
  replace: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive(h.wallet) }));
vi.mock('@/shared/composables/useAvailableWallets', async () => {
  const { ref } = await import('vue');
  return { useAvailableWallets: () => ({ hasWallets: ref(false) }) };
});
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('vue-router/composables', async () => {
  h.route = (await import('vue')).reactive(h.route);
  return { useRoute: () => h.route, useRouter: () => ({ replace: h.replace }) };
});
vi.mock('@/modules/navigation/layouts/ContentLayout.vue', () => ({ default: {
  render(h: Vue.CreateElement) { return h('div', { attrs: { 'data-test': 'wallet-chrome' } }, [h('div', { attrs: { 'data-help-scroll': '' } }, this.$scopedSlots['help-content']?.())]); },
} }));
vi.mock('./HelpSupportAction.vue', () => ({ default: { render: (h: Vue.CreateElement) => h('div') } }));
vi.mock('@/modules/navigation/components/LanguageSelector.vue', () => ({ default: { render: (h: Vue.CreateElement) => h('div') } }));
import HelpLayout from './HelpLayout.vue';

beforeEach(() => {
  h.wallet.loggedWallet = null; h.wallet.isLocked = true; h.wallet.isSyncing = false; vi.clearAllMocks();
  h.route.path = '/help/articles/backup'; h.route.fullPath = '/help/articles/backup?q=recovery&chain=midnight';
});
describe('HelpLayout', () => {
  it('opens a new article at the top and restores the search position when returning', async () => {
    h.route.fullPath = '/help/search?q=proof';
    const wrapper = mount(HelpLayout, { slots: { default: '<article>Content</article>' }, stubs: {
      'v-app': { template: '<div><slot /></div>' }, 'v-main': { template: '<div><slot /></div>' },
      'router-link': { template: '<a><slot /></a>' }, 'v-btn': { template: '<button><slot /></button>' }, 'v-icon': true,
    } });
    const scroll = wrapper.find('[data-help-scroll]').element as HTMLElement;
    scroll.scrollTop = 600;
    h.route.fullPath = '/help/articles/midnight-proof?q=proof'; await nextTick(); await nextTick();
    expect(scroll.scrollTop).toBe(0);
    h.route.fullPath = '/help/search?q=proof'; await nextTick(); await nextTick();
    expect(scroll.scrollTop).toBe(600); wrapper.destroy();
  });
  it('renders without wallet chrome when public or syncing, and retains route/content on lock', async () => {
    const wrapper = mount(HelpLayout, { slots: { default: '<article>Recovery answer</article>' }, stubs: {
      'v-app': { template: '<div><slot /></div>' }, 'v-main': { template: '<div><slot /></div>' },
      'router-link': { template: '<a><slot /></a>' }, 'v-btn': { template: '<button><slot /></button>' }, 'v-icon': true,
    } });
    expect(wrapper.find('[data-test="wallet-chrome"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Recovery answer');
    h.wallet.loggedWallet = { id: 1 }; h.wallet.isLocked = false; h.wallet.isSyncing = true;
    await nextTick();
    expect(wrapper.find('[data-test="wallet-chrome"]').exists()).toBe(false);
    h.wallet.isSyncing = false; await nextTick(); await nextTick();
    expect(wrapper.find('[data-test="wallet-chrome"]').exists()).toBe(true);
    (wrapper.find('[data-help-scroll]').element as HTMLElement).scrollTop = 240;
    h.wallet.isLocked = true; await Vue.nextTick(); await nextTick();
    expect(wrapper.find('[data-test="wallet-chrome"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Recovery answer');
    expect((wrapper.find('[data-help-scroll]').element as HTMLElement).scrollTop).toBe(240);
    expect(h.replace).not.toHaveBeenCalled();
    wrapper.destroy();
  });
  it('puts the three tabs and one Contact support in the public header, with no unlock action', async () => {
    h.route.path = '/help/updates'; h.route.fullPath = '/help/updates?chain=all';
    const wrapper = mount(HelpLayout, { slots: { default: '<article>Content</article>' }, stubs: {
      'v-app': { template: '<div><slot /></div>' }, 'v-main': { template: '<div><slot /></div>' },
      'router-link': { props: ['to'], template: '<a><slot /></a>' }, 'v-btn': { template: '<button><slot /></button>' }, 'v-icon': true,
    } });
    const tabs = wrapper.findAll('nav a');
    expect(tabs.wrappers.map(tab => tab.text())).toEqual(['help.overview', 'help.answers', 'help.updates']);
    expect(tabs.wrappers.map(tab => tab.attributes('aria-current'))).toEqual([undefined, undefined, 'page']);
    expect(wrapper.find('header').classes()).toContain('glass-chrome');
    expect(wrapper.text().split('help.contact').length - 1).toBe(1);
    expect(wrapper.text()).not.toContain('help.unlock');
    expect(wrapper.text()).not.toContain('help.setup');
    wrapper.destroy();
  });
  it('keeps the article tab current while reading an article', () => {
    h.route.path = '/help/articles/backup'; h.route.fullPath = '/help/articles/backup';
    const wrapper = mount(HelpLayout, { slots: { default: '<article>Content</article>' }, stubs: {
      'v-app': { template: '<div><slot /></div>' }, 'v-main': { template: '<div><slot /></div>' },
      'router-link': { props: ['to'], template: '<a><slot /></a>' }, 'v-btn': { template: '<button><slot /></button>' }, 'v-icon': true,
    } });
    expect(wrapper.findAll('nav a').wrappers.map(tab => tab.attributes('aria-current'))).toEqual([undefined, 'page', undefined]);
    wrapper.destroy();
  });
  it('renders the same tab row and Contact support at the top of the page inside the wallet shell', async () => {
    h.route.path = '/help'; h.route.fullPath = '/help?chain=all';
    h.wallet.loggedWallet = { id: 1 }; h.wallet.isLocked = false; h.wallet.isSyncing = false;
    const wrapper = mount(HelpLayout, { slots: { default: '<article>Content</article>' }, stubs: {
      'router-link': { props: ['to'], template: '<a><slot /></a>' }, 'v-btn': { template: '<button><slot /></button>' }, 'v-icon': true,
    } });
    const chrome = wrapper.find('[data-test="wallet-chrome"]');
    expect(chrome.exists()).toBe(true);
    expect(chrome.findAll('nav a').wrappers.map(tab => tab.text())).toEqual(['help.overview', 'help.answers', 'help.updates']);
    expect(chrome.find('nav a[aria-current="page"]').text()).toBe('help.overview');
    expect(chrome.text().split('help.contact').length - 1).toBe(1);
    expect(chrome.find('header').exists()).toBe(false);
    wrapper.destroy();
  });
});

