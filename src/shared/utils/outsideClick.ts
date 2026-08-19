/**
 * Layers that render OUTSIDE a panel's DOM subtree but are logically part of it.
 *
 * Vuetify 2's `detachable` mixin moves `v-dialog` / `v-menu` / `v-tooltip` / snackbar
 * content to `[data-app]`, so it is never a descendant of the panel that owns it —
 * that is how GeroSwapEmbed's spending-password, PassKey and Keystone prompts render.
 * `.v-overlay-container` covers Vue 3 islands embedded in the page for the same reason:
 * `<gero-swap>` is registered with `shadowRoot: false`, so anything it teleports lands
 * in `document.body` rather than inside the host panel.
 */
export const TELEPORTED_OVERLAY_SELECTOR = [
  '.v-overlay-container',
  '.v-dialog__content',
  '.v-menu__content',
  '.v-tooltip__content',
  '.v-overlay',
  '.v-snack',
].join(',');

/** Minimal shape of the click events this helper inspects. */
export interface OutsideClickEvent {
  target: EventTarget | null;
  composedPath?: () => EventTarget[];
}

/**
 * True when a document-level click should NOT close the panel matched by
 * `panelSelector` — because it landed inside the panel itself, inside a layer the
 * panel detached elsewhere, or on a node that has since been removed from the DOM.
 *
 * That last case is not defensive padding, it is the common one. A control that
 * re-renders itself in its own handler is gone before the browser dispatches the
 * follow-up `click` task: the <gero-swap> widget swaps its slide-to-confirm control
 * for a processing button the instant a swap is confirmed, so the click that reaches
 * this listener carries a detached target and `panel.contains()` answers "outside".
 */
export function isClickInsidePanel(
  event: OutsideClickEvent,
  panelSelector: string,
  doc: Document = document,
): boolean {
  // composedPath() survives shadow-DOM retargeting; fall back to `target` when the
  // browser or test environment doesn't provide it.
  const target = (event.composedPath?.()[0] as HTMLElement | undefined) ?? (event.target as HTMLElement | null);
  if (!target) return true;

  // A target that is already detached (the widget re-rendered that node inside its own
  // handler, before the event reached the document) tells us nothing about where the
  // user clicked — treat it as inside rather than closing on a phantom outside click.
  if (typeof Node !== 'undefined' && target instanceof Node && !doc.contains(target)) return true;

  const panel = doc.querySelector(panelSelector);
  if (panel && typeof panel.contains === 'function' && panel.contains(target)) return true;

  return typeof target.closest === 'function' && !!target.closest(TELEPORTED_OVERLAY_SELECTOR);
}
