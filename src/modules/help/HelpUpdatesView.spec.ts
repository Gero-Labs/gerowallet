import Vue, { ref } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HelpUpdatesPage } from '@/api/help.api';
const state = vi.hoisted(() => ({ route: { query: { source: 'blog' } as Record<string, string> }, push: vi.fn(), updates: {} as Record<string, unknown> }));
vi.mock('vue-router/composables', () => ({ useRoute: () => state.route, useRouter: () => ({ push: state.push }) }));
vi.mock('./useHelpUpdates', () => ({ useHelpUpdates: () => state.updates }));
vi.mock('@/shared/composables/useTranslation', async () => {
  const { translate, translateChoice } = await import('./helpTestSupport');
  return { useTranslation: () => ({ t: translate, tc: translateChoice }) };
});
vi.mock('@/modules/blog/Blog.vue', () => ({ default: { render: (h: Vue.CreateElement) => h('div', { class: 'legacy-blog' }, 'Published blog') } }));
import HelpUpdates from './HelpUpdates.vue';
beforeEach(() => {
  vi.stubEnv('VITE_BACKEND_URL', 'https://backend.test');
  state.route.query = { source: 'blog' };
  state.push.mockReset().mockResolvedValue(undefined);
  Object.assign(state.updates, { page: ref({ items: [], total: 0, nextCursor: null, sources: [{ source: 'gero-blog', status: 'unavailable' }] }), loading: ref(false), failed: ref(false), retry: vi.fn(), loadMore: vi.fn() });
});
afterEach(() => vi.unstubAllEnvs());
function render(chain = 'all') {
  return mount(HelpUpdates, { propsData: { chain }, stubs: {
    'router-link': { props: ['to'], template: '<a :href="typeof to === \'string\' ? to : to.path"><slot /></a>' },
    'v-btn': { template: '<button @click="$emit(\'click\')"><slot /></button>' }, 'v-icon': true,
  } });
}
const fresh = (source: string) => ({ source, status: 'fresh' as const, lastSuccessfulSyncAt: '2026-10-09T08:00:00Z' });
const buttonLabelled = (wrapper: ReturnType<typeof render>, text: string) => wrapper.findAll('button').wrappers.find(button => button.text() === text)!;

