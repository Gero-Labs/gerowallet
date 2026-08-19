/**
 * Layers that render OUTSIDE a panel's DOM subtree but are logically part of it.
 *
 * Vuetify 2's `detachable` mixin moves `v-dialog` / `v-menu` / `v-tooltip` content to
 * `[data-app]`, so it is never a descendant of the panel that owns it — that is how
 * GeroSwapEmbed's spending-password, PassKey and Keystone prompts render.
 * `.v-overlay-container` covers Vue 3 islands embedded in the page for the same reason:
 * `<gero-swap>` is registered with `shadowRoot: false`, so anything it teleports lands
 * in `document.body` rather than inside the host panel.
 *
 * Deliberately NOT listed: `.v-snack` (a global toast is unrelated chrome — clicking
 * it should still close the panel) and the bare `.v-overlay` scrim (clicks inside a
 * dialog land on the full-viewport `.v-dialog__content` layer, so the scrim entry
 * only over-matched unrelated dialogs' backdrops).
 */
export const TELEPORTED_OVERLAY_SELECTOR = [
  '.v-overlay-container',
  '.v-dialog__content',
  '.v-menu__content',
  '.v-tooltip__content',
].join(',');

/** Minimal shape of the click events this helper inspects. */
export interface OutsideClickEvent {
  target: EventTarget | null;
  composedPath?: () => EventTarget[];
}

/**
 * True when a document-level click should NOT close the panel matched by
 * `panelSelector` — because it landed inside the panel itself, inside a layer the
 * panel detached elsewhere, or on a node whose position can no longer be judged.
 *
 * The detached-target case is not defensive padding, it is the original bug: a
 * control that re-renders itself in its own handler is gone before the browser
 * dispatches the follow-up `click` task. The <gero-swap> widget swaps its
 * slide-to-confirm control for a processing button the instant a swap is confirmed,
 * so the click that reaches this listener carries a detached target and
 * `panel.contains()` answers "outside".
 *
 * `pressedTarget` is the node captured on `pointerdown` (still attached at that
 * point, before any click handler re-renders). When the click target is detached we
 * judge by it instead, so a genuine outside click on a self-re-rendering control
 * (a v-if-toggled button, a re-sorted list row) still closes the panel. Only when
 * neither node is attached do we give up and treat the click as inside.
 */
export function isClickInsidePanel(
  event: OutsideClickEvent,
  panelSelector: string,
  doc: Document = document,
  pressedTarget: EventTarget | null = null,
): boolean {
  // composedPath() survives shadow-DOM retargeting; fall back to `target` when the
  // browser or test environment doesn't provide it.
  let target = (event.composedPath?.()[0] ?? event.target) as HTMLElement | null;

  if (!isAttached(target, doc)) {
    const pressed = pressedTarget as HTMLElement | null;
    if (!isAttached(pressed, doc)) return true;
    target = pressed;
  }

  const panel = doc.querySelector(panelSelector);
  if (panel && panel.contains(target)) return true;

  return typeof target?.closest === 'function' && !!target.closest(TELEPORTED_OVERLAY_SELECTOR);
}

function isAttached(node: HTMLElement | null, doc: Document): boolean {
  return !!node && node instanceof Node && doc.contains(node);
}
