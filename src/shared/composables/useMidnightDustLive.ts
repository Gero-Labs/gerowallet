/**
 * Live-ticking DUST balance for any Midnight view.
 *
 * Why this exists:
 * gero-sync ships a one-shot `AccountInfo` snapshot when a wallet session
 * subscribes — fine for the initial paint, but the on-chain DUST balance
 * grows every second so the snapshot goes stale immediately. We poll the
 * Nexus public dust account-state endpoint for an authoritative value and
 * use the per-second `dust_generating` rate to extrapolate smoothly between
 * polls via a 1s nowTick.
 *
 * Poll pace (see "Poll pace" below): every 5s after a reading brings news,
 * the view is shown again or the user acts, slowing to every 60s while the
 * readings only confirm the extrapolation; no polls at all while the view is
 * hidden; and one poller per wallet and network across the extension's open
 * views, which share their readings.
 *
 * DUST reaches a wallet two ways: Path A is
 * native NIGHT UTxOs on Midnight — everything this file computed before the
 * Path-B work landed. Path B is cNIGHT held on Cardano, paired to this
 * wallet's dust address through the mapping validator; `useDustPathB` reads
 * that side from Nexus's `dust/destination` endpoint. The values this
 * composable exports below combine the two, so consumers don't need to know
 * which path a given unit of DUST came from.
 *
 * COMBINING THEM IS NOT ALWAYS A SUM. Path B's figures are the DESTINATION
 * totals for this wallet's dust address, and the destination total already
 * contains any native NIGHT registered to that same address: midnight-ledger
 * v8 emits the same `DustInitialUtxo` event, with the same DustPublicKey
 * owner, for a native registration, a NIGHT output to a delegated address and
 * a cNIGHT observation, and the indexer sums `dust_generation_info` by owner
 * with no source filter (verified in the ledger and indexer source; see
 * Gero-Labs/nexus PR 1169). Adding Path A on top would count that NIGHT twice.
 * So once Path B reports a registration AND its figures are destination-wide
 * (`pathBIsDestinationWide`), Path B alone supplies the battery. In every
 * other case (Path B not registered, or the fallback whose `dust/status` row
 * is one generation row and carries no such guarantee) Path A is added, as
 * before. Known gap: Path A does not check which dust address its native
 * registration points at, so native NIGHT registered to a DIFFERENT dust
 * address than this wallet's is dropped while Path B is registered.
 *
 * The polling state is shared module-wide via refcount so multiple
 * components (portfolio chart + registration dialog + …) consuming this
 * composable produce ONE poll loop, not N.
 */
import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { midnightStore } from '@/stores/midnightStore';
import { getMidnightApi, type MidnightApi } from '@/api/midnight-api';
import { debugLog } from '@/utils/debug';
import { useDustPathB } from '@/shared/composables/useDustPathB';
import { dustPendingRevision } from '@/shared/composables/useDustPending';
import { dustAccountStateHasSignal } from '@/chains/midnight/midnightDustBalance';
import { isMidnightDataPaused, midnightTipAgeMs, MIDNIGHT_DATA_PAUSED_AFTER_MS } from '@/chains/midnight/midnightDataFreshness';
import { knownMidnightLedger } from '@/chains/midnight/midnightLedger';
import { Network } from '@/models/types';

// Shared module-scope state — one source of truth across all consumers.
const polledBalance = ref<bigint>(0n);
const polledGenerating = ref<bigint>(0n);
const polledCap = ref<bigint>(0n);
const polledNightRegistered = ref<bigint>(0n);
const polledRegistrationStatus = ref<string>('Unregistered');
const polledAsOfMs = ref<number>(0);
const nativeRegistrationConfirmedAt = ref(0);
const nowTickMs = ref<number>(Date.now());
// A preprod registration can disappear at the ledger 9 upgrade. Two explicit
// empty REST responses while sync advances are a fallback until REST exposes its block.
// They can retire a stale status, never its spendable balance.
let previousEmptyTip: { height: number; hash: string | null } | null = null;
const nativeClearObservedAt = ref(0);

