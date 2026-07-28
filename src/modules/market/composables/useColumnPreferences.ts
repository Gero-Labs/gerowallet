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

// Bumped to _v3 so the leaner default column set applies for everyone (old
// saved prefs under the v1/v2 keys are ignored). Users can still add columns
// back via the column picker.
const STORAGE_KEY = 'gero_market_columns_v3';

// Default visible data columns: 24H, 7D, LAST 7D (sparkline), VOLUME, MCAP,
// ALLOCATION, P&L. Everything else is off by default (users opt in via the
// picker). Core columns #/TOKEN/PRICE (and BALANCE/VALUE in holdings) are
// locked-on separately in MarketTokenTable.
const DEFAULTS: ColumnPreferences = {
  change1h: false,
  change24h: true,
  change7d: true,
  change30d: false,
  volume24h: true,
  volume7d: false,
  txnCount24h: false,
  makerCount24h: false,
  totalSupply: false,
  sparkline: true,
  mcap: true,
  tvl: false,
  allocation: true,
  avgCostBasis: false,
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
