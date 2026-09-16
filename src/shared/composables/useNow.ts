import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { Ref } from 'vue';

/**
 * A reactive "now", ticking while the component is mounted.
 *
 * `Date.now()` is not reactive: a relative label like "13s ago" computed in a
 * template is only recomputed when something ELSE re-renders the component,
 * so a quiet screen shows the same "13s ago" ten minutes later. Read the time
 * from this ref instead and the label follows the clock.
 *
 * The interval is coarse on purpose — relative labels only need to move at
 * the granularity they display — and it stops with the component.
 */
export function useNow(intervalMs = 15_000): Ref<number> {
  const now = ref(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;
  onMounted(() => {
    now.value = Date.now();
    timer = setInterval(() => { now.value = Date.now(); }, intervalMs);
  });
  onBeforeUnmount(() => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  });
  return now;
}
