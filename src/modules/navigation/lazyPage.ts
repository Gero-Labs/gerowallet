import type { Component } from 'vue';
import type VueRouter from 'vue-router';

const preloaders = new WeakMap<object, () => Promise<Component>>();

/** Load the actual route component, which owns its data-loading UI. */
export function lazyPage(loader: () => Promise<{ default: Component }>) {
  let pending: Promise<Component> | null = null;
  const load = () => {
    if (!pending) {
      pending = loader().then(module => module.default).catch(error => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };
  preloaders.set(load, load);
  return load;
}

/** Warm only content-page factories when an enabled navigation item is targeted. */
export async function prefetchPage(router: VueRouter, path: string): Promise<void> {
  await Promise.all(router.getMatchedComponents(path).map(async component => {
    const load = preloaders.get(component);
    // Speculation must not navigate or surface an error before a real click.
    if (load) await load().catch(() => undefined);
  }));
}