type DustAccountState = Awaited<ReturnType<MidnightApi['getDustAccountState']>>;

/**
 * Poll pace.
 *
 * The old loop asked every 5s in every open view, hidden or not, for as long as the view
 * stayed open. Now:
 * - A reading that brings news, the view being shown again, and the user acting (a click
 *   or key press in the view, or the wallet starting or finishing a send, a new
 *   transaction, a registration) all put the poll back on the 5s pace. Being shown again
 *   and acting also fetch at once, unless a fetch started less than 5s ago.
 * - Each reading that only confirms the extrapolation (`readingBringsNews`), and each
 *   failed poll, doubles the gap up to 60s: after news the polls are 5, 5, 10, 20 and
 *   40s apart, then every 60s.
 * - A hidden view (`document.visibilityState`, which also covers a popup or side panel
 *   being closed) does not poll at all. A view that is visible but not focused keeps
 *   polling, because its gauge is still on screen.
 * - Views of the same wallet and network share one poller: a reading fetched by one view
 *   goes to the others (BroadcastChannel, which only the extension's own pages can join)
 *   and pushes back their next poll, and a Web Lock keeps two views from fetching the
 *   same reading at once. Without those APIs each view polls on its own, as before.
 */
export const DUST_POLL_FAST_MS = 5_000;
export const DUST_POLL_SLOW_MS = 60_000;
/**
 * How far a balance may sit from the previous reading's extrapolation and still count as
 * nothing new, in seconds of generation: the server computes the balance when it answers,
 * so request latency separates the two clocks. It only decides when the next poll runs;
 * the reading itself is always applied.
 */
const BALANCE_SLACK_SECONDS = 15n;
const SHARED_CHANNEL = 'gero-dust-account-state';

let consumers = 0;
let running = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollDueAt = 0;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let inFlight: object | null = null;
let unavailableIdentity: string | null = null;
/** Consecutive polls that brought nothing new (or failed); sets the next delay. */
let quietPolls = 0;
/** When the last fetch for the current identity started, in this view or another. */
let lastAttemptAt = 0;
let channel: BroadcastChannel | null = null;

interface DustReading {
  identity: string;
  asOf: number;
  balance: bigint;
  generating: bigint;
  cap: bigint;
  night: bigint;
  status: string;
  generation: string;
}
let lastReading: DustReading | null = null;

/** A reading one view fetched, as sent to the extension's other views. */
interface SharedReading {
  identity: string;
  startedAt: number;
  asOf: number;
  state: DustAccountState;
}

function pollIdentity(): string {
  return `${walletStore.loggedWallet?.network ?? ''}|${midnightStore.addresses?.unshielded ?? ''}`;
}

// Sync may replace the old native registration before the dialog opens. Remember the transition
// for this wallet so an ordinary, always-unregistered wallet never gets an upgrade notice.
let sawNativeRegistration = false;
const syncClearedRegistration = ref(false);
watch([pollIdentity, () => midnightStore.dustState?.registrationStatus, () => midnightStore.balances?.nightRegistered],
  ([identity, status, night], [previousIdentity]) => {
    if (identity !== previousIdentity) {
      sawNativeRegistration = false;
      syncClearedRegistration.value = false;
      return;
    }
    if (walletStore.loggedWallet?.network !== Network.PREPROD) return;
    if (status === 'Registered' && (night ?? 0n) > 0n) {
      sawNativeRegistration = true;
      syncClearedRegistration.value = false;
    } else if (status === 'Unregistered' && sawNativeRegistration) {
      syncClearedRegistration.value = true;
      sawNativeRegistration = false;
    }
  }, { flush: 'sync' });

function isUnavailable(error: unknown): boolean {
  // MidnightApi preserves HTTP errors as JSON strings via parseHttpError.
  try {
    const parsed = typeof error === 'string' ? JSON.parse(error) : error;
    return parsed?.status === 501 || parsed?.response?.status === 501;
  } catch { return false; }
}

