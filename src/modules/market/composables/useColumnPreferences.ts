import { ref, computed, watch, type Ref, type ComputedRef } from 'vue';

export type ColumnKey = 'change1h' | 'change24h' | 'change7d' | 'change30d' | 'volume24h' | 'volume7d' | 'txnCount24h' | 'makerCount24h' | 'totalSupply' | 'sparkline' | 'mcap' | 'tvl' | 'holders' | 'allocation';

export interface ColumnPreferences {
  change1h: boolean;
  change24h: boolean;
  change7d: boolean;
  change30d: boolean;
  volume24h: boolean;
  volume7d: boolean;
  txnCount24h: boolean;
  makerCount24h: boolean;
  totalSupply: boolean;
  sparkline: boolean;
  mcap: boolean;
  tvl: boolean;
  holders: boolean;
  allocation: boolean;
}

const STORAGE_KEY = 'gero_market_columns';

const DEFAULTS: ColumnPreferences = {
  change1h: false,
  change24h: true,
  change7d: false,
  change30d: false,
  volume24h: false,
  volume7d: false,
  txnCount24h: false,
  makerCount24h: false,
  totalSupply: false,
  sparkline: false,
  mcap: true,
  tvl: false,
  holders: false,
  allocation: false,
};

function loadFromStorage(): ColumnPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle new keys added in future versions
      return { ...DEFAULTS, ...parsed };
    }
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

function saveToStorage(prefs: ColumnPreferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage full or unavailable — silent fail
  }
}

// Singleton state so all components share the same column preferences
const columns: Ref<ColumnPreferences> = ref(loadFromStorage());

watch(columns, (val) => saveToStorage(val), { deep: true });

export function useColumnPreferences() {
  function toggleColumn(key: ColumnKey): void {
    columns.value = { ...columns.value, [key]: !columns.value[key] };
  }

  function resetToDefaults(): void {
    columns.value = { ...DEFAULTS };
  }

  function isColumnVisible(key: string): boolean {
    if (key in columns.value) {
      return columns.value[key as ColumnKey];
    }
    return false;
  }

  const hasCustomColumns: ComputedRef<boolean> = computed(() => {
    return (Object.keys(DEFAULTS) as ColumnKey[]).some(
      key => columns.value[key] !== DEFAULTS[key]
    );
  });

  return {
    columns,
    hasCustomColumns,
    toggleColumn,
    resetToDefaults,
    isColumnVisible,
  };
}
