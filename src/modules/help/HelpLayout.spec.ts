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

beforeEach(() => { h.wallet.loggedWallet = null; h.wallet.isLocked = true; h.wallet.isSyncing = false; vi.clearAllMocks(); });
describe('HelpLayout', () => {
  it('opens a new article at the top and restores the search position when returning', async () => {
    h.route.fullPath = '/help/search?q=proof';
    const wrapper = mount(HelpLayout, { slots: { default: '<article>Content</article>' }, stubs: {
      'v-app': { template: '<div><slot /></div>' }, 'v-main': { template: '<div><slot /></div>' },
      'router-link': { template: '<a><slot /></a>' }, GButton: true,
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
      'router-link': { template: '<a><slot /></a>' }, GButton: true,
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
});
