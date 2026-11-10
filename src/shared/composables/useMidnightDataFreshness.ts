/**
 * Reactive "Data paused" state for Midnight views (midnightDataFreshness.ts).
 *
 * The age is recomputed on a shared 15 s tick, so the state and the "12m ago"
 * label move as time passes without waiting for a new sync message.
 *
 * - {@link useMidnightDataFreshness}: a Midnight wallet's own tip
 *   (`midnightStore.tip`, refreshed by the sync service).
 * - {@link useFetchedMidnightTip}: for a Cardano wallet's cNIGHT views, which
 *   run no Midnight sync, the latest block of the Midnight network the wallet
 *   anchors to, read while a view needs it and cached for a minute.
 */
import { computed, getCurrentScope, onScopeDispose, ref, watch, type ComputedRef } from 'vue';
import { midnightStore } from '@/stores/midnightStore';
import { formatRelativeTime } from '@/shared/utils/relativeTime';
import { debugLog } from '@/utils/debug';
import { isMidnightDataPaused, type MidnightTipSnapshot } from '@/chains/midnight/midnightDataFreshness';

const TICK_MS = 15_000;
const FETCHED_TIP_TTL_MS = 60_000;

const now = ref(Date.now());
let tickUsers = 0;
let tickTimer: ReturnType<typeof setInterval> | null = null;

function retainTick(): void {
  tickUsers += 1;
  now.value = Date.now();
  if (!tickTimer) tickTimer = setInterval(() => { now.value = Date.now(); }, TICK_MS);
}

function releaseTick(): void {
  tickUsers = Math.max(0, tickUsers - 1);
  if (tickUsers === 0 && tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

/** Keep the shared tick running for as long as the calling component or scope lives. */
function useTick(): void {
  retainTick();
  if (getCurrentScope()) onScopeDispose(releaseTick);
}

export interface MidnightDataFreshness {
  /** The tip's block is more than ten minutes old. */
  readonly paused: ComputedRef<boolean>;
  /** The tip's height (0 when unknown). */
  readonly height: ComputedRef<number>;
  /** "12m ago" for the tip's block time ('' when unknown). */
  readonly ageLabel: ComputedRef<string>;
}

export function useMidnightDataFreshness(
  tip: () => MidnightTipSnapshot | null | undefined = () => midnightStore.tip,
): MidnightDataFreshness {
  useTick();
  const current = computed(tip);
  return {
    paused: computed(() => isMidnightDataPaused(current.value, now.value)),
    height: computed(() => current.value?.height ?? 0),
    ageLabel: computed(() => {
      void now.value; // re-render the label on every tick
      const at = current.value?.timestamp ?? 0;
      return at > 0 ? formatRelativeTime(at) : '';
    }),
  };
}

interface FetchedTip { tip: MidnightTipSnapshot | null; at: number }
const fetchedTips = ref(new Map<string, FetchedTip>());
const fetchesInFlight = new Set<string>();

async function refreshFetchedTip(network: string): Promise<void> {
  if (fetchesInFlight.has(network)) return;
  fetchesInFlight.add(network);
  try {
    // Lazy: the header chip uses this module on every page, and only the
    // Cardano-side cNIGHT views ever read a tip this way.
    const { getMidnightApi } = await import('@/api/midnight-api');
    const block = await getMidnightApi(network).getLatestBlock();
    const tip = typeof block?.hash === 'string' && block.hash && Number.isSafeInteger(block.height)
      ? { hash: block.hash, height: block.height, timestamp: typeof block.time === 'number' && block.time > 0 ? block.time : 0 }
      : null;
    fetchedTips.value = new Map(fetchedTips.value).set(network, { tip, at: Date.now() });
  } catch (error) {
    // No answer is not a stale answer: keep whatever was known, try again next tick.
    debugLog('Midnight tip read for the data-paused check failed', error);
    const known = fetchedTips.value.get(network);
    fetchedTips.value = new Map(fetchedTips.value).set(network, { tip: known?.tip ?? null, at: Date.now() });
  } finally {
    fetchesInFlight.delete(network);
  }
}

/**
 * The latest Midnight block for `network` (a wallet network name such as
 * `Mainnet`), read only while `enabled()` and at most once a minute across
 * every caller.
 */
export function useFetchedMidnightTip(network: () => string, enabled: () => boolean): ComputedRef<MidnightTipSnapshot | null> {
  useTick();
  watch([network, enabled, now], ([net, on]) => {
    if (!on || !net) return;
    const known = fetchedTips.value.get(net);
    if (!known || Date.now() - known.at >= FETCHED_TIP_TTL_MS) void refreshFetchedTip(net);
  }, { immediate: true });
  return computed(() => fetchedTips.value.get(network())?.tip ?? null);
}

/** Test hook: forget the shared tick and every fetched tip. */
export function resetMidnightDataFreshnessForTests(): void {
  fetchedTips.value = new Map();
  fetchesInFlight.clear();
  now.value = Date.now();
}