/**
 * Whether `next` tells the view anything the previous reading's extrapolation did not.
 * Rate, cap, registered NIGHT and both statuses must match exactly, and the balance must be
 * within `BALANCE_SLACK_SECONDS` of generation of where the previous reading said it would
 * be. A first reading, a spend, a registration change or NIGHT moving is news.
 */
function readingBringsNews(previous: DustReading | null, next: DustReading): boolean {
  if (!previous || previous.identity !== next.identity) return true;
  if (next.generating !== previous.generating || next.cap !== previous.cap || next.night !== previous.night
    || next.status !== previous.status || next.generation !== previous.generation) return true;
  const elapsedMs = BigInt(Math.max(0, next.asOf - previous.asOf));
  let expected = previous.balance + (previous.generating * elapsedMs) / 1000n;
  if (previous.cap > 0n && expected > previous.cap) expected = previous.cap;
  const slack = previous.generating > 0n ? previous.generating * BALANCE_SLACK_SECONDS : 0n;
  const drift = next.balance > expected ? next.balance - expected : expected - next.balance;
  return drift > slack;
}

/** Apply a reading this view fetched or another view shared. Throws on a malformed one. */
function applyReading(identity: string, res: DustAccountState, startedAt: number, asOf: number): void {
  const network = walletStore.loggedWallet?.network;
  const reading: DustReading = {
    identity,
    asOf,
    balance: BigInt(res.dust_balance ?? '0'),
    generating: BigInt(res.dust_generating ?? '0'),
    cap: BigInt(res.dust_cap ?? '0'),
    night: BigInt(res.night_registered ?? '0'),
    status: res.dust_registration_status ?? 'Unregistered',
    generation: res.dust_generation_status ?? '',
  };
  quietPolls = readingBringsNews(lastReading, reading) ? 0 : quietPolls + 1;
  lastReading = reading;
  polledBalance.value = reading.balance;
  polledGenerating.value = reading.generating;
  polledCap.value = reading.cap;
  polledNightRegistered.value = reading.night;
  polledRegistrationStatus.value = reading.status;
  polledAsOfMs.value = asOf;
  nativeRegistrationConfirmedAt.value = res.dust_registration_status === 'Registered' ? startedAt : 0;
  const now = asOf;
  const tip = midnightStore.tip;
  const age = midnightTipAgeMs(tip, now);
  const explicitEmpty = res.dust_registration_status === 'Unregistered' && res.dust_generation_status === 'empty'
    && [res.dust_balance, res.dust_generating, res.dust_cap, res.night_registered].every(value => value === '0');
  const eligible = network === Network.PREPROD && knownMidnightLedger(network) === 9
    && midnightStore.dustState?.registrationStatus === 'Registered' && (midnightStore.balances?.nightRegistered ?? 0n) > 0n
    && !midnightStore.refreshing && midnightStore.networkStatus === 'connected'
    && age !== null && age <= MIDNIGHT_DATA_PAUSED_AFTER_MS && tip.height > 0;
  if (eligible && explicitEmpty) {
    if (previousEmptyTip && (tip.height < previousEmptyTip.height || (tip.height === previousEmptyTip.height && tip.hash !== previousEmptyTip.hash))) {
      nativeClearObservedAt.value = 0;
    } else if (previousEmptyTip && tip.height > previousEmptyTip.height && !nativeClearObservedAt.value) {
      nativeClearObservedAt.value = now;
    }
    previousEmptyTip = { height: tip.height, hash: tip.hash };
  } else {
    previousEmptyTip = null;
    if (!explicitEmpty || midnightStore.refreshing) nativeClearObservedAt.value = 0;
  }
}

/**
 * Fetch unless another of the extension's views is fetching the same reading right now
 * (null then: its reading will arrive on the channel).
 */
async function fetchUnlessElsewhere(identity: string, fetch: () => Promise<DustAccountState>): Promise<DustAccountState | null> {
  const locks = channel && typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return fetch();
  return locks.request(`${SHARED_CHANNEL}|${identity}`, { ifAvailable: true }, lock => (lock ? fetch() : null));
}

