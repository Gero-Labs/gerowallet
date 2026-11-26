/**
 * The logged-in wallet's vaults from the vault store: the list for the overview, one record for the
 * vault screen. A store that cannot be read says so (`unavailable`), never "no vaults".
 */
import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import type { VaultRecord } from '@/modules/gerovault/contracts';
import { useGerovaultStore, useGerovaultWallet } from './context';

/** `noWallet`: no Cardano wallet is logged in. `unavailable`: the wallet database could not be read. */
export type VaultReadState = 'loading' | 'ready' | 'notFound' | 'unavailable' | 'noWallet';

const HEX32 = /^[0-9a-f]{64}$/;

/** Every vault of the logged-in wallet, oldest first, accepted and candidates alike. */
export function useVaultList() {
  const store = useGerovaultStore();
  const wallet = useGerovaultWallet();
  const walletId = computed(() => wallet()?.walletId);
  const state = ref<VaultReadState>('loading');
  const vaults = shallowRef<readonly VaultRecord[]>([]);
  let generation = 0;

  async function reload(): Promise<void> {
    const id = walletId.value;
    const mine = ++generation;
    if (id === undefined) {
      vaults.value = [];
      state.value = 'noWallet';
      return;
    }
    state.value = 'loading';
    try {
      const rows = await store.list(id);
      if (mine !== generation) return;
      vaults.value = rows;
      state.value = 'ready';
    } catch {
      if (mine !== generation) return;
      vaults.value = [];
      state.value = 'unavailable';
    }
  }

  watch(walletId, () => void reload(), { immediate: true });
  const accepted = computed(() => vaults.value.filter(v => v.status === 'accepted'));
  const candidates = computed(() => vaults.value.filter(v => v.status === 'candidate'));
  return { state, vaults, accepted, candidates, reload };
}

/** One vault of the logged-in wallet, by the id the route names. */
export function useVaultRecord(vaultId: Ref<string>) {
  const store = useGerovaultStore();
  const wallet = useGerovaultWallet();
  const walletId = computed(() => wallet()?.walletId);
  const state = ref<VaultReadState>('loading');
  const record = shallowRef<VaultRecord | undefined>(undefined);
  let generation = 0;

  async function reload(): Promise<void> {
    const id = walletId.value;
    const vault = vaultId.value;
    const mine = ++generation;
    if (id === undefined) {
      record.value = undefined;
      state.value = 'noWallet';
      return;
    }
    if (!HEX32.test(vault)) {
      record.value = undefined;
      state.value = 'notFound';
      return;
    }
    if (record.value?.vaultId !== vault) state.value = 'loading';
    try {
      const row = await store.get(id, vault);
      if (mine !== generation) return;
      record.value = row;
      state.value = row ? 'ready' : 'notFound';
    } catch {
      if (mine !== generation) return;
      record.value = undefined;
      state.value = 'unavailable';
    }
  }

  /** Replaces the record with one the store just returned (after accept or update). */
  function replace(next: VaultRecord): void {
    if (next.vaultId !== vaultId.value) return;
    ++generation;
    record.value = next;
    state.value = 'ready';
  }

  watch([walletId, vaultId], () => void reload(), { immediate: true });
  if (getCurrentScope()) onScopeDispose(() => { generation++; });
  return { state, record, reload, replace, walletId };
}
