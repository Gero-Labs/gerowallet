/**
 * The vault screen's cNIGHT and DUST state for one vault, and proposing its stake and DUST
 * operations. Reads go through `dustChain.ts`; a proposal is built here (`buildVaultOperation`),
 * turned into the unsigned bundle every owner signs, and started as this wallet's spend session,
 * so the signatures screen shows its sheet. Nothing here signs.
 */
import { computed, ref, shallowRef, watch, type Ref } from 'vue';
import type { Cardano } from '@cardano-sdk/core';
import type { MidnightDustRegistrationStatusDto } from '@/api/midnight-api';
import { Blockchain, type Wallet } from '@/models/types';
import { SLICE_NETWORKS, vaultNetworkOf, type UnsignedTxBundle, type VaultRecord } from '@/modules/gerovault/contracts';
import { createUnsignedBundle } from '@/modules/gerovault/spend/bundle';
import { useVaultChainReaderFactory } from '@/modules/gerovault/spend/chainReader';
import { spendError } from '@/modules/gerovault/spend/errors';
import { spendSessionKey, startSpendSession } from '@/modules/gerovault/spend/spendSession';
import { spendContextOf, type VaultSpendContext } from '@/modules/gerovault/spend/vaultSpendContext';
import { geroStore } from '@/stores/geroStore';
import { isBitcoinTip, networkStore } from '@/stores/networkStore';
import { walletStore } from '@/stores/walletStore';
import { walletDisplayName } from '@/shared/utils/walletAccount';
import { buildVaultOperation, type OperationRequest } from './buildOperation';
import {
  cnightHeld,
  readGeneration,
  readStakeAccount,
  readVaultRegistrations,
  registrationDustAddress,
  stakeChainState,
  walletFirstAddress,
  type StakeAccountState,
} from './dustChain';
import { dustAddressHex, mappingValidatorFor } from './mappingValidator';

/** A DUST address of one of this wallet's Midnight wallets. */
export interface DustDestinationOption {
  readonly key: string;
  readonly label: string;
  readonly dustAddress: string;
}

/**
 * - `ready`: the reads came back (each may still say "unknown").
 * - `unavailable`: the vault cannot run DUST operations here (network, candidate, not an owner).
 */
export type VaultDustState = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';

