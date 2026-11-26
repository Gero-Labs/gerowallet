/**
 * The vault address's UTxOs and history from the chain reader (`VaultChainReader`). Provider
 * answers are a display only: the balance is never used to build or sign anything.
 */
import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import type { Cardano } from '@cardano-sdk/core';
import type { VaultChainReader, VaultHistoryEntry } from '@/modules/gerovault/contracts';
import type { VaultNetwork } from '@/shared/gerovault';
import { summarizeVaultUtxos, type VaultBalance } from './balance';
import { useVaultChainReaderFactory } from './context';

/** `unavailable`: no reader for this network in this build. */
export type ChainReadState = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';

export const HISTORY_PAGE_SIZE = 20;

export interface VaultChainTarget {
  readonly network: VaultNetwork;
  /** The vault's base address, bech32. */
  readonly address: string;
}

export function useVaultChain(target: Ref<VaultChainTarget | undefined>, options: { readonly history?: boolean } = {}) {
  const withHistory = options.history !== false;
  const factory = useVaultChainReaderFactory();
  const reader = computed<VaultChainReader | undefined>(() => (target.value ? factory(target.value.network) : undefined));

  const balanceState = ref<ChainReadState>('idle');
  const utxos = shallowRef<readonly Cardano.Utxo[]>([]);
  const balance = shallowRef<VaultBalance | undefined>(undefined);

  const historyState = ref<ChainReadState>('idle');
  const history = shallowRef<readonly VaultHistoryEntry[]>([]);
  const historyPage = ref(0);
  /** A full page came back, so there may be more. */
  const historyMore = ref(false);
  const loadingMore = ref(false);

  let controller: AbortController | undefined;

  function abort(): void {
    controller?.abort();
    controller = undefined;
  }

  async function loadBalance(r: VaultChainReader, address: string, signal: AbortSignal): Promise<void> {
    balanceState.value = 'loading';
    try {
      const rows = await r.utxos(address, { signal });
      if (signal.aborted) return;
      utxos.value = rows;
      balance.value = summarizeVaultUtxos(rows);
      balanceState.value = 'ready';
    } catch {
      if (signal.aborted) return;
      utxos.value = [];
      balance.value = undefined;
      balanceState.value = 'error';
    }
  }

  async function loadHistory(r: VaultChainReader, address: string, signal: AbortSignal): Promise<void> {
    historyState.value = 'loading';
    try {
      const rows = await r.history(address, { signal, page: 1, pageSize: HISTORY_PAGE_SIZE });
      if (signal.aborted) return;
      history.value = rows;
      historyPage.value = 1;
      historyMore.value = rows.length >= HISTORY_PAGE_SIZE;
      historyState.value = 'ready';
    } catch {
      if (signal.aborted) return;
      history.value = [];
      historyMore.value = false;
      historyState.value = 'error';
    }
  }

  /** Reads both again for the current target. */
  async function refresh(): Promise<void> {
    abort();
    const t = target.value;
    const r = reader.value;
    if (!t) {
      balanceState.value = 'idle';
      historyState.value = 'idle';
      return;
    }
    if (!r) {
      balanceState.value = 'unavailable';
      historyState.value = withHistory ? 'unavailable' : 'idle';
      utxos.value = [];
      balance.value = undefined;
      history.value = [];
      historyMore.value = false;
      return;
    }
    const own = new AbortController();
    controller = own;
    await Promise.all([loadBalance(r, t.address, own.signal), withHistory ? loadHistory(r, t.address, own.signal) : Promise.resolve()]);
  }

  /** The next page of history, appended. Entries already shown are not repeated. */
  async function loadMoreHistory(): Promise<void> {
    const t = target.value;
    const r = reader.value;
    const signal = controller?.signal;
    if (!t || !r || !signal || loadingMore.value || !historyMore.value) return;
    loadingMore.value = true;
    try {
      const next = historyPage.value + 1;
      const rows = await r.history(t.address, { signal, page: next, pageSize: HISTORY_PAGE_SIZE });
      if (signal.aborted) return;
      const seen = new Set(history.value.map(h => h.txHash));
      history.value = [...history.value, ...rows.filter(h => !seen.has(h.txHash))];
      historyPage.value = next;
      historyMore.value = rows.length >= HISTORY_PAGE_SIZE;
    } catch {
      if (!signal.aborted) historyMore.value = false;
    } finally {
      loadingMore.value = false;
    }
  }

  watch(() => (target.value ? `${target.value.network}|${target.value.address}` : ''), () => void refresh(), { immediate: true });
  if (getCurrentScope()) onScopeDispose(abort);

  return {
    reader,
    balanceState,
    utxos,
    balance,
    historyState,
    history,
    historyMore,
    loadingMore,
    refresh,
    loadMoreHistory,
  };
}
