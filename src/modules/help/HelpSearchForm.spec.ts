import * as Vue from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '@test/helpers/dialogControls';
import { helpSearchIntent } from './helpSearchIntent';

const state = vi.hoisted(() => ({ wallet: { loggedWallet: null as unknown, isLocked: true, isSyncing: false } }));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (state.wallet = Vue.reactive(state.wallet)) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import HelpSearchForm from './HelpSearchForm.vue';

let router: Router;
const wrappers: Array<ReturnType<typeof mount>> = [];
function show() {
  const wrapper = mount(HelpSearchForm, { global: { plugins: [router], stubs: { 'v-icon': true, 'v-btn': true } } });
  wrappers.push(wrapper);
  return wrapper;
}
async function search(wrapper: ReturnType<typeof show>, text: string): Promise<void> {
  await wrapper.find('input').setValue(text);
  await wrapper.find('form').trigger('submit');
  await flushPromises();
}
beforeEach(async () => {
  router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/help', component: { template: '<div />' } },
    { path: '/help/search', component: { template: '<div />' } },
  ] });
  await router.push({ path: '/help', query: { chain: 'all' } });
  await router.isReady();
  helpSearchIntent.pending = null;
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); helpSearchIntent.pending = null; });

describe('search form with Router 4', () => {
  it('goes to the results page with the trimmed query and remembers that a new search is waiting for its outcome', async () => {
    await search(show(), '  restore wallet  ');
    expect(router.currentRoute.value).toMatchObject({ path: '/help/search', query: { chain: 'all', q: 'restore wallet', basic: '' } });
    expect(helpSearchIntent.pending).toBe('restore wallet');
  });
  it('counts nothing for an empty search, which only lists every answer', async () => {
    await search(show(), '   ');
    expect(router.currentRoute.value.path).toBe('/help/search');
    expect(router.currentRoute.value.query['q']).toBe('');
    expect(helpSearchIntent.pending).toBeNull();
  });
  it('counts nothing when the person submits the search they are already looking at', async () => {
    await router.push({ path: '/help/search', query: { chain: 'all', q: 'backup', basic: '' } });
    const wrapper = show();
    await search(wrapper, 'backup');
    expect(helpSearchIntent.pending).toBeNull();
    await search(wrapper, 'restore');
    expect(helpSearchIntent.pending).toBe('restore');
  });
  it('forgets the pending search when a real navigation guard refuses it', async () => {
    router.beforeEach(() => false);
    await search(show(), 'backup');
    expect(router.currentRoute.value.path).toBe('/help');
    expect(helpSearchIntent.pending).toBeNull();
  });
  it('keeps a newer pending search when an older navigation is refused afterwards', async () => {
    const navigation = deferred<boolean>();
    router.beforeEach(() => navigation.promise);
    await search(show(), 'first');
    helpSearchIntent.pending = 'second';
    navigation.resolve(false);
    await flushPromises();
    expect(helpSearchIntent.pending).toBe('second');
  });
  it('starts from the results query and reflects later route navigation', async () => {
    await router.push({ path: '/help/search', query: { q: 'midnight' } });
    const wrapper = show();
    expect(wrapper.find<HTMLInputElement>('input').element.value).toBe('midnight');
    await router.push({ path: '/help/search', query: { q: 'backup' } });
    expect(wrapper.find<HTMLInputElement>('input').element.value).toBe('backup');
  });
});
