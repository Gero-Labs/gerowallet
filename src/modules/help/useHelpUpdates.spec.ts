import Vue, { ref, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ updates: vi.fn() }));
vi.mock('@/api/help.api', () => ({ getHelpUpdates: api.updates, isChangedHelpSnapshot: (e: { status?: number }) => e.status === 409 }));
import { useHelpUpdates, type UpdateRequest } from './useHelpUpdates';
const response = (id: string, nextCursor: string | null = null) => ({ items: [{ id }], total: 2, nextCursor, sources: [] });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await nextTick(); };
function setup(source: string) {
  const request = ref<UpdateRequest>({ source, chain: 'all', locale: 'en-US' });
  let state!: ReturnType<typeof useHelpUpdates>;
  const wrapper = mount(Vue.extend({ setup() { state = useHelpUpdates(request); return {}; }, render: h => h('div') }));
  return { state, request, wrapper };
}
beforeEach(() => vi.resetAllMocks());
it('cancels old source requests and ignores late responses', async () => {
  let old!: (data: unknown) => void;
  api.updates.mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockResolvedValueOnce(response('new'));
  const { state, request, wrapper } = setup('gero-x'); const signal = api.updates.mock.calls[0][1];
  request.value = { ...request.value, source: 'nexus-x' }; await flush();
  old(response('old')); await flush(); expect(signal.aborted).toBe(true); expect(state.page.value?.items[0].id).toBe('new'); wrapper.destroy();
});
it('retains public updates through lock remount/outage and clears them after an authoritative empty refresh', async () => {
  api.updates.mockResolvedValueOnce(response('cached')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [], sources: [], total: 0, nextCursor: null });
  const first = setup('cardano-news'); await flush(); first.wrapper.destroy();
  const second = setup('cardano-news'); await flush(); expect(second.state.failed.value).toBe(true); expect(second.state.page.value?.items[0].id).toBe('cached');
  await second.state.retry(); expect(second.state.page.value?.items).toEqual([]); second.wrapper.destroy();
});
it('restarts pagination on changed snapshots and keeps source/chain/locale', async () => {
  api.updates.mockResolvedValueOnce(response('old', 'cursor')).mockRejectedValueOnce({ status: 409 }).mockResolvedValueOnce(response('fresh'));
  const { state, wrapper } = setup('midnight-news'); await flush(); await state.loadMore();
  expect(state.page.value?.items[0].id).toBe('fresh'); expect(api.updates.mock.calls[2][0]).toMatchObject({ source: 'midnight-news', chain: 'all', locale: 'en-US', cursor: undefined }); wrapper.destroy();
});
