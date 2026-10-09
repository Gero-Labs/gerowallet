import { nextTick, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HelpUpdate, HelpUpdatesPage } from '@/api/help.api';
import { clearHelpSupport, helpSupportIntent } from '../supportIntent';
import { vBtnStub } from '../helpTestSupport';

const h = vi.hoisted(() => ({
  wallet: { loggedWallet: null as unknown, isLocked: true, isSyncing: false },
  flags: { isInitialized: false, live: false }, saved: { value: false },
  route: { path: '/help', fullPath: '/help?chain=all', query: {} as Record<string, string> },
  pages: {} as Record<string, HelpUpdatesPage>, request: null as unknown as Ref<{ source: string; chain: string; limit?: number }>,
}));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive(h.wallet) }));
vi.mock('@/stores/featureFlagsStore', async () => {
  const state = (await import('vue')).reactive(h.flags);
  return { featureFlagsStore: { state, isLiveChatEnabled: () => state.live } };
});
vi.mock('@/shared/composables/useAvailableWallets', async () => {
  const { reactive, computed: vueComputed } = await import('vue');
  const saved = reactive(h.saved);
  return { useAvailableWallets: () => ({ hasWallets: vueComputed(() => saved.value) }) };
});
vi.mock('vue-router/composables', () => ({ useRoute: () => h.route, useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/shared/composables/useTranslation', async () => {
  const { translate, translateChoice } = await import('../helpTestSupport');
  return { useTranslation: () => ({ t: translate, tc: translateChoice }) };
});
vi.mock('../useHelpUpdates', async () => {
  const { ref: vueRef, computed: vueComputed } = await import('vue');
  return { useHelpUpdates: (request: Ref<{ source: string }>) => {
    h.request = request as never;
    return { page: vueComputed(() => h.pages[request.value.source] ?? null), loading: vueRef(false), failed: vueRef(false), retry: vi.fn(), loadMore: vi.fn() };
  } };
});
import HelpSupportWidget from './HelpSupportWidget.vue';
import HelpMostViewed from './HelpMostViewed.vue';
import HelpXCard from './HelpXCard.vue';
import HelpBlogCard from './HelpBlogCard.vue';
import HelpEcosystemNews from './HelpEcosystemNews.vue';
import HelpTopicsCard from './HelpTopicsCard.vue';
import { answers, topicIndex } from '../helpContent';

const stubs = { 'v-btn': vBtnStub, 'v-icon': true, 'router-link': { props: ['to'], template: '<a :href="to.path"><slot /></a>' } };
const wrappers: Array<ReturnType<typeof mount>> = [];
const show = (component: unknown, propsData: Record<string, unknown> = {}) => { const wrapper = mount(component as never, { propsData, stubs }); wrappers.push(wrapper); return wrapper; };
const eligible = { id: 42, chain: 'Cardano', network: 'Mainnet', type: 'Normal', stakeAddress: 'stake1test' };
beforeEach(() => {
  clearHelpSupport(); h.pages = {};
  h.wallet.loggedWallet = null; h.wallet.isLocked = true; h.wallet.isSyncing = false;
  h.flags.isInitialized = false; h.flags.live = false; h.saved.value = false;
  vi.stubEnv('VITE_BACKEND_URL', 'https://backend.test');
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.destroy()); clearHelpSupport(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('support widget', () => {
  const action = (wrapper: ReturnType<typeof show>) => wrapper.find('.support-action');
  it('asks a saved but locked wallet to unlock, returning to the current Help page', () => {
    h.saved.value = true;
    const wrapper = show(HelpSupportWidget);
    expect(wrapper.find('[data-test="live-chat-status"]').text()).toBe('Unlock your wallet to start a live chat.');
    expect(action(wrapper).text()).toBe('Unlock wallet');
    expect(action(wrapper).attributes('href')).toBe('/welcome?redirect=' + encodeURIComponent('/help?chain=all'));
  });
  it('points a visitor with no wallet at setup', () => {
    const wrapper = show(HelpSupportWidget);
    expect(wrapper.find('[data-test="live-chat-status"]').text()).toBe('Live chat is available once you create or import a wallet.');
    expect(action(wrapper).text()).toBe('Create or import');
    expect(action(wrapper).attributes('href')).toBe('/welcome');
  });
  it('opens Support for an eligible wallet', async () => {
    h.wallet.loggedWallet = eligible; h.wallet.isLocked = false; h.flags.isInitialized = true; h.flags.live = true;
    const wrapper = show(HelpSupportWidget);
    expect(wrapper.find('[data-test="live-chat-status"]').text()).toBe('Your wallet is ready for live chat.');
    expect(action(wrapper).text()).toBe('Contact support');
    await action(wrapper).trigger('click');
    expect(helpSupportIntent.request).toMatchObject({ articleId: undefined });
    expect(helpSupportIntent.request?.sequence).toBeGreaterThan(0);
  });
  it.each([
    ['syncing', { ...eligible }, 'Your wallet is still syncing. You can email support@gerowallet.io while you wait.'],
    ['ineligible', { ...eligible, chain: 'Midnight' }, 'Live chat isn\'t available for this wallet type yet. For help, reach us at support@gerowallet.io.'],
    ['disabled', { ...eligible }, 'Live chat is currently unavailable. Email support@gerowallet.io for help.'],
  ])('keeps the %s notice and offers Contact support', (state, wallet, text) => {
    h.wallet.loggedWallet = wallet; h.wallet.isLocked = false; h.wallet.isSyncing = state === 'syncing';
    h.flags.isInitialized = state !== 'disabled'; h.flags.live = state !== 'disabled';
    const wrapper = show(HelpSupportWidget);
    expect(wrapper.find('[data-test="live-chat-status"]').text()).toBe(text);
    expect(action(wrapper).text()).toBe('Contact support');
  });
  it('shows the email as a mailto link and reports whether copying worked', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const wrapper = show(HelpSupportWidget);
    expect(wrapper.find('a.support-email').attributes('href')).toBe('mailto:support@gerowallet.io');
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    const copy = wrapper.find('.support-copy');
    expect(copy.attributes('aria-label')).toBe('Copy email address');
    await copy.trigger('click'); await nextTick(); await nextTick();
    expect(writeText).toHaveBeenCalledWith('support@gerowallet.io');
    expect(wrapper.find('[role="status"]').text()).toBe('Copied');
    await copy.trigger('click'); await nextTick(); await nextTick();
    expect(wrapper.find('[role="status"]').text()).toBe('Select and copy the email address above.');
    expect(wrapper.find('.support-eligibility').text()).toBe('Live chat currently supports Cardano mainnet software wallets.');
  });
});

describe('most viewed card', () => {
  const items = answers.slice(0, 3);
  it('is titled Most viewed with its caption only when the ranking comes from the backend', () => {
    const ranked = show(HelpMostViewed, { items, ranked: true });
    expect(ranked.find('h2').text()).toBe('Most viewed');
    expect(ranked.find('.viewed-note').text()).toBe('Most read in the last 30 days');
    const fallback = show(HelpMostViewed, { items, ranked: false });
    expect(fallback.find('h2').text()).toBe('Start here');
    expect(fallback.find('.viewed-note').exists()).toBe(false);
  });
  it('numbers each row, captions it with its topic and links through the answer destination', () => {
    const wrapper = show(HelpMostViewed, { items, ranked: false });
    const rows = wrapper.findAll('.viewed-row');
    expect(rows).toHaveLength(3);
    expect(rows.at(0).find('.viewed-num').text()).toBe('1');
    expect(rows.at(0).find('.viewed-title').text()).toBe(items[0].title);
    expect(rows.at(0).find('.t-caption').text()).toBe('Send, receive & swap');
    expect(rows.at(0).attributes('href')).toBe('/help/articles/' + items[0].id);
    expect(wrapper.find('a.g-btn, .g-btn').attributes('href')).toBe('/help/search');
  });
});

describe('Latest on X card', () => {
  const post = (source: string, text: string): HelpUpdatesPage => ({ total: 1, nextCursor: null, sources: [], items: [{
    id: source + ':1', source, kind: 'social', chain: 'all', title: text, summary: text, text, canonicalUrl: 'https://x.com/i/web/status/777', publishedAt: '2026-10-07T09:00:00Z',
    publisher: source, locale: 'en-US', media: [{ url: '/api/help/assets/' + 'c'.repeat(64), alt: 'Screenshot' }] }] });
  it('requests only the newest Gero post first and switches source when Nexus is chosen', async () => {
    h.pages = { 'gero-x': post('gero-x', 'Gero post'), 'nexus-x': post('nexus-x', 'Nexus post') };
    const wrapper = show(HelpXCard);
    expect(h.request.value).toMatchObject({ source: 'gero-x', limit: 1 });
    expect(wrapper.find('.x-text').text()).toBe('Gero post');
    expect(wrapper.find('.x-name').text()).toBe('Gero on X');
    const [gero, nexus] = wrapper.findAll('.x-toggle__button').wrappers;
    expect([gero.attributes('aria-pressed'), nexus.attributes('aria-pressed')]).toEqual(['true', 'false']);
    await nexus.trigger('click'); await nextTick();
    expect(h.request.value).toMatchObject({ source: 'nexus-x', limit: 1 });
    expect([gero.attributes('aria-pressed'), nexus.attributes('aria-pressed')]).toEqual(['false', 'true']);
    expect(wrapper.find('.x-text').text()).toBe('Nexus post');
    expect(wrapper.find('.x-name').text()).toBe('Nexus on X');
  });
  it('shows the post media and opens the original in a new tab', () => {
    h.pages = { 'gero-x': post('gero-x', 'Gero post') };
    const wrapper = show(HelpXCard);
    expect(wrapper.find('.x-media').attributes()).toMatchObject({ src: 'https://backend.test/api/help/assets/' + 'c'.repeat(64), alt: 'Screenshot' });
    const link = wrapper.find('.x-link');
    expect(link.attributes()).toMatchObject({ href: 'https://x.com/i/web/status/777', target: '_blank', rel: 'noopener noreferrer' });
    expect(link.text()).toContain('View on X');
    expect(wrapper.find('.x-meta .t-caption').text()).toBe('Published on X · Oct 7, 2026');
  });
  it('shows a quiet status instead of a frame when there is nothing to show', () => {
    const wrapper = show(HelpXCard);
    expect(wrapper.find('article').exists()).toBe(false);
    expect(wrapper.find('.x-status').text()).toBe('No published updates for this selection.');
    expect(wrapper.find('.x-link').exists()).toBe(false);
  });
});

describe('Gero blog and ecosystem news cards', () => {
  it('asks for one blog post, links it inside the app and omits the image frame when there is no image', () => {
    h.pages = { 'gero-blog': { total: 1, nextCursor: null, sources: [], items: [{ id: 'b', source: 'gero-blog', kind: 'blog', chain: 'all', title: 'Release', summary: 'Notes', publishedAt: '2026-08-19T00:00:00Z',
      publisher: 'Gero blog', locale: 'en-US', destination: { type: 'blog', slug: 'release' }, media: [] }] } };
    const wrapper = show(HelpBlogCard);
    expect(h.request.value).toMatchObject({ source: 'gero-blog', limit: 1 });
    expect(wrapper.find('.blog-link').attributes('href')).toBe('/blog/release');
    expect(wrapper.find('.blog-thumb').exists()).toBe(false);
    expect(wrapper.find('.blog-foot').text()).toBe('Gero blog · Aug 19, 2026');
  });
  it('lists three news items with a freshness dot that turns warning when any source is behind', () => {
    const item = (id: string): HelpUpdate => ({ id, source: 'midnight-news', kind: 'news', chain: 'midnight', title: 'Headline ' + id, summary: '', canonicalUrl: 'https://midnight.network/blog/' + id, publishedAt: '2026-09-28T00:00:00Z', publisher: 'Midnight', locale: 'en-US', media: [] });
    const sources = (status: 'fresh' | 'stale') => [{ source: 'cardano-news', status: 'fresh' as const, lastSuccessfulSyncAt: null }, { source: 'midnight-news', status, lastSuccessfulSyncAt: null }];
    h.pages = { 'ecosystem-news': { total: 3, nextCursor: null, sources: sources('fresh'), items: [item('a'), item('b'), item('c')] } };
    const wrapper = show(HelpEcosystemNews);
    expect(h.request.value).toMatchObject({ source: 'ecosystem-news', limit: 3 });
    expect(wrapper.findAll('.news-row')).toHaveLength(3);
    expect(wrapper.find('.news-row').attributes()).toMatchObject({ href: 'https://midnight.network/blog/a', target: '_blank', rel: 'noopener noreferrer' });
    expect(wrapper.find('.news-fresh').text()).toBe('Up to date');
    expect(wrapper.find('.news-fresh__dot--stale').exists()).toBe(false);
    h.pages = { 'ecosystem-news': { ...h.pages['ecosystem-news'], sources: sources('stale') } };
    const behind = show(HelpEcosystemNews);
    expect(behind.find('.news-fresh').text()).toBe('Last available snapshot');
    expect(behind.find('.news-fresh__dot--stale').exists()).toBe(true);
  });
});

describe('topics card', () => {
  it('keeps a demoted topic reachable with its reason instead of a count, and links with the basic flag when needed', () => {
    const topics = topicIndex({ chain: 'midnight', features: {} });
    const wrapper = show(HelpTopicsCard, { topics, basic: true });
    const tiles = wrapper.findAll('.topic-tile');
    expect(tiles).toHaveLength(6);
    const card = tiles.wrappers.find(tile => tile.text().includes('Gero Card'))!;
    expect(card.classes()).toContain('topic-tile--muted');
    expect(card.text()).toContain('Cardano only');
    expect(card.text()).not.toContain('answers');
    expect(tiles.at(0).text()).toContain('answers');
  });
});
