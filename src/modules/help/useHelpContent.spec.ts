import Vue, { nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ home: vi.fn(), article: vi.fn(), page: vi.fn() }));
vi.mock('@/api/help.api', () => ({ getHelpHome: api.home, getHelpArticle: api.article, getHelpPage: api.page, isChangedHelpSnapshot: (e: unknown) => (e as { status?: number }).status === 409 }));
import { useHelpContent, type HelpRequest } from './useHelpContent';
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await nextTick(); };
const emptyHome = { topics: [], publicFeaturedArticles: [], walletFeaturedArticles: {}, sources: [] };
function setup(initial: Partial<HelpRequest> = {}) {
  const request = ref<HelpRequest>({ view: 'search', locale: 'en-US', chain: 'all', topic: '', slug: '', q: 'proof', basic: false, ...initial });
  let state!: ReturnType<typeof useHelpContent>;
  const wrapper = mount(Vue.extend({ setup() { state = useHelpContent(request); return {}; }, render: h => h('div') }));
  return { request, state, wrapper };
}
beforeEach(() => { vi.resetAllMocks(); api.home.mockResolvedValue(emptyHome); });
describe('published Help content requests', () => {
  it('aborts superseded queries and ignores late results even if transport ignores abort', async () => {
    let old!: (value: unknown) => void;
    api.page.mockImplementationOnce(() => new Promise(resolve => { old = resolve; }))
      .mockResolvedValueOnce({ results: [{ id: 'new' }], total: 1, nextCursor: null, sources: [] });
    const { request, state, wrapper } = setup();
    const signal = api.page.mock.calls[0][2] as AbortSignal;
    request.value = { ...request.value, q: 'dust' }; await flush(); await flush();
    expect(signal.aborted).toBe(true); expect(state.results.value[0].id).toBe('new');
    old({ results: [{ id: 'old' }], total: 1, nextCursor: null, sources: [] }); await flush();
    expect(state.results.value[0].id).toBe('new'); wrapper.destroy();
  });
  it('distinguishes authoritative 404/empty results from service failure', async () => {
    api.article.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('offline'));
    const { request, state, wrapper } = setup({ view: 'article', slug: 'withdrawn' }); await flush();
    expect(state.resolved.value).toBe(true); expect(state.failed.value).toBe(false); expect(state.article.value).toBeNull();
    request.value = { ...request.value, slug: 'another' }; await flush();
    expect(state.resolved.value).toBe(false); expect(state.failed.value).toBe(true); wrapper.destroy();
  });
  it('retains the reader across layout remount and removes withdrawn cached articles', async () => {
    const response = { article: { id: 'cached-guide' }, resolvedLocale: 'en-US', isLocaleFallback: false, sources: [] };
    api.article.mockResolvedValueOnce(response).mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(null);
    const first = setup({ view: 'article', slug: 'cached-guide' }); await flush(); first.wrapper.destroy();
    const second = setup({ view: 'article', slug: 'cached-guide' }); expect(second.state.article.value).toEqual(response);
    await second.state.retry(); expect(second.state.article.value).toBeNull(); second.wrapper.destroy();
  });
  it('restarts pagination after a snapshot change and retains URL filters', async () => {
    api.page.mockResolvedValueOnce({ results: [{ id: 'old' }], total: 2, nextCursor: 'old-cursor', sources: [] })
      .mockRejectedValueOnce({ status: 409 }).mockResolvedValueOnce({ results: [{ id: 'fresh' }], total: 1, nextCursor: null, sources: [] });
    const { state, wrapper } = setup({ chain: 'midnight', locale: 'de-DE' }); await flush(); await flush();
    await state.loadMore();
    expect(state.results.value).toEqual([{ id: 'fresh' }]);
    expect(api.page.mock.calls[2][0]).toMatchObject({ chain: 'midnight', locale: 'de-DE', q: 'proof', cursor: undefined });
    wrapper.destroy();
  });
  it('explicit basic answers make no content requests', async () => {
    const { wrapper } = setup({ basic: true, view: 'article', slug: 'backup' }); await flush();
    expect(api.home).not.toHaveBeenCalled(); expect(api.article).not.toHaveBeenCalled(); expect(api.page).not.toHaveBeenCalled(); wrapper.destroy();
  });
});
