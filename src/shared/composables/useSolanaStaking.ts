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
/** Nexus caches the validator list 10 min: read it no more often. */
const VALIDATORS_FRESH_MS = 10 * 60_000;
/**
 * The last list read per network, shared by every instance in this document: the panel's home is
 * mounted again on each visit, and the list is large.
 */
const validatorCache = new Map<string, { list: SolanaValidator[]; at: number }>();

/** Tests only. */
export function clearSolanaValidatorCache(): void {
  validatorCache.clear();
}

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

  let validatorsRead: Promise<void> | null = null;
  /** Bumped on an account or network switch: the validator list belongs to a network, not to one load. */
  let accountEpoch = 0;
  /** The Stake picker asked for the list: a switch reads it again for the new account. */
  let pickerWants = false;

  /**
   * Reads the validator list unless a fresh one is held (or a read is under way). It is large
   * (every voting validator), so it is read only when something needs it: a delegated stake
   * account's name, or the Stake picker (`ensureValidators`).
   */
  function readValidators(net: string): Promise<void> {
    const cached = validatorCache.get(net);
    if (cached && Date.now() - cached.at <= VALIDATORS_FRESH_MS) {
      validators.value = cached.list;
      validatorsFailed.value = false;
      return Promise.resolve();
    }
    if (validatorsRead) return validatorsRead;
    const epoch = accountEpoch;
    // A retry shows the picker loading again, not the earlier failure.
    validatorsFailed.value = false;
    const read: Promise<void> = (async () => {
      try {
        const { SolanaApi } = await import('@/api/solana-api');
        const { validators: list } = await new SolanaApi(net).getValidators();
        validatorCache.set(net, { list, at: Date.now() });
        if (epoch !== accountEpoch) return;
        validators.value = list;
        validatorsFailed.value = false;
      } catch (error) {
        if (epoch === accountEpoch) validatorsFailed.value = true;
        debugLog('Solana staking: validators unavailable', error);
      } finally {
        // Only this read's own handle: a switch may already have started another.
        if (validatorsRead === read) validatorsRead = null;
      }
    })();
    validatorsRead = read;
    return read;
  }

  /** The Stake picker is opening: read the validator list if it is not held yet. */
  function ensureValidators(): void {
    pickerWants = true;
    if (owner.value) void readValidators(network.value);
  }

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
      const [s, i] = await Promise.allSettled([api.getStakes(address), api.getStakeInfo()]);
      // A switch to another account while reading: its own load owns the state.
      if (mine !== generation) return;
      // Stake needs the epoch info (minimum, reserve) as much as the list needs the accounts.
      failed.value = s.status === 'rejected' || i.status === 'rejected';
      if (s.status === 'fulfilled') stakes.value = s.value;
      if (i.status === 'fulfilled') info.value = i.value;
      if (s.status === 'rejected') debugLog('Solana staking: stake accounts unavailable', s.reason);
      // Delegated accounts are named by their validator: only then is the list needed now. Not
      // awaited: `loading` (the Retry spinner) is about the accounts and the epoch, already shown.
      if (stakes.value?.accounts.some((a) => a.voter)) void readValidators(net);
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
    accountEpoch++;
    validatorsRead = null;
    stakes.value = null;
    validators.value = null;
    validatorsFailed.value = false;
    info.value = null;
    void load();
    // A Stake picker left open across the switch would otherwise wait for a list nobody reads.
    if (pickerWants && owner.value) void readValidators(network.value);
  }, { immediate: true });
  // A new transaction of this account may be a stake account changing.
  watch(() => walletStore.solanaTransactions?.[0]?.signature, (now, before) => {
    if (now && before && now !== before) void load();
  });
  onBeforeUnmount(() => {
    generation++;
    clearTimeout(reloadTimer);
  });

  return { stakes, validators, info, byVote, loading, failed, validatorsFailed, load, reloadAfterAction, ensureValidators, owner };
}
