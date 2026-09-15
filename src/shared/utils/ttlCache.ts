/**
 * A keyed, single-flight, time-limited memo.
 *
 * Governance surfaces are re-entered constantly — open a DRep, go back, open the
 * same DRep, open an action from their record, come back. Each of those views
 * fetched from scratch on every mount, which is both slow and visible: the page
 * blanked to a skeleton before showing the reader what they had just been
 * looking at. `drepRegister.ts` had already solved this for the register; this
 * is the same shape, extracted so the smaller lookups can have it too.
 *
 * Three properties, and each exists because leaving it out caused a real bug:
 *
 *  - SINGLE FLIGHT. The PROMISE is cached, not the value, so two components
 *    mounting on the same tick share one request rather than racing two.
 *  - FAILURE IS NOT CACHED. A rejected load is evicted, so a transient outage
 *    does not pin an error for the whole TTL. (A loader that resolves to a
 *    null-shaped miss is welcome to cache that — this only drops rejections.)
 *  - BOUNDED. A wallet browsing the whole directory would otherwise retain
 *    every DRep record it ever opened; `max` evicts the oldest key.
 *
 * It deliberately has no revalidation, no stale-while-revalidate and no
 * background refresh: governance figures move once an epoch, and a caller that
 * needs the current truth calls `forget` and asks again.
 */

export interface TtlCache<T> {
  /** The cached value for `key`, or `load()`'s result — which is then cached. */
  get(key: string, load: () => Promise<T>): Promise<T>;
  /** Whether `key` is present and still fresh. */
  has(key: string): boolean;
  /**
   * When `key` was actually fetched, or null when it is absent or stale.
   *
   * Callers that show an "as of" stamp MUST use this rather than `Date.now()`
   * after an await: a cached read can be minutes old, and stamping it with the
   * current time claims a freshness the data does not have.
   */
  at(key: string): number | null;
  /** Drop one key, so the next `get` refetches. */
  forget(key: string): void;
  /** Drop everything. The eviction hook for a wallet or network switch. */
  clear(): void;
}

interface Entry<T> {
  value: Promise<T>;
  at: number;
}

export function createTtlCache<T>(ttlMs: number, max = 24): TtlCache<T> {
  // Insertion-ordered, which is what makes the oldest key the first one out.
  const entries = new Map<string, Entry<T>>();

  const fresh = (entry: Entry<T> | undefined): entry is Entry<T> =>
    !!entry && Date.now() - entry.at < ttlMs;

  return {
    get(key, load) {
      const existing = entries.get(key);
      if (fresh(existing)) return existing.value;

      const value = load();
      entries.set(key, { value, at: Date.now() });

      // Rejections ride a side branch so this never adds a link to the caller's
      // await chain, and every caller still observes the rejection itself.
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });

      if (entries.size > max) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
      return value;
    },

    has(key) {
      return fresh(entries.get(key));
    },

    at(key) {
      const entry = entries.get(key);
      return fresh(entry) ? entry.at : null;
    },

    forget(key) {
      entries.delete(key);
    },

    clear() {
      entries.clear();
    },
  };
}
