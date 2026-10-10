/** Public content survives session changes; signing popups keep their own guards. */
export function isPublicRoute(route: { meta?: Record<string, unknown>; matched?: Array<{ meta?: Record<string, unknown> }> }): boolean {
  return route.meta?.public === true || !!route.matched?.some(record => record.meta?.public === true);
}

export function isHelpReady(session: { loggedWallet?: unknown; isLocked: boolean; isSyncing: boolean }): boolean {
  return !!session.loggedWallet && !session.isLocked && !session.isSyncing;
}

export function helpUnlockPath(fullPath: string): string {
  return `/welcome?redirect=${encodeURIComponent(fullPath)}`;
}

/** Only consulted on navigation, never from a flag-change watcher. */
export function blogHelpRedirect(initialized: boolean, enabled: boolean): string | null {
  return initialized && enabled ? '/help/updates?source=blog' : null;
}

/**
 * Opens an in-app path (`/help`, `/help/articles/restore?basic=1`, `/blog/<slug>`) in a NEW tab, so
 * the welcome screen, and any setup in progress on it, stays exactly as it is. Resolves false when
 * the browser refuses, so the caller can offer a plain link instead of failing silently.
 */
export async function openWelcomeHelp(path: string): Promise<boolean> {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      if (!chrome.tabs?.create) return false;
      await chrome.tabs.create({ url: chrome.runtime.getURL(`index.html#${path}`) });
      return true;
    }
    if (typeof window === 'undefined') return false;
    const opened = window.open(`${window.location.href.split('#')[0]}#${path}`, '_blank');
    if (!opened) return false;
    // `noopener` as a window feature makes window.open return null, so detach by hand.
    opened.opener = null;
    return true;
  } catch { return false; }
}
