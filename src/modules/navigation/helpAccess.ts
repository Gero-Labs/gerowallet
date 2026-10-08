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

export async function openWelcomeHelp(onboardingActive: boolean, support: boolean, push: (path: string) => unknown): Promise<void> {
  const path = support ? '/help?support=1' : '/help';
  if (onboardingActive) {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`index.html#${path}`) });
  } else {
    await push(path);
  }
}
