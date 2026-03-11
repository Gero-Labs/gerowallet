import { ref, computed, watch, type Ref, type ComputedRef } from 'vue';

const STORAGE_KEY = 'gero_market_watchlist';

function loadFromStorage(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveToStorage(list: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage full or unavailable — silent fail
  }
}

// Singleton state so all components share the same watchlist
const watchlist: Ref<string[]> = ref(loadFromStorage());
// Set for O(1) lookups — kept in sync with watchlist array
const watchlistSet = ref<Set<string>>(new Set(watchlist.value));

watch(watchlist, (val) => {
  watchlistSet.value = new Set(val);
  saveToStorage(val);
}, { deep: true });

export function useWatchlist() {
  function isWatched(unit: string): boolean {
    return watchlistSet.value.has(unit);
  }

  function toggleWatchlist(unit: string) {
    const idx = watchlist.value.indexOf(unit);
    if (idx >= 0) {
      watchlist.value.splice(idx, 1);
    } else {
      watchlist.value.push(unit);
    }
  }

  const watchlistCount: ComputedRef<number> = computed(() => watchlist.value.length);

  return {
    watchlist,
    isWatched,
    toggleWatchlist,
    watchlistCount,
  };
}
