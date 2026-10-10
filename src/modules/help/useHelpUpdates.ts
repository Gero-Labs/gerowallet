import { ref, watch, onBeforeUnmount, type Ref } from 'vue';
import { getHelpUpdates, isChangedHelpSnapshot, type HelpUpdatesPage } from '@/api/help.api';
/** `limit` (1-50, default 20) lets the home cards ask for just the newest item. */
export interface UpdateRequest { source: string; chain: string; locale: string; limit?: number }
const cache = new Map<string, HelpUpdatesPage>();
export function useHelpUpdates(request: Ref<UpdateRequest>) {
  const page = ref<HelpUpdatesPage | null>(null), loading = ref(false), failed = ref(false);
  let sequence = 0, controller: AbortController | null = null;
  async function load(more = false): Promise<void> {
    if (more && (loading.value || !page.value?.nextCursor)) return;
    const current = ++sequence; controller?.abort(); controller = new AbortController();
    const state = { ...request.value }, key = JSON.stringify(state), signal = controller.signal;
    if (!more) page.value = cache.get(key) ?? null;
    loading.value = true; failed.value = false;
    try {
      const response = await getHelpUpdates({ ...state, cursor: more ? page.value?.nextCursor ?? undefined : undefined }, signal);
      if (current !== sequence) return;
      page.value = more ? { ...response, items: [...(page.value?.items ?? []), ...response.items] } : response;
      cache.set(key, page.value);
      if (cache.size > 12) cache.delete(cache.keys().next().value!);
    } catch (error) {
      if (current !== sequence || signal.aborted) return;
      if (more && isChangedHelpSnapshot(error)) { cache.delete(key); await load(); return; }
      failed.value = true;
    } finally { if (current === sequence) loading.value = false; }
  }
  watch(request, () => { void load(); }, { immediate: true });
  onBeforeUnmount(() => { sequence++; controller?.abort(); });
  return { page, loading, failed, retry: () => load(), loadMore: () => load(true) };
}
