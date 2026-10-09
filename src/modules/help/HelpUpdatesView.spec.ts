import Vue, { ref } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HelpUpdatesPage } from '@/api/help.api';
const state = vi.hoisted(() => ({ route: { query: { source: 'blog' } }, updates: {} as Record<string, unknown> }));
vi.mock('vue-router/composables', () => ({ useRoute: () => state.route }));
vi.mock('./useHelpUpdates', () => ({ useHelpUpdates: () => state.updates }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/modules/blog/Blog.vue', () => ({ default: { render: (h: Vue.CreateElement) => h('div', { class: 'legacy-blog' }, 'Published blog') } }));
import HelpUpdates from './HelpUpdates.vue';
beforeEach(() => {
  vi.stubEnv('VITE_BACKEND_URL', 'https://backend.test');
  state.route.query.source = 'blog';
  Object.assign(state.updates, { page: ref({ items: [], total: 0, nextCursor: null, sources: [{ source: 'gero-blog', status: 'unavailable' }] }), loading: ref(false), failed: ref(false), retry: vi.fn(), loadMore: vi.fn() });
});
it('renders mirrored Blog thumbnails while keeping the article link inside the wallet', () => {
  Object.assign(state.updates, { page: ref({ items: [{ id: 'blog:post', kind: 'blog', source: 'gero-blog', title: 'Wallet guide',
    destination: { type: 'blog', slug: 'wallet-guide' }, publisher: 'Gero',
    media: [{ url: '/api/blog/assets/asset_thumb_1234abcd', alt: 'Wallet guide' }] }], total: 1, nextCursor: null, sources: [] }) });
  const wrapper = render();
  expect(wrapper.find('img').attributes('src')).toBe('https://backend.test/api/blog/assets/asset_thumb_1234abcd');
  expect(wrapper.find('img').attributes('alt')).toBe('Wallet guide');
  expect(wrapper.find('.update-title').attributes('href')).toBe('/blog/wallet-guide');
  wrapper.destroy();
});
afterEach(() => vi.unstubAllEnvs());
function render() { return mount(HelpUpdates, { propsData: { chain: 'all' }, stubs: { 'router-link': { props: ['to'], template: '<a :href="typeof to === \'string\' ? to : to.path"><slot /></a>' }, 'v-btn': { template: '<button @click="$emit(\'click\')"><slot /></button>' } } }); }
it('shows the legacy Blog for a successful response with an unavailable empty Blog source', () => {
  const wrapper = render();
  expect(wrapper.find('.legacy-blog').exists()).toBe(true);
  expect(wrapper.text()).not.toContain('help.noUpdates'); wrapper.destroy();
});
it('honors authoritative empty Blog snapshots instead of showing withdrawn posts', () => {
  (state.updates.page as { value: HelpUpdatesPage }).value.sources[0].status = 'fresh';
  const wrapper = render(); expect(wrapper.find('.legacy-blog').exists()).toBe(false);
  expect(wrapper.text()).toContain('help.noUpdates'); wrapper.destroy();
});
it('keeps an invalid-link row readable and preserves pagination without an unsafe link', async () => {
  state.route.query.source = 'nexus-x';
  Object.assign(state.updates, { page: ref({ items: [{ id: 'post', kind: 'social', source: 'nexus-x', title: 'Visible post', text: 'Post text', canonicalUrl: 'javascript:alert(1)', media: [], publisher: 'Nexus' }], total: 2, nextCursor: 'next', sources: [] }) });
  const wrapper = render(); const row = wrapper.find('.update-row');
  expect(row.find('h2').text()).toBe('Visible post'); expect(row.find('a').exists()).toBe(false);
  expect(wrapper.html()).toContain('help.loadMoreUpdates');
  expect(wrapper.find('button').text()).toBe('help.loadMoreUpdates');
  await wrapper.find('button').trigger('click'); expect(state.updates.loadMore).toHaveBeenCalled(); wrapper.destroy();
});
