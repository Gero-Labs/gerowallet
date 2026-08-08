/**
 * Live-ticking DUST balance for any Midnight view.
 *
 * Why this exists:
 * gero-sync ships a one-shot `AccountInfo` snapshot when a wallet session
 * subscribes — fine for the initial paint, but the on-chain DUST balance
 * grows every second so the snapshot goes stale immediately. We poll the
 * Nexus public dust account-state endpoint every 5s for an authoritative
 * value and use the per-second `dust_generating` rate to extrapolate
 * smoothly between polls via a 1s nowTick.
 *
 * DUST reaches a wallet two ways: Path A is
 * native NIGHT UTxOs on Midnight — everything this file computed before the
 * Path-B work landed. Path B is cNIGHT held on Cardano, paired to this
 * wallet's dust address through the mapping validator; `useDustPathB` sums
 * that side from Nexus's `dust/status` batch endpoint. Every value this
 * composable exports below is Path A + Path B summed, so consumers don't
 * need to know which path a given unit of DUST came from.
 *
 * The polling state is shared module-wide via refcount so multiple
 * components (portfolio chart + registration dialog + …) consuming this
 * composable produce ONE poll loop, not N.
 */
import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { midnightStore } from '@/stores/midnightStore';
import { getMidnightApi } from '@/api/midnight-api';
import { debugLog } from '@/utils/debug';
import { useDustPathB } from '@/shared/composables/useDustPathB';

// Shared module-scope state — one source of truth across all consumers.
const polledBalance = ref<bigint>(0n);
const polledGenerating = ref<bigint>(0n);
const polledCap = ref<bigint>(0n);
const polledNightRegistered = ref<bigint>(0n);
const polledRegistrationStatus = ref<string>('Unregistered');
const polledAsOfMs = ref<number>(0);
const nowTickMs = ref<number>(Date.now());

let consumers = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;

async function refreshOnce() {
  // Read network + address fresh each tick — the active wallet can change.
  const network = walletStore.loggedWallet?.network;
  const address = midnightStore.addresses?.unshielded;
  if (!network || !address) return;
  try {
    const api = getMidnightApi(network);
    const res = await api.getDustAccountState(address);
    polledBalance.value = BigInt(res.dust_balance ?? '0');
    polledGenerating.value = BigInt(res.dust_generating ?? '0');
    polledCap.value = BigInt(res.dust_cap ?? '0');
    polledNightRegistered.value = BigInt(res.night_registered ?? '0');
    polledRegistrationStatus.value = res.dust_registration_status ?? 'Unregistered';
    polledAsOfMs.value = Date.now();
  } catch (e) {
    // Keep last successful values; extrapolation continues until next success.
    // Log it — a silently-failing poll once masqueraded as "wallet stopped
    // generating DUST" (it was an auth-base 404 loop).
    debugLog('🌙 dust account-state poll failed', e);
  }
}

function start() {
  if (pollTimer) return;
  void refreshOnce();
  pollTimer = setInterval(refreshOnce, 5_000);
  tickTimer = setInterval(() => { nowTickMs.value = Date.now(); }, 1_000);
}

function stop() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  // Don't zero out polledBalance — keep the last value visible until next start
  // so navigation back to a dust view shows the previous reading instantly.
}

/**
 * Single module-scoped identity watcher — hoisted to IMPORT TIME (module top
 * level), NOT inside start(). See `useDustPathB.ts` for the full rationale
 * (same trap, same fix): `start()` used to create this watch() itself, but
 * `start()` runs synchronously inside `useMidnightDustLive()`, which is
 * itself called from a component's `setup()` — and Vue 2.7's `watch()` binds
 * to whichever component instance is active when it's called. A watcher
 * created there was therefore silently owned by whichever consumer (portfolio
 * chart / registration dialog / gauges) mounted first and died with THAT
 * component's unmount, even while other consumers kept `consumers`/`pollTimer`
 * alive — so `stop()` never ran again and the wallet-switch watcher went dead
 * for the rest of the session.
 *
 * At module load time there is no active component instance, so this
 * watch() call is detached and never auto-torn-down — it lives for the
 * module's lifetime. Guard on `consumers` so an identity change before the
 * first `start()` (or after the last `stop()`) is a no-op.
 */
watch(
  () => `${walletStore.loggedWallet?.network ?? ''}|${midnightStore.addresses?.unshielded ?? ''}`,
  () => {
    if (consumers <= 0) return;
    void refreshOnce();
  },
);

