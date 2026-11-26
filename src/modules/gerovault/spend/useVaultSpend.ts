/**
 * Loads what both spend screens need for the vault the route names: this wallet's record of it,
 * read into a spend context, the chain reader for its network, the other vaults this wallet has
 * accepted, and the chain tip. Each reason a vault cannot be spent from here is its own state, so
 * a screen says which.
 */
import { computed, ref, watch, type Ref } from 'vue';
import { SLICE_NETWORKS, vaultNetworkOf, type VaultChainReader, type VaultRecord, type VaultStore } from '@/modules/gerovault/contracts';
import { vaultStore as defaultVaultStore } from '@/db/vaultStore';
import { walletStore } from '@/stores/walletStore';
import { networkStore, isBitcoinTip } from '@/stores/networkStore';
import { VaultSpendError } from './errors';
import { useVaultChainReaderFactory } from './chainReader';
import { spendContextOf, type VaultSpendContext } from './vaultSpendContext';
import { knownVaultsOf, type KnownVault } from './review';

/**
 * - `no_wallet`: no Cardano wallet is open.
 * - `not_found`: this wallet does not hold the vault.
 * - `store`: the wallet database could not be read.
 * - `network_closed`: the vault is on a network this release does not open, or not the wallet's.
 * - `not_accepted`: a candidate vault: never spent from or signed for.
 * - `not_owner`: this wallet is not an owner of the vault.
 * - `invalid`: the stored record does not read back.
 * - `no_reader`: no chain access for the vault's network.
 */
export type VaultSpendUnavailable = 'no_wallet' | 'not_found' | 'store' | 'network_closed' | 'not_accepted' | 'not_owner' | 'invalid' | 'no_reader';

export type VaultSpendLoad =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable'; readonly reason: VaultSpendUnavailable }
  | {
      readonly status: 'ready';
      readonly record: VaultRecord;
      readonly context: VaultSpendContext;
      readonly reader: VaultChainReader;
      readonly knownVaults: readonly KnownVault[];
    };

export function useVaultSpend(vaultId: Ref<string>, store: VaultStore = defaultVaultStore) {
  const readerFactory = useVaultChainReaderFactory();
  const load = ref<VaultSpendLoad>({ status: 'loading' });
  const walletId = computed<number | null>(() => {
    const id = walletStore.loggedWallet?.id;
    return typeof id === 'number' ? id : null;
  });
  const wallet = computed(() => walletStore.loggedWallet ?? null);
  /** The wallet's chain tip slot, or null when it has none yet. */
  const currentSlot = computed<number | null>(() => {
    const tip = networkStore.tip;
    if (!tip || isBitcoinTip(tip)) return null;
    const slot = Number(tip.slot);
    return Number.isSafeInteger(slot) && slot >= 0 ? slot : null;
  });
  const protocolParameters = computed(() => networkStore.epochParams ?? null);

  let generation = 0;
  async function reload(): Promise<void> {
    const current = ++generation;
    const settle = (next: VaultSpendLoad) => {
      if (current === generation) load.value = next;
    };
    load.value = { status: 'loading' };
    const id = walletId.value;
    if (id === null) return settle({ status: 'unavailable', reason: 'no_wallet' });
    const walletNetwork = vaultNetworkOf(wallet.value?.network);
    let record: VaultRecord | undefined;
    let accepted: readonly VaultRecord[];
    try {
      record = await store.get(id, vaultId.value);
      accepted = record ? await store.list(id, { status: 'accepted', network: record.network }) : [];
    } catch (error) {
      const code = (error as { code?: string })?.code;
      return settle({ status: 'unavailable', reason: code === 'INVALID_INPUT' ? 'not_found' : 'store' });
    }
    if (!record) return settle({ status: 'unavailable', reason: 'not_found' });
    if (!SLICE_NETWORKS.includes(record.network) || record.network !== walletNetwork) return settle({ status: 'unavailable', reason: 'network_closed' });
    if (record.status !== 'accepted') return settle({ status: 'unavailable', reason: 'not_accepted' });
    let context: VaultSpendContext;
    try {
      context = await spendContextOf(record);
    } catch (error) {
      return settle({ status: 'unavailable', reason: error instanceof VaultSpendError && error.code === 'NOT_AN_OWNER' ? 'not_owner' : 'invalid' });
    }
    const reader = readerFactory(record.network);
    if (!reader || reader.network !== record.network) return settle({ status: 'unavailable', reason: 'no_reader' });
    const knownVaults = knownVaultsOf(accepted, record.vaultId);
    settle({ status: 'ready', record, context, reader, knownVaults });
  }

  watch([vaultId, walletId], () => { void reload(); }, { immediate: true });

  return { load, wallet, walletId, currentSlot, protocolParameters, reload };
}
