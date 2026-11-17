/**
 * Bookkeeping for Midnight connector prompts parked until the tab's side panel
 * connects (background.ts `parkMidnightRequest`). Parking has no timeout, so
 * these bound it: repeated connects share one prompt, and a prompt leaves the
 * queue once nobody can be answered by it.
 */

/**
 * One parked connect prompt per tab and requesting site. A dApp that calls
 * `connect()` again (or in a loop) while its prompt waits joins it instead of
 * stacking another; every joined call gets the same answer.
 */
export class ParkedConnects<T> {
  private readonly byKey = new Map<string, Promise<T>>();

  /** The answer of this tab and site's parked prompt, starting it with `park` when there is none. */
  join(tabId: number, origin: string, park: () => Promise<T>): Promise<T> {
    const key = `${tabId}|${origin}`;
    const existing = this.byKey.get(key);
    if (existing) return existing;
    const parked: Promise<T> = park().finally(() => {
      if (this.byKey.get(key) === parked) this.byKey.delete(key);
    });
    this.byKey.set(key, parked);
    return parked;
  }

  /** Forgets a tab's prompts (the tab closed or left the page), so the next connect parks anew. */
  forgetTab(tabId: number): void {
    for (const key of this.byKey.keys()) {
      if (key.startsWith(`${tabId}|`)) this.byKey.delete(key);
    }
  }

  get size(): number {
    return this.byKey.size;
  }
}

/** Removes and returns a tab's parked entries for `methods`; the caller answers them. */
export function takeParkedRequests<E extends { tabId: number; method: string }>(
  pending: Map<string, E>,
  tabId: number,
  methods: ReadonlySet<string>,
): E[] {
  const taken: E[] = [];
  for (const [requestId, entry] of pending) {
    if (entry.tabId !== tabId || !methods.has(entry.method)) continue;
    pending.delete(requestId);
    taken.push(entry);
  }
  return taken;
}

/**
 * True when a `webNavigation.onCommitted` event puts a new document in a tab's
 * top frame (a navigation or a reload): not the page that asked. Same-document
 * changes (an SPA's pushState, a #fragment) do not commit; a prerendered page
 * commits before it is shown and is not on screen.
 */
export function isNewTopDocument(details: { frameId: number; documentLifecycle?: string }): boolean {
  return details.frameId === 0 && details.documentLifecycle !== 'prerender';
}
