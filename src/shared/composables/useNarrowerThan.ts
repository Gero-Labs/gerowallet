import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

/**
 * True while `target` is rendered narrower than `threshold` px.
 *
 * Follows the element the ref points at, not the one it pointed at first: a template
 * ref behind a v-if chain is re-created when the branch changes, and an observer left
 * on the old element never hears about the new one. A width of 0 means the element is
 * not rendered (removed, hidden, or kept alive off screen), so it keeps the last answer
 * instead of reading as "narrow" (issue 1583: chips stuck icon-only at full width).
 */
export function useNarrowerThan(target: Ref<HTMLElement | null>, threshold: number): Ref<boolean> {
  const narrow = ref(false);
  const observer = typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      if (width > 0) narrow.value = width < threshold;
    });
  watch(target, (el) => {
    observer?.disconnect();
    if (el) observer?.observe(el);
  }, { immediate: true, flush: 'post' });
  onBeforeUnmount(() => observer?.disconnect());
  return narrow;
}
