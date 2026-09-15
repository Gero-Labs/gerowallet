import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type { Ref } from 'vue';
import type { Subscription } from 'dexie';
import { liveQuery } from 'dexie';
import type { Wallet } from '@/models/types';
import { walletLibraryRepository, WalletLibraryError } from '@/db/wallet-library';
import { categoryFor, favoriteWallet, moveWalletOrder, matchesWallet, normalizePreferences, sortWallets } from '@/services/walletLibrary/model';
import type { LibraryWallet, WalletLibrarySnapshot, WalletSearchAddresses } from '@/services/walletLibrary/model';
import { walletSearchAddresses } from '@/services/walletLibrary/addresses';

export function useWalletLibrary(available: Ref<Wallet[]>, repository = walletLibraryRepository) {
  const confirmed = shallowRef<WalletLibrarySnapshot>({ preferences: normalizePreferences(null), wallets: [] });
  type Change = (snapshot: WalletLibrarySnapshot) => WalletLibrarySnapshot;
  const pending = shallowRef<{ change: Change }[]>([]);
  const state = computed(() => pending.value.reduce((snapshot, entry) => {
    try { return entry.change(snapshot); }
    catch { return snapshot; } // A concurrent deletion is reported by the queued write.
  }, confirmed.value));
  const preferences = computed(() => state.value.preferences);
  const pendingCount = computed(() => pending.value.length);
  const addresses = ref<Record<number, WalletSearchAddresses>>({});
  const query = ref('');
  const favoritesOnly = ref(false);
  const ready = ref(false);
  const saving = ref(false);
  const error = ref('');
  const indexing = ref(false);
  let disposed = false;
  let generation = 0;
  // Signatures avoid expensive address derivation when only display metadata changes.
  const cache = new Map<number, { signature: string; result: WalletSearchAddresses }>();
  const apply = (data: Awaited<ReturnType<typeof repository.read>>) => {
    if (disposed) return;
    confirmed.value = data;
    ready.value = true;
  };
  let subscription: Subscription | undefined;
  const loadFailed = () => { if (!disposed) { ready.value = true; error.value = 'loadFailed'; } };
  // Opening/upgrading IndexedDB can write. Complete it outside liveQuery's
  // read-only context before subscribing (including first install/restore).
  void repository.initialize().then(() => {
    if (disposed) return;
    subscription = liveQuery(() => repository.read()).subscribe({ next: apply, error: loadFailed });
  }).catch(loadFailed);
  watch(available, async wallets => {
    const current = ++generation;
    indexing.value = true;
    const next: Record<number, WalletSearchAddresses> = {};
    for (const wallet of wallets) {
      const signature = JSON.stringify([wallet.chain, wallet.network, wallet.type, wallet.publicKey,
        wallet.baseAddress, wallet.stakeAddress, wallet.watchAddress, wallet.addressType]);
      let cached = cache.get(wallet.id);
      if (cached?.signature !== signature) {
        const result = await walletSearchAddresses(wallet);
        if (disposed || current !== generation) return;
        cached = { signature, result };
        cache.set(wallet.id, cached);
      }
      next[wallet.id] = cached.result;
    }
    for (const id of cache.keys()) if (!wallets.some(wallet => wallet.id === id)) cache.delete(id);
    if (!disposed && current === generation) { addresses.value = next; indexing.value = false; }
  }, { immediate: true });
  onBeforeUnmount(() => { disposed = true; generation++; subscription?.unsubscribe(); });

  const wallets = computed<LibraryWallet[]>(() => {
    const metadata = new Map(state.value.wallets.map(wallet => [wallet.id, wallet]));
    return sortWallets(available.value.map(wallet => ({ ...wallet, ...metadata.get(wallet.id),
      ...(addresses.value[wallet.id] || { addresses: [wallet.baseAddress || wallet.watchAddress || ''].filter(Boolean), stakeAddress: wallet.stakeAddress || '' }) })));
  });
  const favoriteCount = computed(() => wallets.value.filter(wallet => wallet.isFavorite).length);
  const filtered = computed(() => wallets.value.filter(wallet => (!favoritesOnly.value || wallet.isFavorite) && matchesWallet(wallet, query.value || '')));
  const filtering = computed(() => !!(query.value || '').trim() || favoritesOnly.value);
  const groups = computed(() => {
    const pinned = filtered.value.filter(wallet => wallet.isFavorite);
    const categories = [...preferences.value.categories, { id: null, name: '', collapsed: preferences.value.uncategorizedCollapsed }];
    const regular = categories.map(category => ({ ...category, key: category.id || 'uncategorized', favorites: false,
      expanded: filtering.value || !category.collapsed,
      wallets: filtered.value.filter(wallet => !wallet.isFavorite && categoryFor(wallet, preferences.value) === category.id),
      total: wallets.value.filter(wallet => !wallet.isFavorite && categoryFor(wallet, preferences.value) === category.id).length,
    })).filter(group => !filtering.value || group.wallets.length > 0);
    return [{ id: undefined, key: 'favorites', name: '', favorites: true, collapsed: false, expanded: true,
      wallets: pinned, total: favoriteCount.value }, ...regular].filter(group => !filtering.value || group.wallets.length > 0);
  });

  // Apply each intent immediately and serialize storage writes. Keep pending
  // intents over liveQuery snapshots so a late echo cannot undo a newer click.
  // A failed write removes only its own overlay; later edits are replayed.
  let tail = Promise.resolve();
  function enqueue(change: Change, persist: () => Promise<void>): Promise<boolean> {
    const entry = { change };
    pending.value = [...pending.value, entry];
    error.value = '';
    const job = tail.then(async () => {
      try {
        await persist();
        apply(await repository.read());
        return true;
      } catch (failure) {
        if (!disposed) error.value = failure instanceof WalletLibraryError ? failure.code : 'saveFailed';
        try { apply(await repository.read()); } catch { /* Keep the last confirmed state for rollback. */ }
        return false;
      } finally {
        pending.value = pending.value.filter(item => item !== entry);
      }
    });
    tail = job.then(() => undefined);
    return job;
  }
  const toggleFavorite = (id: number) => {
    const wallet = wallets.value.find(item => item.id === id);
    if (!wallet) return Promise.resolve(false);
    const favorite = !wallet.isFavorite;
    return enqueue(snapshot => ({ ...snapshot, wallets: favoriteWallet(snapshot.wallets, id, favorite) }),
      () => repository.setFavorite(id, favorite));
  };
  const moveWallet = (id: number, categoryId: string | null | undefined, beforeId: number | null = null, favorite?: boolean) =>
    enqueue(snapshot => ({ preferences: { ...snapshot.preferences,
      uncategorizedCollapsed: categoryId === null ? false : snapshot.preferences.uncategorizedCollapsed,
      categories: snapshot.preferences.categories.map(category => category.id === categoryId ? { ...category, collapsed: false } : category),
    }, wallets: moveWalletOrder(snapshot.wallets, snapshot.preferences, id, categoryId, beforeId, favorite) }),
    () => repository.moveWallet(id, categoryId, beforeId, favorite));
  const run = async (operation: () => Promise<void>): Promise<boolean> => {
    if (saving.value) return false;
    saving.value = true;
    try { return await enqueue(snapshot => snapshot, operation); }
    finally { saving.value = false; }
  };
  return { preferences, query, favoritesOnly, ready, saving, pendingCount, error, indexing, wallets, filtered, filtering,
    groups, favoriteCount, run, toggleFavorite, moveWallet };
}
