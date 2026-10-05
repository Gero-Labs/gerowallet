/**
 * Path-B DUST generation: how much DUST is generating INTO this Midnight
 * wallet's dust address from cNIGHT held on Cardano (the mapping-validator
 * registration path), as opposed to Path A — native NIGHT UTxOs on
 * Midnight, which `useMidnightDustLive` computes from `dust/account-state`.
 *
 * Asks Nexus ONE question per poll — `GET dust/destination` for THIS wallet's
 * dust address — and takes the answer as it comes. The indexer's DUST figures
 * are per DUST ADDRESS, not per stake (it hands the same destination total to
 * every stake registered to the address), so the old approach of enumerating
 * stakes and summing their `dust/status` rows multiplied the figures by the
 * number of stakes. `dust/destination` returns the totals once, plus the stakes
 * behind them, and finds those stakes from the on-chain registrations rather
 * than from the stakes this extension happens to hold — so a registration made
 * from the official portal or another wallet is seen too.
 *
 * GENERATION STATUS IS NOT A SPENDABLE BALANCE. The answer says what is generating
 * NOW: the indexer only counts generation rows that are still live, so a stake whose
 * registration was removed, or whose backing cNIGHT was all moved away, drops out of the
 * figures at once. DUST generated earlier is not erased at that moment: the ledger's
 * `DustOutput::updated_value` keeps decaying it, so it stays spendable for a while. Every
 * successful answer, registered or not, stamps `pathBBatchAsOfMs`, and that stamp means
 * only "Path B has reported". Zero figures, an unregistered answer, and a registered answer
 * with an active stake and four zeros are all still unverified: nothing in this file may be
 * read as proof that no DUST is spendable (see `midnightFeeCapacity`, which warns on such a
 * zero and never blocks on it).
 *
 * FALLBACK: a Nexus that does not have the endpoint yet answers 404/501; then
 * this reads the old per-stake `dust/status` rows instead, taking the figures from
 * ONE row rather than summing (see `refreshFromStakes`). That path can only see stakes
 * the extension holds, so its "no stakes" exit has not reported and does not stamp.
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
import {
  DustDestinationUnsupportedError,
  getMidnightApi,
  type MidnightDustDestinationDto,
  type MidnightDustRegistrationStatusDto,
} from '@/api/midnight-api';
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
 * Stamped by every poll in which Path B REPORTED: any successful `dust/destination`
 * answer, registered or not, zero or not, or a successful fallback `dust/status/batch`
 * poll. It means "Path B has answered" and nothing more. `useMidnightDustLive.settled`
 * keys off it so the send notice and sponsor picker can appear for a wallet with no
 * registration at all: a token-only wallet would otherwise never settle.
 *
 * It is NOT a verified balance and must never be used to refuse an action. The figures
 * are a generation status: the indexer counts only generation rows that are live now, so
 * DUST generated earlier, still decaying and still spendable (ledger
 * `DustOutput::updated_value`), is absent from them, for example after all backing cNIGHT
 * moved away with the registration still active, or after a registration was removed.
 *
 * Not stamped by the fallback's "no enumerable stakes" exit: nothing was asked there, so
 * Path B has not reported. That exit stamps `pathBAsOfMs` so extrapolation and `hasData`
 * treat it as a current reading, which is right for display. It stays unsettled, as it was
 * before this Path-B work.
 */
const pathBBatchAsOfMs = ref<number>(0);
/**
 * True when the current figures came from `dust/destination`: destination-wide
 * totals, which ALREADY include any native NIGHT registered to this dust address.
 * Path A must not be added on top of them (see `useMidnightDustLive`).
 *
 * Why they include it: midnight-ledger v8 builds every generation record in one
 * function (`fresh_dust_output`, ledger/src/dust.rs) and emits the same
 * `DustInitialUtxo` event, with a DustPublicKey owner, for a native registration,
 * a NIGHT output to a delegated address and a cNIGHT observation; the indexer
 * stores each in `dust_generation_info` with no source filter and
 * `dustGenerations` sums that table by owner. False on the fallback path, whose
 * `dust/status` row is one generation row and carries no such guarantee.
 */
const pathBIsDestinationWide = ref<boolean>(false);
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
  pathBIsDestinationWide.value = false;
  pathBAsOfMs.value = 0;
  pathBBatchAsOfMs.value = 0;
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

  let destination: MidnightDustDestinationDto;
  try {
    destination = await getMidnightApi(network).getDustDestination(dustAddress);
  } catch (e) {
    if (key !== committedKey) return; // superseded by a later wallet switch
    if (e instanceof DustDestinationUnsupportedError) {
      await refreshFromStakes(network, dustAddress, key);
      return;
    }
    // Keep the last successful sums FOR THIS IDENTITY — a transient Nexus
    // failure must not zero out the cNIGHT-backed portion of the battery.
    // (A genuine identity change already reset state above, so this only
    // ever preserves same-wallet data, never a stale different wallet's.)
    debugLog('🌙 dust/destination poll failed (Path B)', e);
    return;
  }
  if (key !== committedKey) return; // superseded while the request was in flight

  // The destination's totals, taken as they come: they are per dust address, so
  // adding anything across stakes would multiply them. `registered` already
  // folds in the duplicate-registration rule (a stake with more than one live
  // registration is reported `duplicated`, never `active`).
  pathBBalance.value = toBig(destination.currentCapacity);
  pathBCap.value = toBig(destination.maxCapacity);
  pathBRate.value = toBig(destination.generationRate);
  pathBNight.value = toBig(destination.nightBalance);
  pathBRegistered.value = destination.registered;
  pathBStakes.value = destination.stakes
    .filter((stake) => stake.state === 'active')
    .map((stake) => stake.cardanoRewardAddress);
  // Registrations confirmed on Cardano that the indexer has not counted for this
  // address yet: the "pending" half of the gauge (see `pathBIncomingStakes`).
  pathBIncomingStakes.value = destination.stakes
    .filter((stake) => stake.state === 'relaying')
    .map((stake) => stake.cardanoRewardAddress);
  pathBIsDestinationWide.value = true;
  pathBAsOfMs.value = Date.now();
  // Path B has reported, whatever it said (see `pathBBatchAsOfMs`): registered or not, zero
  // or not. That is all this stamp means; it does not vouch that no DUST is spendable.
  pathBBatchAsOfMs.value = pathBAsOfMs.value;
}

