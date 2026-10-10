import Vue, { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HelpResult } from '@/api/help.api';
import { helpSearchIntent } from './helpSearchIntent';
import HelpCenter from './HelpCenter.vue';

const h = vi.hoisted(() => ({
  wallet: { loggedWallet: null as unknown, isLocked: true, isSyncing: false },
  route: { path: '/help/search', fullPath: '/help/search?q=backup', query: { q: 'backup' } as Record<string, string>, params: {} as Record<string, string> },
  content: null as unknown as Record<string, { value: unknown }>,
  track: vi.fn(),
}));
vi.mock('./helpAnalytics', () => ({ trackHelp: h.track }));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive(h.wallet) }));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { state: { isInitialized: false } } }));
vi.mock('@/utils/networks', () => ({ default: { resolveGeroCardSupport: () => false } }));
vi.mock('@/plugins/i18n', () => ({ default: { locale: 'us' } }));
vi.mock('vue-router/composables', async () => {
  const route = (await import('vue')).reactive(h.route);
  return { useRoute: () => route, useRouter: () => ({ replace: vi.fn().mockResolvedValue(undefined), push: vi.fn() }) };
});
vi.mock('@/shared/composables/useTranslation', async () => {
  const { translate, translateChoice } = await import('./helpTestSupport');
  return { useTranslation: () => ({ t: translate, tc: translateChoice }) };
});
// The page's own loading is covered by useHelpContent.spec; here the test decides what has loaded.
vi.mock('./useHelpContent', async () => {
  const { ref } = await import('vue');
  return { useHelpContent: () => (h.content = {
    home: ref(null), article: ref(null), results: ref([]), total: ref(0), nextCursor: ref(null),
    loading: ref(true), failed: ref(false), resolved: ref(false), stale: ref(false), loadMore: vi.fn(), retry: vi.fn(),
  } as unknown as typeof h.content) };
});
// The sections are covered by their own specs; here each is just a marker.
vi.mock('./home/HelpHomeDashboard.vue', () => ({ default: { render: (c: Vue.CreateElement) => c('div', { class: 'home' }) } }));
vi.mock('./HelpReader.vue', () => ({ default: { render: (c: Vue.CreateElement) => c('div', { class: 'reader' }) } }));
vi.mock('./HelpUpdates.vue', () => ({ default: { render: (c: Vue.CreateElement) => c('div', { class: 'updates' }) } }));
vi.mock('./HelpChainPills.vue', () => ({ default: { render: (c: Vue.CreateElement) => c('div', { class: 'pills' }) } }));
vi.mock('./HelpContentStatus.vue', () => ({ default: { render: (c: Vue.CreateElement) => c('div', { class: 'status' }) } }));
vi.mock('./HelpSearchForm.vue', () => ({ default: { render: (c: Vue.CreateElement) => c('form', { class: 'search' }) } }));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({ default: { render(this: Vue, c: Vue.CreateElement) { return c('button', { on: this.$listeners }, this.$slots['default']); } } }));

const published = (id: string): HelpResult => ({
  id, slug: id, title: 'Keep your recovery phrase safe', summary: 'Back it up', snippet: '', kind: 'guide', topic: 'security', source: 'gero-help', locale: 'en-US', revision: 1, readingMinutes: 2,
  applicability: { chains: [], networks: [], walletTypes: [], requiredFeatures: [] },
});
const wrappers: Array<ReturnType<typeof mount>> = [];
function show() {
  const wrapper = mount(HelpCenter, { stubs: { 'router-link': { props: ['to'], template: '<a><slot /></a>' } } });
  wrappers.push(wrapper);
  return wrapper;
}
const settle = (patch: Record<string, unknown>) => { for (const [key, value] of Object.entries(patch)) h.content[key]!.value = value; return nextTick(); };
const counted = () => h.track.mock.calls.map(([event]) => event);
const search = (subject: string, chain = 'all') => ({ type: 'search', subject, surface: 'help', chain });

beforeEach(() => {
  h.track.mockReset();
  Object.assign(h.route, { path: '/help/search', fullPath: '/help/search?q=backup', query: { q: 'backup' }, params: {} });
  helpSearchIntent.pending = null;
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.destroy()); helpSearchIntent.pending = null; });

describe('Help search outcome', () => {
  it('counts a submitted search as "results" only after the published results have loaded', async () => {
    helpSearchIntent.pending = 'backup';
    const wrapper = show();
    await nextTick();
    expect(counted()).toEqual([]);
    expect(helpSearchIntent.pending).toBe('backup');
    await settle({ results: [published('backup')], total: 1, loading: false, resolved: true });
    expect(counted()).toEqual([search('results')]);
    expect(helpSearchIntent.pending).toBeNull();
    expect(wrapper.find('.result-row').exists()).toBe(true);
  });

  it('counts "empty" when the published search found nothing, with the Help chain filter', async () => {
    h.route.query = { q: 'backup', chain: 'bitcoin' };
    helpSearchIntent.pending = 'backup';
    show();
    await settle({ loading: false, resolved: true });
    expect(counted()).toEqual([search('empty', 'bitcoin')]);
  });

  it('counts results that the chain filter hides as "empty", like the page does', async () => {
    h.route.query = { q: 'backup', chain: 'midnight' };
    helpSearchIntent.pending = 'backup';
    show();
    await settle({ results: [{ ...published('btc'), applicability: { chains: ['bitcoin'], networks: [], walletTypes: [], requiredFeatures: [] } }], total: 1, loading: false, resolved: true });
    expect(counted()).toEqual([search('empty', 'midnight')]);
  });

  it.each([['backup', 'results'], ['zzzzqqqq', 'empty']])('counts the bundled search for %s when the service cannot be reached', async (q, outcome) => {
    h.route.query = { q };
    helpSearchIntent.pending = q;
    show();
    await settle({ loading: false, failed: true });
    expect(counted()).toEqual([search(outcome)]);
  });

  it('counts a bundled search straight away in basic mode', async () => {
    h.route.query = { q: 'backup', basic: '1' };
    helpSearchIntent.pending = 'backup';
    show();
    await settle({ loading: false });
    expect(counted()).toEqual([search('results')]);
  });

  it('counts a search once, not again for more results or a changed filter', async () => {
    helpSearchIntent.pending = 'backup';
    show();
    await settle({ results: [published('a')], loading: false, resolved: true });
    await settle({ results: [published('a'), published('b')], total: 2 });
    h.route.query = { q: 'backup', chain: 'cardano' }; await nextTick();
    expect(counted()).toHaveLength(1);
  });

  it('counts nothing for a results page nobody just searched for, or for another query', async () => {
    show();
    await settle({ loading: false, resolved: true });
    expect(counted()).toEqual([]);
    helpSearchIntent.pending = 'something else';
    await nextTick();
    expect(counted()).toEqual([]);
    expect(helpSearchIntent.pending).toBe('something else');
  });

  it('counts nothing on pages other than search, and forgets a waiting search when the page goes away', async () => {
    Object.assign(h.route, { path: '/help/topics/security', params: { topic: 'security' } });
    helpSearchIntent.pending = 'backup';
    const wrapper = show();
    await settle({ loading: false, resolved: true });
    expect(counted()).toEqual([]);
    wrapper.destroy();
    expect(helpSearchIntent.pending).toBeNull();
  });

  it('never carries the words that were searched for', async () => {
    h.route.query = { q: 'my twenty four words' };
    helpSearchIntent.pending = 'my twenty four words';
    show();
    await settle({ loading: false, failed: true });
    expect(JSON.stringify(counted())).not.toContain('twenty');
  });
});
