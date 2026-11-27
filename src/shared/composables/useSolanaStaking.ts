/**
 * The logged Solana account's stake accounts, the validator list and the epoch, read from Nexus
 * for display (the worker reads them again before it builds anything: chrome/solanaStake.ts).
 *
 * Reloads when the account changes and when Gero Sync delivers a new transaction (a stake,
 * unstake or withdrawal landing). Nexus caches each answer for up to 30 s (validators 10 min).
 */
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import { debugLog } from '@/utils/debug';
import type { SolanaStakeInfo, SolanaStakes, SolanaValidator } from '@/chains/solana/solanaStaking';

/** Nexus's `/stakes` cache: a read sooner after an action can still show the old state. */
const AFTER_ACTION_RELOAD_MS = 35_000;

export function useSolanaStaking() {
  const stakes = shallowRef<SolanaStakes | null>(null);
  const validators = shallowRef<SolanaValidator[] | null>(null);
  const info = shallowRef<SolanaStakeInfo | null>(null);
  const loading = ref(false);
  const failed = ref(false);
  const validatorsFailed = ref(false);

  const owner = computed(() => (walletStore.loggedWallet?.chain === Blockchain.SOLANA ? walletStore.loggedWallet.publicKey : ''));
  const network = computed(() => walletStore.loggedWallet?.network ?? '');
  const byVote = computed(() => new Map((validators.value ?? []).map((v) => [v.votePubkey, v])));

  let generation = 0;
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;

  async function load(): Promise<void> {
    const address = owner.value;
    const net = network.value;
    const mine = ++generation;
    if (!address) {
      stakes.value = null;
      return;
    }
    loading.value = true;
    try {
      const { SolanaApi } = await import('@/api/solana-api');
      const api = new SolanaApi(net);
      const [s, v, i] = await Promise.allSettled([api.getStakes(address), api.getValidators(), api.getStakeInfo()]);
      // A switch to another account while reading: its own load owns the state.
      if (mine !== generation) return;
      failed.value = s.status === 'rejected';
      if (s.status === 'fulfilled') stakes.value = s.value;
      validatorsFailed.value = v.status === 'rejected';
      if (v.status === 'fulfilled') validators.value = v.value.validators;
      if (i.status === 'fulfilled') info.value = i.value;
      if (s.status === 'rejected') debugLog('Solana staking: stake accounts unavailable', s.reason);
    } catch (error) {
      if (mine === generation) failed.value = true;
      debugLog('Solana staking: load failed', error);
    } finally {
      if (mine === generation) loading.value = false;
    }
  }

  /** After an action: read now and again once Nexus's cache has turned over. */
  function reloadAfterAction(): void {
    void load();
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => void load(), AFTER_ACTION_RELOAD_MS);
  }

  watch([owner, network], () => {
    stakes.value = null;
    validators.value = null;
    info.value = null;
    void load();
  }, { immediate: true });
  // A new transaction of this account may be a stake account changing.
  watch(() => walletStore.solanaTransactions?.[0]?.signature, (now, before) => {
    if (now && before && now !== before) void load();
  });
  onBeforeUnmount(() => {
    generation++;
    clearTimeout(reloadTimer);
  });

  return { stakes, validators, info, byVote, loading, failed, validatorsFailed, load, reloadAfterAction, owner };
}