/**
 * FALLBACK for a Nexus without `dust/destination`. Delete this function, together
 * with `findIncomingRegistrations`, `STATUS_BATCH_LIMIT` and the enumeration
 * import, once every Nexus serves the endpoint.
 *
 * Enumerates the Cardano stakes this extension holds, batch-queries their
 * `dust/status`, and keeps the rows live-registered to THIS wallet's dust address.
 * Those rows all describe the same destination, and each carries the destination
 * total, so the figures are taken from ONE of them, not summed.
 *
 * It can only see stakes the extension holds, so it is never definitive about
 * "no stakes", and its figures are not known to include native NIGHT
 * (`pathBIsDestinationWide` is false for them).
 *
 * The figures and the source flag are committed in ONE step, and only when this poll
 * actually replaces the figures. Every path that keeps the previous reading (the batch
 * fails, or there is nothing to enumerate while a reading exists) leaves the figures, the
 * flag and both timestamps as they were: a retained destination-wide total must keep
 * `pathBIsDestinationWide === true`, or `useMidnightDustLive` would add native Path A to a
 * total that already contains it.
 */
async function refreshFromStakes(network: string, dustAddress: string, key: string) {
  const identities = await enumerateCardanoStakeIdentities(network);
  if (key !== committedKey) return; // superseded by a later wallet switch
  const stakes = identities.map((identity) => identity.stakeAddress);

  if (stakes.length === 0) {
    // Nothing to ask about. A same-identity reading already exists when `pathBAsOfMs` is
    // set (the identity reset zeroes it): keep it exactly as it is, timestamp included,
    // rather than advancing the age of figures this poll did not refresh.
    if (pathBAsOfMs.value !== 0) return;
    // First reading for this identity: stamp the poll rather than bare-returning, so
    // extrapolation/hasData treat it as a current reading instead of silently leaving
    // behind whatever the previous identity (already zeroed above) or a not-yet-run
    // poll left in place. Not stamped on `pathBBatchAsOfMs`: nothing was asked, so Path B has
    // not reported.
    pathBIsDestinationWide.value = false;
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
    // Keep the last successful sums FOR THIS IDENTITY, as in `refreshOnce`.
    debugLog('🌙 dust/status batch poll failed (Path B fallback)', e);
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

  // One row, not a sum: every kept row is the same destination. The source flag moves with
  // the figures it describes, in this same synchronous block (never earlier).
  const [first] = kept;
  pathBIsDestinationWide.value = false;
  pathBBalance.value = toBig(first?.currentCapacity);
  pathBCap.value = toBig(first?.maxCapacity);
  pathBRate.value = toBig(first?.generationRate);
  pathBNight.value = toBig(first?.nightBalance);
  pathBRegistered.value = kept.length > 0;
  pathBStakes.value = kept.map((r) => r.cardanoRewardAddress);
  pathBAsOfMs.value = Date.now();
  pathBBatchAsOfMs.value = pathBAsOfMs.value;

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
  /**
   * Current capacity of this wallet's dust address, counted ONCE (the destination total,
   * not a sum over the stakes registered to it).
   */
  readonly pathBBalance: ComputedRef<bigint>;
  /** Max capacity of the destination, counted once. */
  readonly pathBCap: ComputedRef<bigint>;
  /** Per-second generation rate of the destination, counted once (atomic units / sec). */
  readonly pathBRate: ComputedRef<bigint>;
  /** NIGHT balance backing generation at the destination, counted once. */
  readonly pathBNight: ComputedRef<bigint>;
  /** True when at least one stake is live-registered to this wallet's dust address. */
  readonly pathBRegistered: ComputedRef<boolean>;
  /**
   * True when the figures above are destination-wide totals: they already include any native
   * NIGHT registered to this dust address, so Path A must not be added. False on the fallback
   * path. See the ref's doc.
   */
  readonly pathBIsDestinationWide: ComputedRef<boolean>;
  /** The stakes whose registration the indexer counts for this address (Task C's pending-reconcile needs these). */
  readonly pathBStakes: ComputedRef<string[]>;
  /** Stakes registered to this wallet on Cardano but not yet relayed to Midnight. */
  readonly pathBIncomingStakes: ComputedRef<string[]>;
  /** Wall-clock ms of the last successful poll (0 = never). */
  readonly pathBAsOfMs: ComputedRef<number>;
  /**
   * Wall-clock ms of the last poll in which Path B REPORTED (any successful destination answer, or
   * a fallback batch poll); 0 until one has. Not a verified balance: see the ref's doc.
   */
  readonly pathBBatchAsOfMs: ComputedRef<number>;
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
    pathBIsDestinationWide: computed(() => pathBIsDestinationWide.value),
    pathBStakes: computed(() => pathBStakes.value),
    pathBIncomingStakes: computed(() => pathBIncomingStakes.value),
    pathBAsOfMs: computed(() => pathBAsOfMs.value),
    pathBBatchAsOfMs: computed(() => pathBBatchAsOfMs.value),
  };
}