export function useVaultDust(record: Ref<VaultRecord | undefined>, utxos: Ref<readonly Cardano.Utxo[]>) {
  const readerFactory = useVaultChainReaderFactory();
  const state = ref<VaultDustState>('idle');
  const context = shallowRef<VaultSpendContext | null>(null);
  const account = shallowRef<StakeAccountState | null>(null);
  const accountError = ref(false);
  const registrations = shallowRef<Cardano.Utxo[]>([]);
  const generation = shallowRef<MidnightDustRegistrationStatusDto | null>(null);
  const generationError = ref(false);

  const network = computed(() => record.value?.network);
  const validator = computed(() => (network.value ? mappingValidatorFor(network.value) : undefined));
  const wallet = computed<Wallet | null>(() => walletStore.loggedWallet ?? null);
  const cnight = computed(() => (network.value ? cnightHeld(utxos.value, network.value) : 0n));
  const registeredTo = computed(() => (network.value && registrations.value.length > 0 ? registrationDustAddress(registrations.value[0], network.value) : undefined));

  /** This wallet's Midnight wallets on the vault's network that have a DUST address. */
  const destinations = computed<DustDestinationOption[]>(() => {
    const walletNetwork = wallet.value?.network;
    const vaultNetwork = network.value;
    if (!walletNetwork || !vaultNetwork) return [];
    const out: DustDestinationOption[] = [];
    for (const w of Object.values(geroStore.wallets ?? {}) as Wallet[]) {
      if (w.chain !== Blockchain.MIDNIGHT || w.network !== walletNetwork) continue;
      let dust = '';
      try {
        dust = w.publicKey ? String(JSON.parse(w.publicKey)?.dust ?? '') : '';
      } catch {
        dust = '';
      }
      if (dust && dustAddressHex(vaultNetwork, dust)) out.push({ key: `wallet:${w.id}`, label: walletDisplayName(w, geroStore.wallets), dustAddress: dust });
    }
    return out;
  });

  let generationRun = 0;
  async function refresh(): Promise<void> {
    const run = ++generationRun;
    const current = record.value;
    const settle = (fn: () => void) => {
      if (run === generationRun) fn();
    };
    context.value = null;
    if (!current || current.status !== 'accepted' || !SLICE_NETWORKS.includes(current.network)
      || vaultNetworkOf(wallet.value?.network) !== current.network || !mappingValidatorFor(current.network)) {
      state.value = 'unavailable';
      return;
    }
    let ctx: VaultSpendContext;
    try {
      ctx = await spendContextOf(current);
    } catch {
      settle(() => { state.value = 'unavailable'; });
      return;
    }
    const reader = readerFactory(current.network);
    if (!reader) {
      settle(() => { state.value = 'unavailable'; });
      return;
    }
    settle(() => {
      context.value = ctx;
      state.value = 'loading';
    });
    const [accountRead, registrationsRead, generationRead] = await Promise.allSettled([
      readStakeAccount(current.network, ctx.rewardAccount),
      readVaultRegistrations(reader, ctx),
      readGeneration(current.network, ctx.rewardAccount),
    ]);
    settle(() => {
      account.value = accountRead.status === 'fulfilled' ? accountRead.value : null;
      accountError.value = accountRead.status === 'rejected';
      registrations.value = registrationsRead.status === 'fulfilled' ? registrationsRead.value : [];
      generation.value = generationRead.status === 'fulfilled' ? generationRead.value : null;
      generationError.value = generationRead.status === 'rejected';
      state.value = registrationsRead.status === 'fulfilled' ? 'ready' : 'error';
    });
  }

  /** The chain tip's slot, or null. */
  const currentSlot = computed<number | null>(() => {
    const tip = networkStore.tip;
    if (!tip || isBitcoinTip(tip)) return null;
    const slot = Number(tip.slot);
    return Number.isSafeInteger(slot) && slot >= 0 ? slot : null;
  });

  /**
   * Builds the proposal, makes its bundle and starts this wallet's session with it. Throws
   * `VaultSpendError` (the builder's codes, and `PARAMS_UNAVAILABLE` before the reads are in).
   */
  async function propose(request: OperationRequest): Promise<UnsignedTxBundle> {
    const ctx = context.value;
    const current = record.value;
    const walletId = wallet.value?.id;
    const params = networkStore.epochParams;
    if (!ctx || !current || typeof walletId !== 'number' || state.value !== 'ready') return spendError('PARAMS_UNAVAILABLE', 'The vault\'s state is not read yet');
    if (!params || currentSlot.value === null) return spendError('PARAMS_UNAVAILABLE', 'Not synced');
    const reader = readerFactory(current.network);
    if (!reader) return spendError('PARAMS_UNAVAILABLE', 'No chain reader');
    let collateral;
    if (request.kind === 'dust_register' || request.kind === 'dust_deregister') {
      const address = await walletFirstAddress(wallet.value?.publicKey, current.network);
      if (!address) return spendError('NO_COLLATERAL', 'This wallet has no first address to give collateral from');
      collateral = { address, utxos: await reader.utxos(address) };
    }
    const built = await buildVaultOperation({
      context: ctx,
      utxos: utxos.value,
      request,
      chain: stakeChainState(account.value ?? { registered: null, rewards: 0n }, registrations.value),
      protocolParameters: params,
      currentSlot: currentSlot.value,
      ...(collateral ? { collateral } : {}),
    });
    const bundle = await createUnsignedBundle(ctx, built, reader.txCbor);
    startSpendSession(spendSessionKey(walletId, ctx.vaultId), bundle);
    return bundle;
  }

  watch([() => record.value?.vaultId, () => record.value?.status, () => wallet.value?.id], () => { void refresh(); }, { immediate: true });

  return {
    state,
    context,
    validator,
    account,
    accountError,
    registrations,
    registeredTo,
    generation,
    generationError,
    cnight,
    destinations,
    refresh,
    propose,
  };
}
