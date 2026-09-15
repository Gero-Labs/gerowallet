import Vue from 'vue';
import VueRouter from 'vue-router';
import { compileToFunctions } from 'vue-template-compiler';
import type { ComponentOptions } from 'vue';
import Vuetify from 'vuetify';
import { mount, createLocalVue } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lazyPage, prefetchPage } from './lazyPage';

Vue.use(Vuetify);
const localVue = createLocalVue();
localVue.use(VueRouter);
const wrappers: ReturnType<typeof mount>[] = [];
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await Vue.nextTick(); };
function deferred() {
  let resolve!: (value: { default: object }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ default: object }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function app(loader: () => Promise<{ default: object }>, guard?: Parameters<VueRouter['beforeEach']>[0]) {
  const router = new VueRouter({ mode: 'abstract', routes: [
    { path: '/', name: 'dashboard', component: compileToFunctions('<p>Dashboard content</p>') },
    { path: '/other', component: compileToFunctions('<p>Other content</p>') },
    { path: '/governance/:id?', name: 'governance', props: true,
      component: lazyPage(async () => {
        const module = await loader();
        const page = module.default as ComponentOptions<Vue>;
        return { default: { ...page, ...compileToFunctions(page.template as string) } };
      }) },
  ] });
  if (guard) router.beforeEach(guard);
  const backup = vi.fn();
  const wrapper = mount({ template: `<v-app><router-link to="/">Dashboard</router-link>
    <router-link to="/governance">Governance</router-link>
    <keep-alive><router-view @open-backup-dialog="backup" /></keep-alive></v-app>`, methods: { backup } },
  { localVue, router, vuetify: new Vuetify(), mocks: { $t: (key: string) => key } });
  wrappers.push(wrapper);
  return { router, wrapper, backup };
}
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.destroy()); });

describe('content route loading', () => {
  it('retains the current content until the real page is ready, without an intermediate loader', async () => {
    const pending = deferred(); const loader = vi.fn(() => pending.promise);
    const { router, wrapper } = app(loader);
    await router.push('/'); await flush();
    await wrapper.findAll('a').at(1).trigger('click'); await flush();
    expect(router.currentRoute.name).toBe('dashboard');
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="route-page-state"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Dashboard content');
    pending.resolve({ default: { template: '<p>Governance content</p>' } }); await flush();
    expect(wrapper.text()).toContain('Governance content');
    expect(router.currentRoute.name).toBe('governance');
    expect(wrapper.find('[data-testid="route-page-state"]').exists()).toBe(false);
  });

  it('allows leaving a loading page without mounting its late result', async () => {
    const pending = deferred(); const mounted = vi.fn();
    const { router, wrapper } = app(() => pending.promise);
    await router.push('/'); await flush();
    const navigation = router.push('/governance').catch(() => undefined); await flush();
    await router.push('/other'); await flush();
    pending.resolve({ default: { template: '<p>Late page</p>', mounted } }); await flush();
    await navigation;
    expect(mounted).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Other content');
    await router.push('/governance'); await flush();
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Late page');
  });

  it('preserves loaded page state and activation through keep-alive', async () => {
    const activated = vi.fn(); const deactivated = vi.fn();
    const loader = vi.fn().mockResolvedValue({ default: { data: () => ({ count: 0 }),
      template: '<button @click="count++">Count {{ count }}</button>', activated, deactivated } });
    const { router, wrapper } = app(loader);
    await router.push('/governance'); await flush();
    (wrapper.element.querySelector('button') as HTMLButtonElement).click(); await Vue.nextTick();
    expect(wrapper.element.querySelector('button')?.textContent).toBe('Count 1');
    await router.push('/'); await flush();
    expect(deactivated).toHaveBeenCalledTimes(1);
    await router.push('/governance'); await flush();
    expect(wrapper.element.querySelector('button')?.textContent).toBe('Count 1');
    expect(activated).toHaveBeenCalledTimes(2);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('forwards route props, prop updates, and page events to the layout', async () => {
    const { router, wrapper, backup } = app(async () => ({ default: { props: ['id'],
      template: '<button @click="$emit(\'open-backup-dialog\')">{{ id }}</button>' } }));
    await router.push('/governance/first'); await flush();
    expect(wrapper.element.querySelector('button')?.textContent).toBe('first');
    await router.push('/governance/second'); await flush();
    expect(wrapper.element.querySelector('button')?.textContent).toBe('second');
    (wrapper.element.querySelector('button') as HTMLButtonElement).click(); await Vue.nextTick();
    expect(backup).toHaveBeenCalledTimes(1);
  });

  it('keeps the current page and reports an import failure through the router', async () => {
    const error = new Error('network failed');
    const { router, wrapper } = app(vi.fn().mockRejectedValue(error));
    const onError = vi.fn(); router.onError(onError);
    await router.push('/'); await flush();
    await expect(router.push('/governance')).rejects.toBe(error); await flush();
    expect(router.currentRoute.name).toBe('dashboard');
    expect(wrapper.text()).toContain('Dashboard content');
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('prefetches page code once without mounting or navigating, then opens the real loader', async () => {
    const mounted = vi.fn();
    const loader = vi.fn().mockResolvedValue({ default: { template: '<p>Loading governance data</p>', mounted } });
    const { router, wrapper } = app(loader);
    await router.push('/'); await flush();
    await Promise.all([prefetchPage(router, '/governance'), prefetchPage(router, '/governance')]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(mounted).not.toHaveBeenCalled();
    expect(router.currentRoute.name).toBe('dashboard');
    await router.push('/governance'); await flush();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Loading governance data');
    expect(wrapper.find('[data-testid="route-page-state"]').exists()).toBe(false);
  });

  it('ignores failed speculative loads and does not prefetch unmarked route factories', async () => {
    const { router } = app(vi.fn().mockRejectedValue(new Error('offline')));
    const signing = vi.fn(); router.addRoute({ path: '/sign', component: signing });
    await expect(prefetchPage(router, '/governance')).resolves.toBeUndefined();
    await prefetchPage(router, '/sign');
    expect(signing).not.toHaveBeenCalled();
  });

  it('does not import protected content when a guard redirects', async () => {
    const loader = vi.fn();
    const { router, wrapper } = app(loader, (to, _from, next) => next(to.name === 'governance' ? '/' : undefined));
    await router.push('/governance').catch(() => undefined); await flush();
    expect(router.currentRoute.path).toBe('/');
    expect(loader).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Dashboard content');
  });

  it('keeps page data loading inside the already-open route', async () => {
    const data = deferred();
    const { router, wrapper } = app(async () => ({ default: {
      data: () => ({ loading: true }),
      mounted() { data.promise.then(() => { (this as { loading: boolean }).loading = false; }); },
      template: '<p>{{ loading ? "Loading governance data" : "Governance data" }}</p>',
    } }));
    await router.push('/governance'); await flush();
    expect(router.currentRoute.name).toBe('governance');
    expect(wrapper.text()).toContain('Loading governance data');
    data.resolve({ default: {} }); await flush();
    expect(wrapper.text()).toContain('Governance data');
  });
});
