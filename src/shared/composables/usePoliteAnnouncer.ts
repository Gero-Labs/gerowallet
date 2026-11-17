/**
 * One polite live region per surface, for progress a screen reader user should
 * hear about without the page moving focus: render `message` in an element
 * that is always in the DOM (`<div class="g-sr-only" aria-live="polite"
 * aria-atomic="true">`), and call `announce` once per event worth saying. A
 * region added together with its first message is often not read, which is
 * why it stays mounted for the surface's whole life.
 */
import { nextTick, ref, type Ref } from 'vue';

export interface PoliteAnnouncer {
  readonly message: Ref<string>;
  /** Say `text` once. The same text twice in a row is said twice. */
  announce: (text: string) => void;
}

export function usePoliteAnnouncer(): PoliteAnnouncer {
  const message = ref('');
  let pending = 0;
  function announce(text: string) {
    const id = ++pending;
    message.value = '';
    void nextTick(() => {
      if (id === pending) message.value = text;
    });
  }
  return { message, announce };
}
