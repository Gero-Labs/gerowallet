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
import { getMidnightApi, MidnightDustRegistrationStatusDto } from '@/api/midnight-api';
import { enumerateCardanoStakeIdentities } from '@/shared/composables/useCardanoStakeEnumeration';
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
/**
 * Stakes carrying a live registration UTxO on CARDANO that points at this
 * wallet's dust address, but which the Midnight indexer hasn't relayed yet.
 *
 * This is the window the Midnight side used to be blind in. `dust/status`
 * proxies the indexer, which lags Cardano by the ~2.5h relay, so a
 * registration that is already confirmed on Cardano reads `registered:false`
 * here and contributes nothing to the sums above. The only other signal was
 * the `gero.dustPending` localStorage marker, which is written at submit time
 * — so a registration made from the Cardano wallet's own dialog, the official
 * portal, or another browser profile produced NO indication on Midnight at
 * all, and the dashboard sat on a "Register for DUST" prompt while a perfectly
 * good registration was relaying.
 */
const pathBIncomingStakes = ref<string[]>([]);

let consumers = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

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
  pathBIncomingStakes.value = [];
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

  const identities = await enumerateCardanoStakeIdentities(network);
  if (key !== committedKey) return; // superseded by a later wallet switch
  const stakes = identities.map((identity) => identity.stakeAddress);

  if (stakes.length === 0) {
    // No controlled stakes for this identity — that IS this identity's real
    // Path-B state (zero), not "unknown". Stamp the poll rather than bare-
    // returning, so extrapolation/hasData treat it as a current reading
    // instead of silently leaving behind whatever the previous identity
    // (already zeroed above) or a not-yet-run poll left in place.
    pathBIncomingStakes.value = [];
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

  // Nothing live yet for this wallet: check CONFIRMED Cardano state for a
  // registration that's still relaying, so the dashboard can say "pending"
  // instead of "register" (see `pathBIncomingStakes`). Skipped entirely once
  // anything is live, which is the steady state — so this costs nothing on a
  // wallet that's already generating.
  if (kept.length > 0) {
    pathBIncomingStakes.value = [];
    return;
  }
  const incoming = await findIncomingRegistrations(network, dustAddress, stakes);
  if (key !== committedKey) return; // superseded while the lookups resolved
  pathBIncomingStakes.value = incoming;
}

/**
 * Stakes whose live Cardano registration UTxO carries THIS wallet's dust
 * address in its datum. Compared as the same hex the wallet writes at
 * registration time (`dustAddressToHex`), not as bech32m — `dust/registrations`
 * reports the raw datum bytes.
 *
 * Best-effort throughout: a failure anywhere leaves the stake out rather than
 * inventing a pending state, so the worst case is the pre-existing behaviour.
 */
async function findIncomingRegistrations(
  network: string, dustAddress: string, stakes: string[],
): Promise<string[]> {
  let dustHex: string;
  try {
    const { dustAddressToHex } = await import('@/chains/midnight/midnightKeyManager');
    dustHex = dustAddressToHex(dustAddress).toLowerCase();
  } catch (e) {
    debugLog('🌙 could not derive dust address hex for Path-B incoming check', e);
    return [];
  }
  const api = getMidnightApi(network);
  const results = await Promise.all(stakes.map(async (stake) => {
    try {
      const registrations = await api.getDustRegistrations(stake);
      // A stake with duplicates generates nothing for anyone — it is not
      // "incoming", it needs consolidation on the Cardano side.
      if (registrations.length !== 1) return null;
      return registrations[0].dustAddressHex.toLowerCase() === dustHex ? stake : null;
    } catch (e) {
      debugLog('🌙 dust/registrations failed for', stake, e);
      return null;
    }
  }));
  return results.filter((stake): stake is string => stake !== null);
}

function start() {
  if (pollTimer) return;
  void refreshOnce();
  pollTimer = setInterval(() => { void refreshOnce(); }, POLL_MS);
}

function stop() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  // Don't zero out the sums — keep the last value visible until next start,
  // same rationale as useMidnightDustLive.
}

/**
 * Single module-scoped identity watcher — hoisted to IMPORT TIME (module top
 * level), NOT inside start(). `start()` used to create this watch() itself,
 * but `start()` is called synchronously from `useDustPathB()`, which is
 * itself called from a component's `setup()` — and Vue 2.7's `watch()` binds
 * to whatever component instance is active when it's called (it calls
 * `recordEffectScope` against the current instance's `_scope` internally).
 * That made the "module-scoped" watcher actually owned by whichever consumer
 * (dashboard gauge / mini-gauge / dialog) happened to mount first, so it died
 * with THAT component's unmount even while other consumers — and this
 * module's own `consumers` refcount — were still keeping the poll alive.
 * Once the first-mounted consumer went away, `stop()` never ran again
 * (consumers stayed > 0), so the wallet-switch watcher was silently dead for
 * the rest of the session.
 *
 * At module load time there is no active component instance/effect scope, so
 * this `watch()` call is detached from any of them and is never auto-torn-
 * down — it lives for the module's lifetime, same as `pollTimer` and
 * `committedKey` above. Guard on `consumers` so an identity change before the
 * first `start()` (or after the last `stop()`, when nobody is mounted) is a
 * no-op rather than waking up a poll loop nobody asked for.
 */
watch(
  () => `${walletStore.loggedWallet?.network ?? ''}|${midnightStore.addresses?.dust ?? ''}`,
  () => {
    if (consumers <= 0) return;
    void refreshOnce();
  },
);

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
  /** Stakes registered to this wallet on Cardano but not yet relayed to Midnight. */
  readonly pathBIncomingStakes: ComputedRef<string[]>;
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
  // registered at module load, above — see its comment.

  return {
    pathBBalance: computed(() => pathBBalance.value),
    pathBCap: computed(() => pathBCap.value),
    pathBRate: computed(() => pathBRate.value),
    pathBNight: computed(() => pathBNight.value),
    pathBRegistered: computed(() => pathBRegistered.value),
    pathBStakes: computed(() => pathBStakes.value),
    pathBIncomingStakes: computed(() => pathBIncomingStakes.value),
    pathBAsOfMs: computed(() => pathBAsOfMs.value),
  };
}
