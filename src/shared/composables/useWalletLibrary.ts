import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { Ref } from 'vue';
import type { Subscription } from 'dexie';
import { liveQuery } from 'dexie';
import type { Wallet } from '@/models/types';
import { walletLibraryRepository, WalletLibraryError } from '@/db/wallet-library';
import { categoryFor, matchesWallet, normalizePreferences, sortWallets } from '@/services/walletLibrary/model';
import type { LibraryWallet, WalletOrganization, WalletSearchAddresses } from '@/services/walletLibrary/model';
import { walletSearchAddresses } from '@/services/walletLibrary/addresses';

export function useWalletLibrary(available: Ref<Wallet[]>) {
  const preferences = ref(normalizePreferences(null));
  const organization = ref<WalletOrganization[]>([]);
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
  const apply = (data: Awaited<ReturnType<typeof walletLibraryRepository.read>>) => {
    if (disposed) return;
    preferences.value = data.preferences;
    organization.value = data.wallets;
    ready.value = true;
  };
  let subscription: Subscription | undefined;
  const loadFailed = () => { if (!disposed) { ready.value = true; error.value = 'loadFailed'; } };
  // Opening/upgrading IndexedDB can write. Complete it outside liveQuery's
  // read-only context before subscribing (including first install/restore).
  void walletLibraryRepository.initialize().then(() => {
    if (disposed) return;
    subscription = liveQuery(() => walletLibraryRepository.read()).subscribe({ next: apply, error: loadFailed });
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
    const metadata = new Map(organization.value.map(wallet => [wallet.id, wallet]));
    return sortWallets(available.value.map(wallet => ({ ...wallet, ...metadata.get(wallet.id),
      ...(addresses.value[wallet.id] || { addresses: [wallet.baseAddress || wallet.watchAddress || ''].filter(Boolean), stakeAddress: wallet.stakeAddress || '' }) })));
  });
  const favoriteCount = computed(() => wallets.value.filter(wallet => wallet.isFavorite).length);
  const filtered = computed(() => wallets.value.filter(wallet => (!favoritesOnly.value || wallet.isFavorite) && matchesWallet(wallet, query.value || '')));
  const filtering = computed(() => !!(query.value || '').trim() || favoritesOnly.value);
  const groups = computed(() => {
    const categories = [...preferences.value.categories, { id: null, name: '', collapsed: preferences.value.uncategorizedCollapsed }];
    return categories.map(category => ({ ...category,
      expanded: filtering.value || !category.collapsed,
      wallets: filtered.value.filter(wallet => categoryFor(wallet, preferences.value) === category.id),
      total: wallets.value.filter(wallet => categoryFor(wallet, preferences.value) === category.id).length,
    })).filter(group => !filtering.value || group.wallets.length > 0);
  });
  const run = async (operation: () => Promise<void>): Promise<boolean> => {
    if (saving.value) return false;
    saving.value = true;
    error.value = '';
    try { await operation(); apply(await walletLibraryRepository.read()); return true; }
    catch (failure) { error.value = failure instanceof WalletLibraryError ? failure.code : 'saveFailed'; return false; }
    finally { saving.value = false; }
  };
  return { preferences, query, favoritesOnly, ready, saving, error, indexing, wallets, filtered, filtering, groups, favoriteCount, run };
}
