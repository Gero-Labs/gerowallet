import Vue from 'vue';
import VueRouter from 'vue-router';
import { compileToFunctions } from 'vue-template-compiler';
import type { ComponentOptions } from 'vue';
import Vuetify from 'vuetify';
import { mount, createLocalVue } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lazyPage } from './lazyPage';

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
    { path: '/governance/:id?', name: 'governance', props: true,
      component: lazyPage('GovernanceTest', 'navigation.governanceMe', async () => {
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
  it('commits the destination and active link while page code is still pending', async () => {
    const pending = deferred(); const loader = vi.fn(() => pending.promise);
    const { router, wrapper } = app(loader);
    await router.push('/'); await flush();
    await wrapper.findAll('a').at(1).trigger('click'); await flush();
    expect(router.currentRoute.name).toBe('governance');
    expect(wrapper.findAll('a').at(1).classes()).toContain('router-link-active');
    expect(wrapper.find('[role="status"]').text()).toBe('common.loadingEllipsis');
    expect(wrapper.find('h1').text()).toBe('navigation.governanceMe');
    expect(wrapper.text()).not.toContain('Dashboard content');
    pending.resolve({ default: { template: '<p>Governance content</p>' } }); await flush();
    expect(wrapper.text()).toContain('Governance content');
    expect(wrapper.find('[data-testid="route-page-state"]').exists()).toBe(false);
  });

  it('allows leaving a loading page without mounting its late result', async () => {
    const pending = deferred(); const mounted = vi.fn();
    const { router, wrapper } = app(() => pending.promise);
    await router.push('/governance'); await flush();
    await router.push('/'); await flush();
    pending.resolve({ default: { template: '<p>Late page</p>', mounted } }); await flush();
    expect(mounted).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Dashboard content');
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

  it('offers a document reload after an import fails, because browsers cache failed modules', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    try {
      const loader = vi.fn().mockRejectedValue(new Error('network failed'));
      const { router, wrapper } = app(loader);
      await router.push('/governance'); await flush();
      expect(router.currentRoute.name).toBe('governance');
      expect(wrapper.find('[role="alert"]').text()).toContain('navigation.pageLoadFailed');
      expect(wrapper.element.querySelector('button')?.textContent).toContain('navigation.reloadPage');
      (wrapper.element.querySelector('button') as HTMLButtonElement).click(); await Vue.nextTick();
      expect(reload).toHaveBeenCalledTimes(1);
      expect(loader).toHaveBeenCalledTimes(1);
    } finally { reload.mockRestore(); }
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