/** 'ended': nothing to schedule (superseded, paused, no wallet, or a poll already running). */
type PollOutcome = 'applied' | 'failed' | 'elsewhere' | 'ended';

async function refreshOnce(): Promise<PollOutcome> {
  // Read network + address fresh each tick — the active wallet can change.
  const network = walletStore.loggedWallet?.network;
  const address = midnightStore.addresses?.unshielded;
  const identity = pollIdentity();
  if (!network || !address || inFlight || unavailableIdentity === identity) return 'ended';
  const request = {};
  const startedAt = Date.now();
  inFlight = request;
  lastAttemptAt = startedAt;
  try {
    const api = getMidnightApi(network);
    const res = await fetchUnlessElsewhere(identity, () => api.getDustAccountState(address));
    if (inFlight !== request || identity !== pollIdentity()) return 'ended';
    if (!res) return 'elsewhere';
    const asOf = Date.now();
    applyReading(identity, res, startedAt, asOf);
    const shared: SharedReading = { identity, startedAt, asOf, state: res };
    try { channel?.postMessage(shared); } catch { /* the other views poll on their own */ }
    return 'applied';
  } catch (e) {
    if (inFlight !== request || identity !== pollIdentity()) return 'ended';
    previousEmptyTip = null;
    if (isUnavailable(e)) {
      unavailableIdentity = identity;
      forgetPolledIdentity();
      debugLog('🌙 DUST account-state unavailable; polling paused until the wallet or view changes', network);
      return 'ended';
    }
    // Keep last successful values; extrapolation continues until next success.
    // Log it — a silently-failing poll once masqueraded as "wallet stopped
    // generating DUST" (it was an auth-base 404 loop).
    debugLog('🌙 dust account-state poll failed', e);
    return 'failed';
  } finally {
    if (inFlight === request) inFlight = null;
  }
}

function viewVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/** 5s after news, then 5, 10, 20, 40 and 60s while the readings say nothing new. */
function nextDelay(): number {
  return Math.min(DUST_POLL_FAST_MS * 2 ** Math.max(0, quietPolls - 1), DUST_POLL_SLOW_MS);
}

function clearPollTimer(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

/** The next poll in `delay` ms, replacing one already due. Never while hidden. */
function reschedule(delay: number): void {
  clearPollTimer();
  if (!running || !viewVisible()) return;
  pollDueAt = Date.now() + delay;
  pollTimer = setTimeout(() => { pollTimer = null; void poll(); }, delay);
}

/** A poll within `delay` ms, keeping one already due sooner (so steady input never starves it). */
function pollWithin(delay: number): void {
  if (pollTimer && pollDueAt <= Date.now() + delay) return;
  reschedule(delay);
}

async function poll(): Promise<void> {
  clearPollTimer();
  const outcome = await refreshOnce();
  if (outcome === 'ended') return;
  if (outcome === 'failed') quietPolls += 1;
  reschedule(nextDelay());
}

/**
 * The view was shown again or the user acted: back to the 5s pace, and fetch now unless a
 * fetch (here or in another view) started less than 5s ago.
 */
function nudge(): void {
  if (!running || !viewVisible()) return;
  quietPolls = 0;
  if (inFlight) return;
  const since = Date.now() - lastAttemptAt;
  if (since >= DUST_POLL_FAST_MS) void poll();
  else pollWithin(DUST_POLL_FAST_MS - since);
}

function onVisibilityChange(): void {
  if (viewVisible()) nudge();
  else clearPollTimer();
}

function onSharedReading(event: MessageEvent<SharedReading>): void {
  const shared = event.data;
  if (!running || !shared || shared.identity !== pollIdentity() || !(shared.asOf > polledAsOfMs.value)) return;
  try {
    applyReading(shared.identity, shared.state, shared.startedAt, shared.asOf);
  } catch {
    return;
  }
  lastAttemptAt = Math.max(lastAttemptAt, shared.startedAt);
  // The endpoint answered for this wallet again, so a pause after a 501 is over.
  unavailableIdentity = null;
  if (!inFlight) reschedule(nextDelay());
}

function listenToView(): void {
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('pointerdown', nudge, { capture: true, passive: true });
    document.addEventListener('keydown', nudge, { capture: true, passive: true });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', nudge);
    window.addEventListener('pagehide', clearPollTimer);
  }
  if (typeof BroadcastChannel !== 'undefined' && typeof navigator !== 'undefined' && navigator.locks) {
    try {
      channel = new BroadcastChannel(SHARED_CHANNEL);
      channel.onmessage = onSharedReading;
    } catch {
      channel = null;
    }
  }
}

