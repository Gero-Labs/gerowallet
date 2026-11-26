/**
 * The vault screen's state, shared by its shell (`GerovaultVault.vue`) and its tabs
 * (`GerovaultTabPanel.vue`): the shell loads the record and the chain once and provides them.
 */
import { computed, inject, provide, ref, watch, type ComputedRef, type InjectionKey, type Ref, type ShallowRef } from 'vue';
import type { VaultRecord } from '@/modules/gerovault/contracts';
import { useFundingVerifier } from './context';
import { useVaultChain, type VaultChainTarget } from './useVaultChain';
import { useVaultRecord, type VaultReadState } from './useVaults';
import { vaultFacts, type VaultFacts } from './vaultFacts';
import { cosignerChecks, fundingState, type CosignerCheck, type FundingState } from './verification';

export interface VaultView {
  readonly vaultId: Ref<string>;
  readonly walletId: ComputedRef<number | undefined>;
  readonly state: Ref<VaultReadState>;
  readonly record: ShallowRef<VaultRecord | undefined>;
  /** Undefined when the record is missing or its scripts do not read as a vault. */
  readonly facts: ComputedRef<VaultFacts | undefined>;
  readonly checks: ComputedRef<readonly CosignerCheck[]>;
  /** Undefined while it is being worked out. */
  readonly funding: Ref<FundingState | undefined>;
  readonly chain: ReturnType<typeof useVaultChain>;
  readonly reload: () => Promise<void>;
  /** Takes a record the store just returned (after accept or update). */
  readonly replace: (next: VaultRecord) => void;
}

export const GEROVAULT_VAULT_VIEW: InjectionKey<VaultView> = Symbol('gerovault.vaultView');

/** Loads the vault the route names and provides it to the tabs. */
export function provideVaultView(vaultId: Ref<string>): VaultView {
  const { state, record, reload, replace, walletId } = useVaultRecord(vaultId);
  const facts = computed(() => (record.value ? vaultFacts(record.value) : undefined));
  const checks = computed(() => (record.value && facts.value ? cosignerChecks(record.value, facts.value.participants) : []));
  const target = computed<VaultChainTarget | undefined>(() =>
    record.value && facts.value ? { network: record.value.network, address: facts.value.addresses.base } : undefined);
  const chain = useVaultChain(target);
  const verifier = useFundingVerifier();
  const funding = ref<FundingState | undefined>(undefined);
  let generation = 0;
  watch(record, async row => {
    const mine = ++generation;
    funding.value = undefined;
    if (!row) return;
    const answer = await fundingState(row, verifier);
    if (mine === generation) funding.value = answer;
  }, { immediate: true });

  const view: VaultView = { vaultId, walletId, state, record, facts, checks, funding, chain, reload, replace };
  provide(GEROVAULT_VAULT_VIEW, view);
  return view;
}

export function useVaultView(): VaultView | undefined {
  return inject(GEROVAULT_VAULT_VIEW, undefined);
}
