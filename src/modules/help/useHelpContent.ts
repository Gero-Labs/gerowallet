import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { getHelpArticle, getHelpHome, getHelpPage, isChangedHelpSnapshot, type HelpArticleResponse, type HelpHome, type HelpResult, type HelpSource } from '@/api/help.api';

export interface HelpRequest { view: string; locale: string; chain: string; topic: string; slug: string; q: string; basic: boolean }
// Keeps a reader intact while HelpLayout swaps chrome on lock. Never persisted.
const articleCache = new Map<string, HelpArticleResponse>();
/** Public, in-memory content only. Cancellation and sequence checks protect every route/locale transition. */
export function useHelpContent(request: Ref<HelpRequest>) {
  const home = ref<HelpHome | null>(null);
  const article = ref<HelpArticleResponse | null>(null);
  const results = ref<HelpResult[]>([]);
  const nextCursor = ref<string | null>(null);
  const total = ref(0);
  const loading = ref(false);
  const failed = ref(false);
  const resolved = ref(false);
  const sources = ref<HelpSource[]>([]);
  let generation = 0;
  let controller: AbortController | null = null;
  let homeLocale = '';

  async function load(more = false): Promise<void> {
    if (more && (loading.value || !nextCursor.value)) return;
    const sequence = ++generation;
    controller?.abort(); controller = new AbortController();
    const signal = controller.signal;
    const state = { ...request.value };
    const articleKey = state.locale + ':' + state.slug;
    if (!more) { article.value = state.basic ? null : articleCache.get(articleKey) ?? null; results.value = []; nextCursor.value = null; total.value = 0; resolved.value = false; sources.value = []; }
    failed.value = false;
    if (homeLocale !== state.locale) { home.value = null; homeLocale = state.locale; }
    if (state.basic || state.view === 'updates') { loading.value = false; return; }
    loading.value = true;
    try {
      if (state.view === 'home') {
        const response = await getHelpHome(state.locale, signal);
        if (sequence !== generation) return;
        home.value = response; sources.value = response.sources;
      } else if (state.view === 'article') {
        const [response, catalog] = await Promise.all([
          getHelpArticle(state.slug, state.locale, signal),
          home.value ? Promise.resolve(null) : getHelpHome(state.locale, signal).catch(() => null),
        ]);
        if (sequence !== generation) return;
        if (catalog) home.value = catalog;
        article.value = response; sources.value = response?.sources ?? [];
        if (response) {
          articleCache.set(articleKey, response);
          if (articleCache.size > 20) articleCache.delete(articleCache.keys().next().value!);
        } else articleCache.delete(articleKey);
      } else {
        const [response, catalog] = await Promise.all([
          getHelpPage({ locale: state.locale, chain: state.chain, topic: state.topic || undefined,
            q: state.view === 'search' ? state.q : undefined, cursor: more ? nextCursor.value ?? undefined : undefined }, state.view === 'search', signal),
          home.value ? Promise.resolve(null) : getHelpHome(state.locale, signal).catch(() => null),
        ]);
        if (sequence !== generation) return;
        if (catalog) home.value = catalog;
        const items = response.results ?? response.items ?? [];
        results.value = more ? [...results.value, ...items] : items;
        total.value = response.total; nextCursor.value = response.nextCursor; sources.value = response.sources;
      }
      resolved.value = true;
    } catch (error) {
      if (sequence !== generation || signal.aborted) return;
      if (more && isChangedHelpSnapshot(error)) { await load(); return; }
      failed.value = true;
    } finally { if (sequence === generation) loading.value = false; }
  }
  watch(request, () => { void load(); }, { immediate: true });
  onBeforeUnmount(() => { generation++; controller?.abort(); });
  return { home, article, results, nextCursor, total, loading, failed, resolved, sources,
    stale: computed(() => sources.value.some(source => source.status === 'stale')),
    loadMore: () => load(true), retry: () => load() };
}
