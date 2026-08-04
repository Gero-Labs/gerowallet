/**
 * Path-B DUST generation: how much DUST is generating INTO this Midnight
 * wallet's dust address from cNIGHT held on Cardano (the mapping-validator
 * registration path), as opposed to Path A — native NIGHT UTxOs on
 * Midnight, which `useMidnightDustLive` computes from `dust/account-state`.
 *
 * Nexus's `dust/status` / `dust/status/batch` already return per-Cardano-
 * stake capacity/rate numbers (`current_capacity`, `max_capacity`,
 * `generation_rate`, `night_balance`) — no new Nexus endpoint is needed.
 * This composable enumerates every Cardano stake address the user controls
 * on the anchored Cardano network, batch-queries their status, and keeps
 * only the rows that are live-registered to THIS wallet's dust address.
 *
 * Module-scoped singleton with refcounted polling, same lifecycle shape as
 * `useMidnightDustLive`. Capacity/rate move slowly (a per-second drip, not
 * a per-block change) and the underlying Nexus scan is cached ~60s
 * server-side, so a 60s poll is plenty. `useMidnightDustLive` layers its own
 * 1s tick on top of `pathBRate`/`pathBAsOfMs` for smooth extrapolation, so
 * no tick timer is needed in here.
 */
import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { midnightStore } from '@/stores/midnightStore';
import { geroStore } from '@/stores/geroStore';
import { Blockchain, Wallet } from '@/models/types';
import { getMidnightApi, MidnightDustRegistrationStatusDto } from '@/api/midnight-api';
import { debugLog } from '@/utils/debug';

const STATUS_BATCH_LIMIT = 50;
const POLL_MS = 60_000;

// Shared module-scope state — one poll loop across all consumers.
const pathBBalance = ref<bigint>(0n);
const pathBCap = ref<bigint>(0n);
const pathBRate = ref<bigint>(0n);
const pathBNight = ref<bigint>(0n);
const pathBRegistered = ref<boolean>(false);
const pathBStakes = ref<string[]>([]);
const pathBAsOfMs = ref<number>(0);

let consumers = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let unwatchIdentity: (() => void) | null = null;

/**
 * `network|dustAddress` of the identity the module refs above currently
 * describe. The refs are a SINGLE shared instance across every consumer, so
 * when the logged wallet changes mid-flight (or the poll for the previous
 * wallet is still in flight when a new one starts), every write must be
 * checked against this — otherwise a stale response either adds a ghost
 * wallet's charge on top of the new one's, or feeds a stale `pathBStakes`
 * into a gauge's pending-reconcile and wrongly clears a real pending record
 * for the new wallet (see refreshOnce below).
 */
let committedKey: string | null = null;

function resetPathBState(): void {
  pathBBalance.value = 0n;
  pathBCap.value = 0n;
  pathBRate.value = 0n;
  pathBNight.value = 0n;
  pathBRegistered.value = false;
  pathBStakes.value = [];
  pathBAsOfMs.value = 0;
}

function toBig(v?: string): bigint {
  if (!v) return 0n;
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
}

/**
 * Same-seed twin + imported-Cardano-wallet stake addresses this Midnight
 * wallet can see, deduped. Mirrors `useDustSources.ts`'s `twinSource()`
 * (~:107-125) and `enumerate()` (~:155-178) — duplicated here rather than
 * reusing that module because this composable only needs the flat
 * stake-address list (not the full `DustSource` row with label / canSign /
 * nightBalance / status used by the cNIGHT dialog), and because rewiring
 * `useDustSources` to share code is out of this change's scope. Keep this
 * in sync with that file if its derivation logic changes.
 *
 * Public-xpub-only derivation (same as the source) — no auth gesture, no
 * mnemonic decryption required.
 */
async function collectStakeAddresses(cardanoNetwork: string): Promise<string[]> {
  const stakes = new Set<string>();

  const twinStake = midnightStore.addresses?.cardanoStakeAddress;
  if (twinStake) stakes.add(twinStake);

  const records = Object.values(geroStore.wallets ?? {}) as Array<Wallet & { publicKey?: string }>;
  const cardanoRecords = records.filter(
    (w) => w.chain === Blockchain.CARDANO && w.network === cardanoNetwork && !!w.publicKey,
  );
  if (cardanoRecords.length === 0) return [...stakes];

  const { getRewardAddress } = await import('@/chrome/serialization');
  for (const w of cardanoRecords) {
    try {
      stakes.add(getRewardAddress(w.publicKey as string, Blockchain.CARDANO, w.network).toBech32());
    } catch (e) {
      debugLog('[useDustPathB] Failed to derive stake address for wallet', w.id, e);
    }
  }
  return [...stakes];
}

