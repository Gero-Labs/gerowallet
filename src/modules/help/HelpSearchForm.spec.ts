import Vue from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { helpSearchIntent } from './helpSearchIntent';

const h = vi.hoisted(() => ({
  wallet: { loggedWallet: null as unknown, isLocked: true, isSyncing: false },
  route: { path: '/help', fullPath: '/help?chain=all', query: { chain: 'all' } as Record<string, string> },
  push: vi.fn(),
}));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive(h.wallet) }));
vi.mock('vue-router/composables', () => ({
  useRoute: () => h.route,
  useRouter: () => ({
    push: h.push,
    // Only the resulting address matters to the form: it compares it with where the person already is.
    resolve: (target: { path: string; query: Record<string, string> }) => ({ route: { fullPath: target.path + '?' + new URLSearchParams(target.query).toString() } }),
  }),
}));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import HelpSearchForm from './HelpSearchForm.vue';

const wrappers: Array<ReturnType<typeof mount>> = [];
function show() {
  const wrapper = mount(HelpSearchForm, { stubs: { 'v-icon': true, 'v-btn': true } });
  wrappers.push(wrapper);
  return wrapper;
}
async function search(wrapper: ReturnType<typeof show>, text: string): Promise<void> {
  await wrapper.find('input').setValue(text);
  await wrapper.find('form').trigger('submit');
}
beforeEach(() => {
  Object.assign(h.route, { path: '/help', fullPath: '/help?chain=all', query: { chain: 'all' } });
  h.push.mockReset().mockResolvedValue(undefined);
  helpSearchIntent.pending = null;
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.destroy()); helpSearchIntent.pending = null; });

describe('search form', () => {
  it('goes to the results page with the trimmed query and remembers that a new search is waiting for its outcome', async () => {
    await search(show(), '  restore wallet  ');
    expect(h.push).toHaveBeenCalledWith({ path: '/help/search', query: { chain: 'all', q: 'restore wallet', basic: '' } });
    expect(helpSearchIntent.pending).toBe('restore wallet');
  });
  it('counts nothing for an empty search, which only lists every answer', async () => {
    await search(show(), '   ');
    expect(h.push).toHaveBeenCalled();
    expect(helpSearchIntent.pending).toBeNull();
  });
  it('counts nothing when the person submits the search they are already looking at', async () => {
    Object.assign(h.route, { path: '/help/search', fullPath: '/help/search?chain=all&q=backup&basic=', query: { chain: 'all', q: 'backup', basic: '' } });
    await search(show(), 'backup');
    expect(helpSearchIntent.pending).toBeNull();
    await search(show(), 'restore');
    expect(helpSearchIntent.pending).toBe('restore');
  });
  it('forgets the pending search when the navigation is refused', async () => {
    h.push.mockRejectedValue(new Error('NavigationDuplicated'));
    await search(show(), 'backup');
    await Vue.nextTick();
    expect(helpSearchIntent.pending).toBeNull();
  });
  it('keeps a newer pending search when an older navigation is refused afterwards', async () => {
    h.push.mockImplementationOnce(() => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('cancelled')), 0)));
    await search(show(), 'first');
    helpSearchIntent.pending = 'second';
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(helpSearchIntent.pending).toBe('second');
  });
  it('starts from the query of the results page it is on', () => {
    h.route.query = { q: 'midnight' };
    expect(show().find<HTMLInputElement>('input').element.value).toBe('midnight');
  });
});
