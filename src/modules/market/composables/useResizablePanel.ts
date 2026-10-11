import { computed, ref } from 'vue';

/** The dashboard's navigation drawer; a resized panel never grows over it. */
export const NAV_DRAWER_WIDTH = 270;
export const PANEL_MIN_WIDTH = 520;
/** Arrow-key step on the resize handle. */
export const PANEL_KEY_STEP = 32;

const STORAGE_KEY = 'gero.tokenDetailPanel.width';

/** The widest the panel may get: the content area beside the nav drawer, never below the minimum. */
export function maxPanelWidth(viewportWidth: number): number {
  return Math.max(PANEL_MIN_WIDTH, viewportWidth - NAV_DRAWER_WIDTH);
}

/** Keeps a dragged width between the minimum and the content area beside the nav drawer. */
export function clampPanelWidth(width: number, viewportWidth: number): number {
  return Math.min(Math.max(width, PANEL_MIN_WIDTH), maxPanelWidth(viewportWidth));
}

// The width is a per-browser convenience: storage may be unavailable, and then the
// panel simply opens at its default width.
function readStoredWidth(): number | null {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function storeWidth(width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Not persisted; the width still applies until the panel closes.
  }
}

function panelOf(event: Event): HTMLElement | null {
  return (event.currentTarget as HTMLElement | null)?.parentElement ?? null;
}

/**
 * Drag-to-resize for a right-anchored panel whose handle sits on its left edge. The
 * handle captures the pointer, so the drag keeps tracking (and its release still counts
 * as a press inside the panel) when the cursor leaves the panel. Null width = the
 * panel's own CSS default.
 */
export function useResizablePanel() {
  const width = ref<number | null>(readStoredWidth());
  const resizing = ref(false);
  let startX = 0;
  let startWidth = 0;

  function setWidth(next: number): void {
    width.value = clampPanelWidth(next, window.innerWidth);
  }

  function startResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    const panel = panelOf(event);
    if (!panel) return;
    event.preventDefault();
    startX = event.clientX;
    startWidth = panel.getBoundingClientRect().width;
    resizing.value = true;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function moveResize(event: PointerEvent): void {
    if (!resizing.value) return;
    // The handle is on the left edge: moving left widens the panel.
    setWidth(startWidth + (startX - event.clientX));
  }

  function endResize(): void {
    if (!resizing.value) return;
    resizing.value = false;
    storeWidth(width.value);
  }

  function resetWidth(): void {
    width.value = null;
    storeWidth(null);
  }

  function resizeByKey(event: KeyboardEvent): void {
    const current = width.value ?? panelOf(event)?.getBoundingClientRect().width ?? PANEL_MIN_WIDTH;
    if (event.key === 'ArrowLeft') setWidth(current + PANEL_KEY_STEP);
    else if (event.key === 'ArrowRight') setWidth(current - PANEL_KEY_STEP);
    else if (event.key === 'Home') {
      resetWidth();
      event.preventDefault();
      return;
    } else return;
    event.preventDefault();
    storeWidth(width.value);
  }

  // min() keeps a width saved on a larger screen inside the content area of a smaller one.
  const panelStyle = computed(() => (width.value === null
    ? {}
    : { width: `min(${Math.round(width.value)}px, calc(100vw - ${NAV_DRAWER_WIDTH}px))` }));

  return { width, resizing, panelStyle, startResize, moveResize, endResize, resetWidth, resizeByKey };
}
