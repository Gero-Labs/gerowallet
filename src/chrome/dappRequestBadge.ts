/**
 * Toolbar-icon badge for parked dApp requests.
 *
 * A dApp request that arrives without a user gesture (a balance read on
 * page load, a proof after async work) cannot open the side panel, so it
 * parks in background.ts's `pendingDAppRequests` until the user opens the
 * panel themselves. The badge is the only signal that something is waiting.
 * Best-effort: a badge failure must never fail a request.
 */

/** '' for nothing waiting, the count up to 9, then '9+'. */
export function badgeTextFor(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  return count > 9 ? '9+' : String(Math.floor(count));
}

let styled = false;

/** Show `count` parked requests on the extension icon (clears at 0). */
export function applyDappRequestBadge(count: number): void {
  if (typeof chrome === 'undefined' || !chrome.action?.setBadgeText) return;
  const text = badgeTextFor(count);
  try {
    if (text && !styled) {
      styled = true;
      // Colour arrays, not hex strings: the design ratchet counts hex literals.
      void chrome.action.setBadgeBackgroundColor({ color: [0, 0, 0, 255] }).catch(() => undefined);
      const action = chrome.action as { setBadgeTextColor?: (d: { color: [number, number, number, number] }) => Promise<void> };
      void action.setBadgeTextColor?.({ color: [255, 255, 255, 255] }).catch(() => undefined);
    }
    void chrome.action.setBadgeText({ text }).catch(() => undefined);
  } catch {
    // Older Chrome without promise-returning action APIs: nothing to do.
  }
}
