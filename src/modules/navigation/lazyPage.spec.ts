import { defineComponent, h, nextTick, onActivated, onDeactivated, ref, watch, type Component } from 'vue';
import { createMemoryHistory, createRouter, RouterLink, useRoute, type Router } from 'vue-router';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lazyPage, prefetchPage } from './lazyPage';
import RouteContent from './RouteContent.vue';
import { useNow } from '@/shared/composables/useNow';

const wrappers: ReturnType<typeof mount>[] = [];
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick(); };
const page = (text: string) => defineComponent({ render: () => h('p', text) });
function deferred() {
  let resolve!: (value: { default: Component }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ default: Component }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function app(loader: () => Promise<{ default: Component }>, guard?: Parameters<Router['beforeEach']>[0]) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', name: 'dashboard', component: page('Dashboard content') },
    { path: '/other', component: page('Other content') },
    { path: '/governance/:id?', name: 'governance', props: true, component: lazyPage(loader) },
  ] });
  if (guard) router.beforeEach(guard);
  const backup = vi.fn();
  const wrapper = mount(defineComponent({ render: () => h('div', [
    h(RouterLink, { to: '/' }, () => 'Dashboard'),
    h(RouterLink, { to: '/governance' }, () => 'Governance'),
    h(RouteContent, { onOpenBackupDialog: backup }),
  ]) }), { global: { plugins: [router] } });
  wrappers.push(wrapper);
  return { router, wrapper, backup };
}
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.useRealTimers(); });

describe('content route loading', () => {
  it('retains current content until the real page is ready', async () => {
    const pending = deferred();
    const { router, wrapper } = app(() => pending.promise);
    await router.push('/'); await flush();
    await wrapper.findAll('a')[1]!.trigger('click'); await flush();
    expect(router.currentRoute.value.name).toBe('dashboard');
    expect(wrapper.text()).toContain('Dashboard content');
    pending.resolve({ default: page('Governance content') }); await flush();
    expect(wrapper.text()).toContain('Governance content');
    expect(router.currentRoute.value.name).toBe('governance');
  });
  it('does not mount a late loader result after navigation elsewhere', async () => {
    const pending = deferred(); const mounted = vi.fn();
    const { router, wrapper } = app(() => pending.promise);
    await router.push('/'); await flush();
    const navigation = router.push('/governance'); await flush();
    await router.push('/other');
    pending.resolve({ default: defineComponent({ mounted, render: () => h('p', 'Late page') }) });
    await navigation; await flush();
    expect(mounted).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Other content');
    await router.push('/governance'); await flush();
    expect(mounted).toHaveBeenCalledTimes(1);
  });
  it('preserves route state and activation through the production RouterView/KeepAlive component', async () => {
    const activated = vi.fn(); const deactivated = vi.fn();
    const loader = vi.fn(async () => ({ default: defineComponent({
      setup() {
        const count = ref(0);
        onActivated(activated); onDeactivated(deactivated);
        return () => h('button', { onClick: () => { count.value += 1; } }, `Count ${count.value}`);
      },
    }) }));
    const { router, wrapper } = app(loader);
    await router.push('/governance'); await flush();
    await wrapper.find('button').trigger('click');
    await router.push('/'); await flush();
    expect(deactivated).toHaveBeenCalledTimes(1);
    await router.push('/governance'); await flush();
    expect(wrapper.find('button').text()).toBe('Count 1');
    expect(activated).toHaveBeenCalledTimes(2);
    expect(loader).toHaveBeenCalledTimes(1);
  });
  it('forwards route props, query updates and page events without replacing cached state', async () => {
    const { router, wrapper, backup } = app(async () => ({ default: defineComponent({
      props: ['id'], emits: ['open-backup-dialog'],
      setup(props, { emit }) {
        const route = useRoute(); const selected = ref('initial');
        watch(() => route.query['tx'], value => { if (value) selected.value = String(value); }, { immediate: true });
        return () => h('button', { onClick: () => emit('open-backup-dialog') }, `${props.id}:${selected.value}:${route.query['tab'] || ''}`);
      },
    }) }));
    await router.push('/governance/first?tx=one'); await flush();
    expect(wrapper.find('button').text()).toBe('first:one:');
    await router.push('/'); await flush();
    await router.push('/governance/second?tx=two&tab=utxos'); await flush();
    expect(wrapper.find('button').text()).toBe('second:two:utxos');
    await wrapper.find('button').trigger('click');
    expect(backup).toHaveBeenCalledTimes(1);
  });
  it('pauses real useNow timers on route deactivation and resumes without duplicate timers', async () => {
    const { router, wrapper } = app(async () => ({ default: defineComponent({ setup() {
      const now = useNow(10);
      return () => h('output', String(now.value));
    } }) }));
    await router.push('/governance'); await flush();
    const first = wrapper.find('output').text();
    await new Promise(resolve => setTimeout(resolve, 25)); await nextTick();
    expect(wrapper.find('output').text()).not.toBe(first);
    const clear = vi.spyOn(globalThis, 'clearInterval');
    await router.push('/'); await flush();
    expect(clear).toHaveBeenCalledTimes(1);
    const set = vi.spyOn(globalThis, 'setInterval');
    await router.push('/governance'); await flush();
    expect(set).toHaveBeenCalledTimes(1);
    set.mockRestore(); clear.mockRestore();
  });
  it('reports import failures while retaining the previous page, then allows retry', async () => {
    const error = new Error('network failed');
    const loader = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce({ default: page('Recovered') });
    const { router, wrapper } = app(loader); const onError = vi.fn(); router.onError(onError);
    await router.push('/'); await flush();
    await expect(router.push('/governance')).rejects.toBe(error);
    expect(router.currentRoute.value.name).toBe('dashboard');
    expect(onError.mock.calls[0]?.[0]).toBe(error);
    await router.push('/governance'); await flush();
    expect(wrapper.text()).toContain('Recovered');
  });
  it('prefetches once without mounting/navigating, then reuses the module', async () => {
    const mounted = vi.fn();
    const loader = vi.fn(async () => ({ default: defineComponent({ mounted, render: () => h('p', 'Loaded') }) }));
    const { router, wrapper } = app(loader);
    await router.push('/'); await flush();
    await Promise.all([prefetchPage(router, '/governance'), prefetchPage(router, '/governance')]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(mounted).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe('dashboard');
    await router.push('/governance'); await flush();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Loaded');
  });
  it('does not speculate unmarked signing factories or surface speculative failures', async () => {
    const { router } = app(vi.fn().mockRejectedValue(new Error('offline')));
    const signing = vi.fn(); router.addRoute({ path: '/sign', component: signing });
    await expect(prefetchPage(router, '/governance')).resolves.toBeUndefined();
    await prefetchPage(router, '/sign');
    expect(signing).not.toHaveBeenCalled();
  });
  it('does not import protected content when a guard redirects', async () => {
    const loader = vi.fn();
    const { router, wrapper } = app(loader, to => to.name === 'governance' ? '/' : true);
    await router.push('/governance'); await flush();
    expect(loader).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Dashboard content');
  });
});