it('renders mirrored Blog thumbnails while keeping the article link inside the wallet', () => {
  Object.assign(state.updates, { page: ref({ items: [{ id: 'blog:post', kind: 'blog', source: 'gero-blog', title: 'Wallet guide', summary: 'A short guide.',
    destination: { type: 'blog', slug: 'wallet-guide' }, publisher: 'Gero', publishedAt: '2026-08-20T00:00:00Z',
    media: [{ url: '/api/blog/assets/asset_thumb_1234abcd', alt: 'Wallet guide' }] }], total: 1, nextCursor: null, sources: [] }) });
  const wrapper = render();
  expect(wrapper.find('.update-thumb').attributes('src')).toBe('https://backend.test/api/blog/assets/asset_thumb_1234abcd');
  expect(wrapper.find('.update-thumb').attributes('alt')).toBe('');
  expect(wrapper.find('a.update-row').attributes('href')).toBe('/blog/wallet-guide');
  expect(wrapper.find('.update-title').text()).toBe('Wallet guide');
  expect(wrapper.find('.update-caption').text()).toBe('Gero blog · Aug 20, 2026');
  wrapper.destroy();
});
it('shows the legacy Blog for a successful response with an unavailable empty Blog source', () => {
  const wrapper = render();
  expect(wrapper.find('.legacy-blog').exists()).toBe(true);
  expect(wrapper.text()).not.toContain('No published updates for this selection.'); wrapper.destroy();
});
it('honors authoritative empty Blog snapshots instead of showing withdrawn posts', () => {
  (state.updates.page as { value: HelpUpdatesPage }).value.sources[0].status = 'fresh';
  const wrapper = render(); expect(wrapper.find('.legacy-blog').exists()).toBe(false);
  expect(wrapper.text()).toContain('No published updates for this selection.'); wrapper.destroy();
});
it('keeps an invalid-link row readable and preserves pagination without an unsafe link', async () => {
  state.route.query = { source: 'nexus-x' };
  Object.assign(state.updates, { page: ref({ items: [{ id: 'post', kind: 'social', source: 'nexus-x', title: 'Visible post', text: 'Post text', canonicalUrl: 'javascript:alert(1)', media: [], publisher: 'Nexus' }], total: 2, nextCursor: 'next', sources: [] }) });
  const wrapper = render(); const row = wrapper.find('.update-row');
  expect(row.element.tagName).toBe('ARTICLE'); expect(row.text()).toContain('Post text'); expect(row.find('a').exists()).toBe(false);
  expect(wrapper.find('.update-arrow').exists()).toBe(false);
  const more = buttonLabelled(wrapper, 'Load more updates');
  await more.trigger('click'); expect(state.updates.loadMore).toHaveBeenCalled(); wrapper.destroy();
});
it('links social posts to the original in a new tab and shows their full text with media below', () => {
  state.route.query = { source: 'gero-x' };
  Object.assign(state.updates, { page: ref({ items: [{ id: 'x1', kind: 'social', source: 'gero-x', title: 'Post', text: 'Full post text', summary: 'Short',
    canonicalUrl: 'https://x.com/i/web/status/12345', publishedAt: '2026-10-07T09:00:00Z', publisher: 'Gero',
    media: [{ url: '/api/help/assets/' + 'a'.repeat(64), alt: 'A screenshot' }, { url: 'https://evil.test/x.png', alt: 'dropped' }] }], total: 1, nextCursor: null, sources: [] }) });
  const wrapper = render(); const row = wrapper.find('a.update-row');
  expect(row.attributes()).toMatchObject({ href: 'https://x.com/i/web/status/12345', target: '_blank', rel: 'noopener noreferrer' });
  expect(row.find('.update-social').text()).toBe('Full post text');
  expect(row.find('.update-caption').text()).toBe('Gero on X · Oct 7, 2026');
  const media = row.findAll('.update-media'); expect(media).toHaveLength(1);
  expect(media.at(0).attributes('alt')).toBe('A screenshot'); wrapper.destroy();
});

it('offers one pill per source with its freshness, and filters to the active chain', () => {
  state.route.query = { source: 'all' };
  Object.assign(state.updates, { page: ref({ items: [], total: 0, nextCursor: null, sources: [fresh('gero-blog'), { ...fresh('cardano-news'), status: 'stale' }, fresh('midnight-news'), fresh('bitcoin-news'), fresh('gero-x'), fresh('nexus-x')] }) });
  const all = render();
  const group = all.find('[role="group"]');
  expect(group.findAll('button').wrappers.map(button => button.text())).toEqual(['All updates', 'Gero blog', 'Cardano', 'Midnight', 'Bitcoin Core updates', 'Gero on X', 'Nexus on X']);
  expect(group.findAll('button').at(0).attributes('aria-pressed')).toBe('true');
  expect(buttonLabelled(all, 'Cardano').attributes('aria-label')).toBe('Cardano, Last available snapshot');
  expect(buttonLabelled(all, 'Midnight').attributes('aria-label')).toBe('Midnight, Up to date');
  expect(buttonLabelled(all, 'Cardano').find('.pill-dot--stale').exists()).toBe(true);
  expect(buttonLabelled(all, 'Midnight').find('.pill-dot').classes()).not.toContain('pill-dot--stale');
  all.destroy();
  const midnight = render('midnight');
  expect(midnight.find('[role="group"]').findAll('button').wrappers.map(button => button.text())).toEqual(['All updates', 'Gero blog', 'Midnight', 'Gero on X', 'Nexus on X']);
  midnight.destroy();
});
it('sets ?source= from a pill and keeps ecosystem-news valid without pressing a pill', async () => {
  state.route.query = { source: 'ecosystem-news' };
  const wrapper = render('cardano');
  expect(wrapper.findAll('[role="group"] button').wrappers.some(button => button.attributes('aria-pressed') === 'true')).toBe(false);
  await buttonLabelled(wrapper, 'Gero on X').trigger('click');
  expect(state.push).toHaveBeenCalledWith({ path: '/help/updates', query: { source: 'gero-x', chain: 'cardano' } });
  wrapper.destroy();
});

