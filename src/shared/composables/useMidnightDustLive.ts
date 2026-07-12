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
 * The polling state is shared module-wide via refcount so multiple
 * components (portfolio chart + registration dialog + …) consuming this
 * composable produce ONE poll loop, not N.
 */
import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { midnightStore } from '@/stores/midnightStore';
import { getMidnightApi } from '@/api/midnight-api';
import { debugLog } from '@/utils/debug';

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

export interface MidnightDustLive {
  /** Extrapolated current DUST balance, clamped to cap. Updates every 1s. */
  readonly dustBalance: ComputedRef<bigint>;
  /** Per-second generation rate (atomic units / sec). */
  readonly dustGenerating: ComputedRef<bigint>;
  /** Asymptotic cap. */
  readonly dustCap: ComputedRef<bigint>;
  /** Sum of NIGHT registered for DUST generation. */
  readonly nightRegistered: ComputedRef<bigint>;
  /** "Registered" / "Unregistered" / ... */
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
  // Restart polling on wallet/address change so we don't keep showing the
  // previous wallet's numbers.
  watch(
    () => `${walletStore.loggedWallet?.network ?? ''}|${midnightStore.addresses?.unshielded ?? ''}`,
    () => { void refreshOnce(); },
  );

  const dustBalance = computed<bigint>(() => {
    if (polledAsOfMs.value === 0) return 0n;
    const elapsedMs = Math.max(0, nowTickMs.value - polledAsOfMs.value);
    const extra = (polledGenerating.value * BigInt(elapsedMs)) / 1000n;
    let live = polledBalance.value + extra;
    if (polledCap.value > 0n && live > polledCap.value) live = polledCap.value;
    return live;
  });

  return {
    dustBalance,
    dustGenerating: computed(() => polledGenerating.value),
    dustCap: computed(() => polledCap.value),
    nightRegistered: computed(() => polledNightRegistered.value),
    registrationStatus: computed(() => polledRegistrationStatus.value),
    hasData: computed(() => polledAsOfMs.value !== 0),
  };
}