/**
 * Whether the last Path-A poll actually carries usable signal.
 *
 * Root cause fixed here: a poll that *succeeds* but returns the hollow
 * `{0,0,0,'Unregistered'}` shape (normal for a cNIGHT-only / Path-B wallet,
 * since the sidecar has indexed no NIGHT UTxOs for its Midnight address)
 * used to permanently outrank a real, non-zero value already sitting in
 * `midnightStore.dustState` from an earlier gero-sync snapshot — the old
 * `polled()` helper meant only "has a poll ever completed", not "does the
 * poll actually say anything". Require the poll to show actual
 * balance/cap/rate/registered-NIGHT, or an explicit 'Registered' status,
 * before trusting it over the store snapshot; otherwise fall back to the
 * store exactly like the "no poll yet" path always did.
 */
function pathAPollHasSignal(): boolean {
  return polledAsOfMs.value !== 0 && (
    polledBalance.value > 0n
    || polledGenerating.value > 0n
    || polledCap.value > 0n
    || polledNightRegistered.value > 0n
    || polledRegistrationStatus.value === 'Registered'
  );
}

export interface MidnightDustLive {
  /** Extrapolated current DUST balance, Path A + Path B, each clamped to its own cap. Updates every 1s. */
  readonly dustBalance: ComputedRef<bigint>;
  /** Per-second generation rate, Path A + Path B (atomic units / sec). */
  readonly dustGenerating: ComputedRef<bigint>;
  /** Asymptotic cap, Path A + Path B. */
  readonly dustCap: ComputedRef<bigint>;
  /** Sum of NIGHT registered for DUST generation, Path A + Path B. */
  readonly nightRegistered: ComputedRef<bigint>;
  /** "Registered" / "Unregistered" / ... — 'Registered' when either path is. */
  readonly registrationStatus: ComputedRef<string>;
  /** True if at least one poll has succeeded — UI can show a skeleton until then. */
  readonly hasData: ComputedRef<boolean>;
}

export function useMidnightDustLive(): MidnightDustLive {
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

  const {
    pathBBalance, pathBCap, pathBRate, pathBNight, pathBRegistered, pathBAsOfMs,
  } = useDustPathB();

  const pathABalance = computed<bigint>(() => {
    // No successful poll yet, or the poll was hollow (see pathAPollHasSignal)
    // — fall back to the gero-sync snapshot the registration dialog already
    // trusts, so the gauge never reads 0 while the wallet is actually
    // generating (the Nexus dust poll can silently 404 on auth-token
    // expiry — see catch above).
    if (!pathAPollHasSignal()) return midnightStore.dustState?.current ?? 0n;
    const elapsedMs = Math.max(0, nowTickMs.value - polledAsOfMs.value);
    const extra = (polledGenerating.value * BigInt(elapsedMs)) / 1000n;
    let live = polledBalance.value + extra;
    if (polledCap.value > 0n && live > polledCap.value) live = polledCap.value;
    return live;
  });

  // Path B has no 1s poll of its own — extrapolate its capacity by its own
  // rate over elapsed time since the last Path-B poll, same shape as Path A.
  const pathBBalanceExtrapolated = computed<bigint>(() => {
    const asOf = pathBAsOfMs.value;
    const elapsedMs = asOf > 0 ? Math.max(0, nowTickMs.value - asOf) : 0;
    const extra = (pathBRate.value * BigInt(elapsedMs)) / 1000n;
    let live = pathBBalance.value + extra;
    if (pathBCap.value > 0n && live > pathBCap.value) live = pathBCap.value;
    return live;
  });

  const dustBalance = computed<bigint>(() => pathABalance.value + pathBBalanceExtrapolated.value);

  return {
    dustBalance,
    dustGenerating: computed(() => {
      const a = pathAPollHasSignal() ? polledGenerating.value : (midnightStore.balances?.dustGenerating ?? 0n);
      return a + pathBRate.value;
    }),
    dustCap: computed(() => {
      const a = pathAPollHasSignal() ? polledCap.value : (midnightStore.dustState?.cap ?? 0n);
      return a + pathBCap.value;
    }),
    nightRegistered: computed(() => {
      const a = pathAPollHasSignal() ? polledNightRegistered.value : (midnightStore.balances?.nightRegistered ?? 0n);
      return a + pathBNight.value;
    }),
    registrationStatus: computed(() => {
      const a = pathAPollHasSignal()
        ? polledRegistrationStatus.value
        : (midnightStore.dustState?.registrationStatus ?? 'Unregistered');
      return (a === 'Registered' || pathBRegistered.value) ? 'Registered' : a;
    }),
    // Path B has its own independent poll — a pure-Path-B wallet whose
    // Path-A poll keeps 404ing (or never had a store snapshot) still needs
    // `hasData` to flip true once Path B has a reading, otherwise consumers
    // like DustRegistrationDialog fall back to stale/empty store values
    // forever even though the battery itself is showing real Path-B charge.
    hasData: computed(() => polledAsOfMs.value !== 0 || midnightStore.dustState != null || pathBAsOfMs.value !== 0),
  };
}