it('names a single stale source with its check date and counts the others in plural form', () => {
  state.route.query = { source: 'all' };
  Object.assign(state.updates, { page: ref({ items: [], total: 0, nextCursor: null, sources: [fresh('gero-blog'), { ...fresh('cardano-news'), status: 'stale', lastSuccessfulSyncAt: '2026-10-08T06:00:00Z' }, fresh('midnight-news'), fresh('bitcoin-news'), fresh('gero-x'), fresh('nexus-x')] }) });
  const wrapper = render();
  expect(wrapper.find('.updates-warning').attributes('role')).toBe('status');
  expect(wrapper.find('.updates-warning p').text()).toBe('Cardano is showing its last available snapshot, checked Oct 8, 2026. The other 5 sources are up to date.');
  wrapper.destroy();
});
it('uses the singular form when exactly one other source is up to date', () => {
  state.route.query = { source: 'ecosystem-news' };
  Object.assign(state.updates, { page: ref({ items: [], total: 0, nextCursor: null, sources: [{ ...fresh('cardano-news'), status: 'stale' }, fresh('midnight-news')] }) });
  const wrapper = render();
  expect(wrapper.find('.updates-warning p').text()).toContain('The other source is up to date.'); wrapper.destroy();
});
it('summarises several stale sources and shows no box when every visible source is fresh', () => {
  state.route.query = { source: 'all' };
  Object.assign(state.updates, { page: ref({ items: [], total: 0, nextCursor: null, sources: [{ ...fresh('cardano-news'), status: 'stale' }, { ...fresh('midnight-news'), status: 'unavailable' }, fresh('gero-x')] }) });
  const stale = render();
  expect(stale.find('.updates-warning p').text()).toBe('Some sources are showing their last available snapshot.'); stale.destroy();
  Object.assign(state.updates, { page: ref({ items: [], total: 0, nextCursor: null, sources: [fresh('cardano-news'), fresh('midnight-news'), fresh('gero-x')] }) });
  const calm = render(); expect(calm.find('.updates-warning').exists()).toBe(false); calm.destroy();
});
it('ignores a stale source that the chain filter hides', () => {
  state.route.query = { source: 'all' };
  Object.assign(state.updates, { page: ref({ items: [], total: 0, nextCursor: null, sources: [{ ...fresh('cardano-news'), status: 'stale' }, fresh('midnight-news')] }) });
  const wrapper = render('midnight'); expect(wrapper.find('.updates-warning').exists()).toBe(false); wrapper.destroy();
});
it('marks items from a stale source in their caption', () => {
  state.route.query = { source: 'cardano-news' };
  Object.assign(state.updates, { page: ref({ items: [{ id: 'n1', kind: 'news', source: 'cardano-news', title: 'Headline', summary: 'Summary', canonicalUrl: 'https://cardano.org/news/x', publishedAt: '2026-09-30T00:00:00Z', media: [], publisher: 'Cardano' }],
    total: 1, nextCursor: null, sources: [{ ...fresh('cardano-news'), status: 'stale' }] }) });
  const wrapper = render(); expect(wrapper.find('.update-caption').text()).toBe('Cardano · Sep 30, 2026 · Last available snapshot');
  expect(wrapper.find('.update-arrow').exists()).toBe(true); wrapper.destroy();
});
