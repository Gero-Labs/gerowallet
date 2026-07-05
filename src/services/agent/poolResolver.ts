// src/services/agent/poolResolver.ts

/** Minimal pool item shape returned by stakingStore.loadPoolsPaginated */
export interface PoolItem {
  ticker: string;
  pool_id_bech32: string;
}

/** Search function signature — injectable for testing */
export type PoolSearchFn = (symbol: string) => Promise<{ items: PoolItem[] }>;

/**
 * Factory that creates a `resolvePoolSymbolToId` function backed by the provided search fn.
 * The search fn receives the raw symbol string and returns `{ items }`.
 * The first item whose `ticker` matches case-insensitively wins.
 *
 * Usage (production):
 *   const resolve = createPoolResolver(defaultPoolSearchFn());
 *   const id = await resolve('GERO'); // pool1...
 *
 * Usage (tests):
 *   const resolve = createPoolResolver(async () => ({ items: [...] }));
 */
export function createPoolResolver(searchFn: PoolSearchFn): (symbol: string) => Promise<string | null> {
  return async function resolvePoolSymbolToId(symbol: string): Promise<string | null> {
    const needle = (symbol || '').trim().toLowerCase();
    if (!needle) return null;
    const { items } = await searchFn(needle);
    const hit = items.find((p) => (p.ticker || '').toLowerCase() === needle);
    return hit ? hit.pool_id_bech32 : null;
  };
}

/**
 * Returns a production-ready PoolSearchFn that delegates to
 * `stakingStoreActions.loadPoolsPaginated`.
 * Imported lazily inside the function so this module is safe to import in tests
 * without triggering Vue.observable / browser-API side effects at module-eval time.
 */
export function defaultPoolSearchFn(): PoolSearchFn {
  return async (symbol: string) => {
    // Lazy import keeps module-eval safe for test environments
    const { default: stakingStoreActions } = await import('@/stores/stakingStore');
    const { walletStore } = await import('@/stores/walletStore');
    const wallet = walletStore.loggedWallet;
    await stakingStoreActions.loadPoolsPaginated(wallet, { search: symbol, per_page: 50 });
    return { items: stakingStoreActions.state.pools as PoolItem[] };
  };
}

/**
 * Convenience: the default resolver wired to stakingStore + walletStore.
 * Call site: `await resolvePoolSymbolToId('GERO')`.
 * The lazy imports inside defaultPoolSearchFn keep it test-safe.
 */
export const resolvePoolSymbolToId = createPoolResolver(defaultPoolSearchFn());