function stopListening(): void {
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('pointerdown', nudge, { capture: true });
    document.removeEventListener('keydown', nudge, { capture: true });
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('focus', nudge);
    window.removeEventListener('pagehide', clearPollTimer);
  }
  channel?.close();
  channel = null;
}

function start() {
  if (running) return;
  running = true;
  unavailableIdentity = null;
  quietPolls = 0;
  listenToView();
  tickTimer = setInterval(() => { nowTickMs.value = Date.now(); }, 1_000);
  if (viewVisible()) void poll();
}

function stop() {
  running = false;
  previousEmptyTip = null;
  inFlight = null;
  unavailableIdentity = null;
  clearPollTimer();
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  stopListening();
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
/**
 * Forget the previous identity's reading.
 *
 * These refs are module-scoped so one poll loop serves every consumer, and
 * `refreshOnce` deliberately keeps the last successful values when a poll
 * fails. Together that means a wallet switch used to leave the PREVIOUS
 * wallet's DUST on screen until a new poll both ran and succeeded — and if the
 * new wallet's poll returned the hollow all-zero shape, `pathAPollHasSignal()`
 * rejected it and the stale figure simply stayed.
 *
 * Observed on mainnet: a wallet holding no DUST at all displayed a full
 * 500 DUST battery inherited from the previously-viewed wallet, which sent an
 * entire debugging session after the wrong wallet. Zeroing `polledAsOfMs`
 * returns the composable to its honest "no reading yet" state, which falls
 * back to `midnightStore.dustState` — and that IS reset per wallet by
 * `setActive`.
 */
function forgetPolledIdentity(): void {
  previousEmptyTip = null;
  nativeClearObservedAt.value = 0;
  polledBalance.value = 0n;
  polledGenerating.value = 0n;
  polledCap.value = 0n;
  polledNightRegistered.value = 0n;
  polledRegistrationStatus.value = 'Unregistered';
  polledAsOfMs.value = 0;
  nativeRegistrationConfirmedAt.value = 0;
  lastReading = null;
  quietPolls = 0;
  lastAttemptAt = 0;
}

watch(
  pollIdentity,
  () => {
    inFlight = null;
    unavailableIdentity = null;
    // Clear FIRST, synchronously: the gap between the switch and the next
    // successful poll is exactly where the stale value used to be shown.
    forgetPolledIdentity();
    if (consumers <= 0) return;
    nudge();
  },
  { flush: 'sync' },
);

/**
 * The wallet doing something counts as the user acting (see "Poll pace"): a send starting
 * or finishing, a new transaction reaching sync, a registration being submitted, NIGHT
 * moving or the registration status changing. Module-scoped for the same reason as the
 * identity watcher above.
 */
watch(
  () => [
    midnightStore.lastMidnightTxId ?? '',
    midnightStore.sendProgress == null,
    midnightStore.dustState?.registrationStatus ?? '',
    String(midnightStore.balances?.nightRegistered ?? ''),
    String(midnightStore.balances?.nightUnshielded ?? ''),
    dustPendingRevision.value,
  ].join('|'),
  () => nudge(),
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
  return polledAsOfMs.value !== 0 && dustAccountStateHasSignal({
    balance: polledBalance.value,
    generating: polledGenerating.value,
    cap: polledCap.value,
    nightRegistered: polledNightRegistered.value,
    registrationStatus: polledRegistrationStatus.value,
  });
}

export interface MidnightDustLive {
  /**
   * Extrapolated current DUST balance, each path clamped to its own cap. Updates every 1s.
   * Path A is dropped while Path B reports a destination-wide registration (see the file header).
   */
  readonly dustBalance: ComputedRef<bigint>;
  /** Per-second generation rate (atomic units / sec), combined the same way. */
  readonly dustGenerating: ComputedRef<bigint>;
  /** Asymptotic cap, combined the same way. */
  readonly dustCap: ComputedRef<bigint>;
  /** NIGHT registered for DUST generation, combined the same way. */
  readonly nightRegistered: ComputedRef<bigint>;
  /** "Registered" / "Unregistered" / ... — 'Registered' when either path is. */
  readonly registrationStatus: ComputedRef<string>;
  /** A former native preprod registration also reads absent from the DUST destination. */
  readonly nativeRegistrationCleared: ComputedRef<boolean>;
  /** Recovery may override only a cached native preprod registration with no cNIGHT source. */
  readonly canRecoverNativeRegistration: ComputedRef<boolean>;
  /** Time of the last positive native registration reading, excluding cached and cNIGHT status. */
  readonly nativeRegistrationConfirmedAt: ComputedRef<number>;
  /** True if at least one poll has succeeded — UI can show a skeleton until then. */
  readonly hasData: ComputedRef<boolean>;
  /**
   * True once BOTH paths have REPORTED. `hasData` is an OR and flips as soon as Path A's
   * store has any value, including the zero-filled one, while Path B is still in flight.
   * Anything that acts on a zero balance must wait for this instead, or a Path-B wallet
   * reads as empty for the length of one poll.
   *
   * Path B has reported once ANY `dust/destination` answer has landed, registered or not
   * (or a fallback batch poll has succeeded), so that a token-only wallet with no
   * registration settles too. Reported is not verified: Path B's figures are a generation
   * status, not a spendable balance. The indexer counts only generation rows that are live
   * now, and DUST generated earlier keeps decaying and stays spendable (ledger
   * `DustOutput::updated_value`) after all backing cNIGHT moved away or a registration was
   * removed. A zero balance on a settled reading therefore never proves there is nothing
   * to spend; `midnightFeeCapacityLive` treats it as `unverified` and only warns.
   *
   * The fallback's "no enumerable stakes" exit asks nothing, so it does not settle.
   */
  readonly settled: ComputedRef<boolean>;
  /**
   * Midnight data is paused (the tip's block is more than ten minutes old, see
   * midnightDataFreshness.ts). The balance is then the last reading, not ticked
   * forward, and views label it as an estimate.
   */
  readonly estimate: ComputedRef<boolean>;
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
    pathBBalance, pathBCap, pathBRate, pathBNight, pathBRegistered, pathBIsDestinationWide, pathBIncomingStakes,
    pathBAsOfMs, pathBBatchAsOfMs,
  } = useDustPathB();

  // Path A is dropped, not added, when Path B already contains it (see the file header).
  // `pathBRegistered` is read first so the flag is only consulted once Path B has reported
  // a registration. Same rule as `pathBSupersedesPathA`, which the background's one-off
  // read uses (`midnightDustBalance.ts`).
  const pathBSupersedesA = computed(() => pathBRegistered.value && pathBIsDestinationWide.value);
  const noCnightSource = computed(() => pathBIsDestinationWide.value && pathBBatchAsOfMs.value > 0
    && !pathBRegistered.value && pathBIncomingStakes.value.length === 0);
  const nativeRegistrationCleared = computed(() => walletStore.loggedWallet?.network === Network.PREPROD
    && noCnightSource.value && !midnightStore.refreshing && knownMidnightLedger(walletStore.loggedWallet?.network ?? '') === 9
    && ((syncClearedRegistration.value && midnightStore.dustState?.registrationStatus === 'Unregistered')
      || (nativeClearObservedAt.value > 0 && midnightStore.dustState?.registrationStatus === 'Registered'
        && pathBBatchAsOfMs.value >= nativeClearObservedAt.value)));

  // While Midnight data is paused, extrapolating from the local clock would
  // show a battery rising on data that is not moving: hold the last reading.
  const dataPaused = computed(() => isMidnightDataPaused(midnightStore.tip, nowTickMs.value));

  const pathABalance = computed<bigint>(() => {
    // No successful poll yet, or the poll was hollow (see pathAPollHasSignal)
    // — fall back to the gero-sync snapshot the registration dialog already
    // trusts, so the gauge never reads 0 while the wallet is actually
    // generating (the Nexus dust poll can silently 404 on auth-token
    // expiry — see catch above).
    if (!pathAPollHasSignal()) return midnightStore.dustState?.current ?? 0n;
    const elapsedMs = dataPaused.value ? 0 : Math.max(0, nowTickMs.value - polledAsOfMs.value);
    const extra = (polledGenerating.value * BigInt(elapsedMs)) / 1000n;
    let live = polledBalance.value + extra;
    if (polledCap.value > 0n && live > polledCap.value) live = polledCap.value;
    return live;
  });

  // Path B has no 1s poll of its own — extrapolate its capacity by its own
  // rate over elapsed time since the last Path-B poll, same shape as Path A.
  const pathBBalanceExtrapolated = computed<bigint>(() => {
    const asOf = pathBAsOfMs.value;
    const elapsedMs = asOf > 0 && !dataPaused.value ? Math.max(0, nowTickMs.value - asOf) : 0;
    const extra = (pathBRate.value * BigInt(elapsedMs)) / 1000n;
    let live = pathBBalance.value + extra;
    if (pathBCap.value > 0n && live > pathBCap.value) live = pathBCap.value;
    return live;
  });

  const dustBalance = computed<bigint>(
    () => (pathBSupersedesA.value ? 0n : pathABalance.value) + pathBBalanceExtrapolated.value,
  );

  return {
    dustBalance,
    dustGenerating: computed(() => {
      const a = pathAPollHasSignal() ? polledGenerating.value : (midnightStore.balances?.dustGenerating ?? 0n);
      return (pathBSupersedesA.value ? 0n : a) + pathBRate.value;
    }),
    dustCap: computed(() => {
      const a = pathAPollHasSignal() ? polledCap.value : (midnightStore.dustState?.cap ?? 0n);
      return (pathBSupersedesA.value ? 0n : a) + pathBCap.value;
    }),
    nightRegistered: computed(() => {
      const a = pathAPollHasSignal() ? polledNightRegistered.value : (midnightStore.balances?.nightRegistered ?? 0n);
      return (pathBSupersedesA.value ? 0n : a) + pathBNight.value;
    }),
    registrationStatus: computed(() => {
      if (nativeRegistrationCleared.value) return 'Unregistered';
      const a = pathAPollHasSignal()
        ? polledRegistrationStatus.value
        : (midnightStore.dustState?.registrationStatus ?? 'Unregistered');
      // Either path being registered is enough, even when Path B supersedes Path A's figures.
      return (a === 'Registered' || pathBRegistered.value) ? 'Registered' : a;
    }),
    nativeRegistrationCleared,
    canRecoverNativeRegistration: computed(() => walletStore.loggedWallet?.network === Network.PREPROD
      && noCnightSource.value
      && !(pathAPollHasSignal() && polledRegistrationStatus.value === 'Registered')),
    nativeRegistrationConfirmedAt: computed(() => nativeRegistrationConfirmedAt.value),
    // Path B has its own independent poll — a pure-Path-B wallet whose
    // Path-A poll keeps 404ing (or never had a store snapshot) still needs
    // `hasData` to flip true once Path B has a reading, otherwise consumers
    // like DustRegistrationDialog fall back to stale/empty store values
    // forever even though the battery itself is showing real Path-B charge.
    hasData: computed(() => polledAsOfMs.value !== 0 || midnightStore.dustState != null || pathBAsOfMs.value !== 0),
    settled: computed(() => (polledAsOfMs.value !== 0 || midnightStore.dustState != null) && pathBBatchAsOfMs.value !== 0),
    estimate: dataPaused,
  };
}