async function refreshOnce() {
  const network = walletStore.loggedWallet?.network;
  const dustAddress = midnightStore.addresses?.dust;
  // Identity this call is computing for — captured once, re-checked before
  // every write below (see `committedKey` doc comment above).
  const key = `${network ?? ''}|${dustAddress ?? ''}`;
  if (key !== committedKey) {
    // The wallet identity changed since the last committed write (a wallet
    // switch, logout, or the very first call). Wipe the previous wallet's
    // sums synchronously, before any await, so they can never remain
    // visible under the new wallet — even if everything below fails or a
    // later call for a third identity supersedes this one.
    committedKey = key;
    resetPathBState();
  }
  if (!network || !dustAddress) return;

  const stakes = await collectStakeAddresses(network);
  if (key !== committedKey) return; // superseded by a later wallet switch

  if (stakes.length === 0) {
    // No controlled stakes for this identity — that IS this identity's real
    // Path-B state (zero), not "unknown". Stamp the poll rather than bare-
    // returning, so extrapolation/hasData treat it as a current reading
    // instead of silently leaving behind whatever the previous identity
    // (already zeroed above) or a not-yet-run poll left in place.
    pathBAsOfMs.value = Date.now();
    return;
  }

  const api = getMidnightApi(network);
  const rows: MidnightDustRegistrationStatusDto[] = [];
  try {
    for (let i = 0; i < stakes.length; i += STATUS_BATCH_LIMIT) {
      const chunk = stakes.slice(i, i + STATUS_BATCH_LIMIT);
      rows.push(...(await api.getDustStatusBatch(chunk)));
      if (key !== committedKey) return; // superseded mid-batch
    }
  } catch (e) {
    // Keep the last successful sums FOR THIS IDENTITY — a transient Nexus
    // failure must not zero out the cNIGHT-backed portion of the battery.
    // (A genuine identity change already reset state above, so this only
    // ever preserves same-wallet data, never a stale different wallet's.)
    debugLog('🌙 dust/status batch poll failed (Path B)', e);
    return;
  }
  if (key !== committedKey) return; // superseded while the last chunk resolved

  // Keep only rows registered to THIS wallet's dust address. `registered`
  // already folds in the duplicate-registration rule: Midnight allows at
  // most one live registration per stake credential, and `dust/status`
  // reports `registered:false` for a stake with more than one live
  // registration (the whole set is protocol-invalid) — so filtering on
  // `registered === true` is sufficient here without an extra
  // `dust/registrations` call per stake.
  const dustLower = dustAddress.toLowerCase();
  const kept = rows.filter(
    (r) => r.registered === true && (r.dustAddress ?? '').toLowerCase() === dustLower,
  );

  pathBBalance.value = kept.reduce((sum, r) => sum + toBig(r.currentCapacity), 0n);
  pathBCap.value = kept.reduce((sum, r) => sum + toBig(r.maxCapacity), 0n);
  pathBRate.value = kept.reduce((sum, r) => sum + toBig(r.generationRate), 0n);
  pathBNight.value = kept.reduce((sum, r) => sum + toBig(r.nightBalance), 0n);
  pathBRegistered.value = kept.length > 0;
  pathBStakes.value = kept.map((r) => r.cardanoRewardAddress);
  pathBAsOfMs.value = Date.now();
}

function start() {
  if (pollTimer) return;
  void refreshOnce();
  pollTimer = setInterval(() => { void refreshOnce(); }, POLL_MS);
  // Single module-scoped watcher — hoisted out of the per-consumer factory
  // below so N mounted consumers (dashboard gauge, mini-gauge, dialog — each
  // calling useDustPathB() directly or transitively via useMidnightDustLive)
  // don't each register their own watcher and all fire concurrent batch
  // POSTs to Nexus on a single wallet switch.
  unwatchIdentity = watch(
    () => `${walletStore.loggedWallet?.network ?? ''}|${midnightStore.addresses?.dust ?? ''}`,
    () => { void refreshOnce(); },
  );
}

function stop() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (unwatchIdentity) { unwatchIdentity(); unwatchIdentity = null; }
  // Don't zero out the sums — keep the last value visible until next start,
  // same rationale as useMidnightDustLive.
}

export interface DustPathB {
  /** Σ current capacity across stakes live-registered to this wallet's dust address. */
  readonly pathBBalance: ComputedRef<bigint>;
  /** Σ max capacity. */
  readonly pathBCap: ComputedRef<bigint>;
  /** Σ per-second generation rate (atomic units / sec). */
  readonly pathBRate: ComputedRef<bigint>;
  /** Σ cNIGHT balance backing generation. */
  readonly pathBNight: ComputedRef<bigint>;
  /** True when at least one stake is live-registered to this wallet's dust address. */
  readonly pathBRegistered: ComputedRef<boolean>;
  /** Stake addresses kept in the sums above (Task C's pending-reconcile needs these). */
  readonly pathBStakes: ComputedRef<string[]>;
  /** Wall-clock ms of the last successful poll (0 = never). */
  readonly pathBAsOfMs: ComputedRef<number>;
}

export function useDustPathB(): DustPathB {
  consumers += 1;
  start();
  onBeforeUnmount(() => {
    consumers -= 1;
    if (consumers <= 0) {
      consumers = 0;
      stop();
    }
  });
  // Wallet-switch restart is handled by the single module-scoped watcher
  // registered in start() — see the comment there.

  return {
    pathBBalance: computed(() => pathBBalance.value),
    pathBCap: computed(() => pathBCap.value),
    pathBRate: computed(() => pathBRate.value),
    pathBNight: computed(() => pathBNight.value),
    pathBRegistered: computed(() => pathBRegistered.value),
    pathBStakes: computed(() => pathBStakes.value),
    pathBAsOfMs: computed(() => pathBAsOfMs.value),
  };
}
