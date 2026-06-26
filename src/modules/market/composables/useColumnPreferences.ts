import { ref, computed, watch, type Ref, type ComputedRef } from 'vue';

export type ColumnKey = 'change1h' | 'change24h' | 'change7d' | 'change30d' | 'volume24h' | 'volume7d' | 'txnCount24h' | 'makerCount24h' | 'totalSupply' | 'sparkline' | 'mcap' | 'tvl' | 'allocation' | 'avgCostBasis' | 'totalPnl';

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
  allocation: boolean;
  avgCostBasis: boolean;
  totalPnl: boolean;
}

// Bumped to _v2 so the richer, website-matching default column set applies for
// everyone (old saved prefs under the v1 key are ignored). Users can still
// hide columns via the column picker.
const STORAGE_KEY = 'gero_market_columns_v2';

// Default column set mirrors the market-data website table
// (cardano-market-data MarketTable.tsx): price, 1h/24h/7d/30d, sparkline,
// vol 24h/7d, TXN, Makers, Liquidity (tvl), Market Cap, Supply.
const DEFAULTS: ColumnPreferences = {
  change1h: true,
  change24h: true,
  change7d: true,
  change30d: true,
  volume24h: true,
  volume7d: true,
  txnCount24h: true,
  makerCount24h: true,
  totalSupply: true,
  sparkline: true,
  mcap: true,
  tvl: true,
  allocation: false,
  avgCostBasis: true,
  totalPnl: true,
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
