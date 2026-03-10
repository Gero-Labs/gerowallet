import { ref, watch } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { stakingStore } from '@/stores/stakingStore';
import { useMarketData, type MarketToken } from '@/modules/market/composables/useMarketData';

export interface SearchResult {
  type: 'token' | 'transaction' | 'pool' | 'store';
  id: string;
  title: string;
  subtitle: string;
  icon?: string;
  route?: string;
}

// Module-level state (singleton pattern — shared across components)
const isOpen = ref(false);
const query = ref('');
const results = ref<SearchResult[]>([]);

export function useGlobalSearch() {
  const { allTokens } = useMarketData();

  function open() {
    isOpen.value = true;
    query.value = '';
    results.value = [];
  }

  function close() {
    isOpen.value = false;
    query.value = '';
    results.value = [];
  }

  function toggle() {
    if (isOpen.value) close();
    else open();
  }

  function search(q: string) {
    if (!q || q.length < 2) {
      results.value = [];
      return;
    }

    const lower = q.toLowerCase();
    const found: SearchResult[] = [];

    // 1. Token search from market data
    const tokenMatches = allTokens.value
      .filter((t: MarketToken) =>
        t.ticker?.toLowerCase().includes(lower) ||
        t.name?.toLowerCase().includes(lower) ||
        t.unit?.toLowerCase().includes(lower)
      )
      .slice(0, 8)
      .map((t: MarketToken) => ({
        type: 'token' as const,
        id: t.unit,
        title: t.ticker || t.name || t.unit.slice(0, 12),
        subtitle: t.name || '',
        icon: t.img || '',
        route: `/?view=all&token=${t.unit}`,
      }));
    found.push(...tokenMatches);

    // 2. Transaction search (only for longer queries that look like hashes)
    if (lower.length >= 8) {
      const txs = walletStore.transactions || [];
      const txMatches = (Array.isArray(txs) ? txs : [])
        .filter((tx: any) => tx.id?.toLowerCase().includes(lower))
        .slice(0, 5)
        .map((tx: any) => ({
          type: 'transaction' as const,
          id: tx.id,
          title: `${tx.id.slice(0, 12)}...${tx.id.slice(-8)}`,
          subtitle: tx.type || 'Transaction',
          icon: 'mdi-swap-horizontal',
          route: `/transactions?tx=${tx.id}`,
        }));
      found.push(...txMatches);
    }

    // 3. Stake pool search
    try {
      const pools = stakingStore.pools || [];
      const poolMatches = pools
        .filter((p: any) =>
          p.name?.toLowerCase().includes(lower) ||
          p.ticker?.toLowerCase().includes(lower) ||
          p.poolId?.toLowerCase().includes(lower)
        )
        .slice(0, 5)
        .map((p: any) => ({
          type: 'pool' as const,
          id: p.poolId,
          title: p.ticker ? `[${p.ticker}] ${p.name}` : p.name || p.poolId,
          subtitle: 'Stake Pool',
          icon: 'mdi-server',
          route: `/staking?pool=${p.poolId}`,
        }));
      found.push(...poolMatches);
    } catch {
      // stakingStore not available
    }

    results.value = found;
  }

  // Debounced search on query change
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  watch(query, (val) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => search(val), 200);
  });

  // Keyboard shortcut handler
  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      toggle();
    }
    if (e.key === 'Escape' && isOpen.value) {
      close();
    }
  }

  return {
    isOpen,
    query,
    results,
    open,
    close,
    toggle,
    handleKeydown,
  };
}
