import { defineComponent, h, onMounted, onActivated, onDeactivated, onBeforeUnmount, ref, shallowRef } from 'vue';
import type { Component } from 'vue';
import RoutePageState from './components/RoutePageState.vue';

/**
 * A synchronous route shell: Vue Router commits navigation before page code loads.
 * Keep this on content routes; authentication and signing popup routes retain their
 * existing route-component behavior. Page data loading remains the page's concern.
 */
export function lazyPage(name: string, titleKey: string, loader: () => Promise<{ default: Component }>) {
  let resolved: Component | null = null;
  let pending: Promise<Component> | null = null;
  const resolvePage = (): Promise<Component> => {
    if (resolved) return Promise.resolve(resolved);
    if (!pending) {
      pending = Promise.resolve().then(loader).then(module => {
        resolved = module.default;
        return resolved;
      }).finally(() => { pending = null; });
    }
    return pending;
  };

  return defineComponent({
    name: `${name}RoutePage`,
    inheritAttrs: false,
    setup(_, context) {
      const page = shallowRef<Component | null>(resolved);
      const failed = ref(false);
      let active = true;
      let disposed = false;
      let task: Promise<void> | null = null;
      const load = () => {
        if (page.value || task || disposed) return;
        failed.value = false;
        task = resolvePage().then(component => {
          // A late import must not mount a page the user has already left.
          if (active && !disposed) page.value = component;
        }).catch(() => {
          if (active && !disposed) failed.value = true;
        }).finally(() => { task = null; });
      };
      onMounted(load);
      onActivated(() => { active = true; load(); });
      onDeactivated(() => { active = false; });
      onBeforeUnmount(() => { active = false; disposed = true; });
      // Chromium caches rejected module imports; recovery needs a document reload.
      return () => page.value
        ? h('keep-alive', [h(page.value, { attrs: context.attrs, on: context.listeners, scopedSlots: context.slots })])
        : h(RoutePageState, { props: { titleKey, failed: failed.value }, on: { reload: () => window.location.reload() } });
    },
  });
}
