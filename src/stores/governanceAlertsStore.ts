import Vue, { watch } from 'vue';

import {
  DEFAULT_DREP_ACTIVITY_EPOCHS,
  delegationHealth,
  type DelegatedDRepRecord,
} from '@/shared/composables/useDelegationHealth';
import { setWalletConfiguration } from '@/db/wallet-db';
import { KEYWORD_DREPS } from '@/shared/utils/drepId';
import type { DRepMatchCriteria } from '@/shared/utils/drepMatch';
import NetworkStore, { networkStore } from '@/stores/networkStore';
import { walletStore, type Account } from '@/stores/walletStore';
import { getContextType } from '@/utils/storageSync';
import { debugLog } from '@/utils/debug';

/**
 * The delegation watchdog.
 *
 * Every alert here is a PUBLIC ON-CHAIN FACT about the DRep the user chose, and
 * nothing else. There is no scoring, no "you should switch", and no named
 * replacement: the only thing an alert can offer is the DRep directory, where
 * the user picks for themselves. That constraint is not cosmetic — a wallet
 * that nudged its users toward particular representatives would be an actor in
 * governance rather than a window onto it.
 *
 * The evaluation itself (`evaluateAlerts`) is pure over its arguments, so the
 * rules are testable without a store, a network or a wallet. The store around
 * it owns three impure jobs: when to evaluate, where the settings live, and
 * what the nav badge reads.
 *
 * **Delivery is poll-on-sync only.** There are no push notifications and no
 * `chrome.alarms`: alerts are recomputed from data the wallet already receives
 * (`walletStore.account` at login, `networkStore.tip` from Gero Sync). A push
 * channel needs a Gero Sync governance key that does not exist yet, so
 * `pushEnabled` is present in the settings shape, rendered as "off", and forced
 * false on every write.
 */

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export type GovernanceAlertKind = 'inactivity' | 'rationaleDrop' | 'retired';

/** critical: the stake is already not counting. warning: a countdown. info: FYI. */
export type GovernanceAlertSeverity = 'critical' | 'warning' | 'info';

/** The on-chain numbers an alert asserts. Everything the copy renders comes from here. */
export interface GovernanceAlertFacts {
  /**
   * Epochs into the activity window, derived from the expiry countdown (see
   * `DelegationHealth.windowUsed`) — never vote recency. Null before the tip
   * lands or when the countdown was discarded as stale.
   */
  windowUsed: number | null;
  /** Whole epochs until they stop counting; 0 once passed, null if unknown. */
  epochsLeft: number | null;
  /** The `drep_activity` window actually used. */
  activityWindow: number;
  /** Percent of the newest `recentWindow` votes carrying a rationale, or null. */
  rationaleRecent: number | null;
  /** Percent over the whole voting record, or null when there are no votes. */
  rationaleLongRun: number | null;
  /** How many of the newest votes `rationaleRecent` covered. */
  recentWindow: number;
  /** The stake at risk, in LOVELACE, kept as the string the account carries. */
  stakeLovelace: string | null;
}

export interface GovernanceAlert {
  /** `${kind}:${drepId}` — stable across re-evaluations, so a snooze sticks to it. */
  id: string;
  kind: GovernanceAlertKind;
  severity: GovernanceAlertSeverity;
  /** The epoch the fact was observed in. Null before the tip is known. */
  epoch: number | null;
  drepId: string | null;
  /** Chain epoch this alert stays hidden until. Null/absent means it is showing. */
  dismissedUntilEpoch?: number | null;
  facts: GovernanceAlertFacts;
}

export interface GovernanceAlertSettings {
  /**
   * Epochs INTO the activity window at which the inactivity alert fires. The
   * settings card counts up ("at 15 of 20 epochs") while `useDelegationHealth`
   * counts down (`warnAt`, "5 left"); they name the same instant and this store
   * is where the two conventions meet.
   */
  inactivityWarnAt: number;
  rationaleDropEnabled: boolean;
  /** Always false — see the module note on delivery. */
  pushEnabled: boolean;
}

export interface GovernanceAlertsState {
  alerts: GovernanceAlert[];
  settings: GovernanceAlertSettings;
  /** Alert id to the chain epoch it reappears at. Persisted, so a snooze survives a reload. */
  snoozes: Record<string, number>;
  /**
   * The DRep currently being watched, or null when there is nothing to watch.
   * Null is the signal a host surface reads to render no alerts UI at all: a
   * wallet with no delegation must not be told its DRep is healthy.
   */
  drepId: string | null;
  /** When the alerts were last computed — every cached number is stamped. */
  evaluatedAt: number | null;
  loading: boolean;
  /**
   * i18n KEY for a failed check, not a message. The store has no `$t`, and a
   * raw upstream error would reach a German user in English.
   */
  errorKey: string | null;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** "at 15 of 20 epochs" — five epochs, about 25 days, of warning. */
export const DEFAULT_INACTIVITY_WARN_AT = 15;
/** Where "Remind me at 18" puts the next warning. */
export const DEFAULT_SNOOZE_WARN_AT = 18;
/**
 * How far the recent rationale rate must fall below the long-run rate, in
 * PERCENTAGE POINTS, before it is worth saying anything. A parameter, not a
 * verdict: a small wobble in a 10-vote window is noise, not a change of habit.
 */
export const DEFAULT_RATIONALE_DROP_POINTS = 20;
/**
 * Epochs a plain "Dismiss" defers an alert for. Dismissing does not delete the
 * fact — it is still true — so the alert returns if the DRep's behaviour has
 * not changed by then.
 */
export const DEFAULT_DISMISS_EPOCHS = 5;

/** Wallet-DB config keys. Wallet-scoped, like every other per-wallet preference. */
export const ALERT_SETTINGS_KEY = 'governanceAlertSettings';
export const ALERT_SNOOZES_KEY = 'governanceAlertSnoozes';
/**
 * Where the DRep-match criteria live. Owned by the Match surface, read-only
 * here: the rationale alert exists ONLY because the user named a rationale
 * minimum as a priority of their own.
 */
export const MATCH_CRITERIA_KEY = 'governanceMatchCriteria';

function defaultSettings(): GovernanceAlertSettings {
  return {
    inactivityWarnAt: DEFAULT_INACTIVITY_WARN_AT,
    rationaleDropEnabled: true,
    pushEnabled: false,
  };
}

// ---------------------------------------------------------------------------
// Pure evaluation
// ---------------------------------------------------------------------------

export interface EvaluateOptions {
  /** The user's saved Match criteria. Gates the rationale alert entirely. */
  matchCriteria?: DRepMatchCriteria | null;
  /** Protocol `drep_activity`. Null falls back to CIP-1694's 20. */
  activityWindow?: number | null;
  /** Percentage-point drop that counts as material. */
  rationaleDropPoints?: number;
  /** How many of the newest votes the "recent" rate covers. */
  recentWindow?: number;
  /**
   * Wall time in unix seconds, enabling `delegationHealth`'s recent-vote veto.
   * The pure evaluator takes it as an argument (no clock in here); the store's
   * `evaluate` supplies `Date.now() / 1000` when the caller does not.
   */
  nowSec?: number | null;
  /** Which alerts are switched on, and where the inactivity threshold sits. */
  settings?: Partial<GovernanceAlertSettings>;
}

/** A predefined vote-delegation target (always-abstain / always-no-confidence). */
function isKeywordDRep(drepId: string): boolean {
  return (KEYWORD_DREPS as readonly string[]).includes(drepId);
}

/** i18n key shown when the DRep lookup itself failed. */
export const ALERT_CHECK_FAILED_KEY = 'governance.alerts.checkFailed';

/**
 * The DRep this wallet is actually watching, or null when there is nothing to
 * watch: no delegation at all, a predefined choice (neither expires nor
 * retires), or a stake key that is not registered.
 *
 * One predicate, three callers — `evaluateAlerts`, `evaluate` and `refresh` —
 * so `state.drepId` cannot disagree with whether any alert could fire. That
 * matters beyond tidiness: a host surface gates its whole alerts UI on
 * `state.drepId`, and a stale non-null there would tell a wallet with no
 * delegation that its DRep is healthy.
 */
export function watchedDRepId(account: Account | null | undefined): string | null {
  const drepId = String(account?.drep_id ?? '').trim();
  if (!drepId || isKeywordDRep(drepId)) return null;
  if (account?.active === false) return null;
  return drepId;
}

/**
 * Compute the alerts a wallet's delegation warrants. Pure over its arguments:
 * no fetching, no store reads, no clock.
 *
 * Returns an empty list — never a "you are fine" alert — when there is nothing
 * to watch: no DRep, a predefined choice (neither expires nor retires), or an
 * unregistered stake key.
 */
export function evaluateAlerts(
  account: Account | null | undefined,
  record: DelegatedDRepRecord | null | undefined,
  currentEpoch: number | null,
  options: EvaluateOptions = {},
): GovernanceAlert[] {
  // No delegation, a predefined choice, or an unregistered stake key: nothing
  // to watch, so nothing to say. An unregistered stake key in particular has no
  // voting power delegated to anyone, so a countdown would warn about nothing.
  const drepId = watchedDRepId(account);
  if (!drepId) return [];

  const settings = { ...defaultSettings(), ...(options.settings ?? {}) };
  const activityWindow = options.activityWindow ?? DEFAULT_DREP_ACTIVITY_EPOCHS;
  // Translate "fires at 15 of 20" into the epochs-left threshold A1 speaks.
  const warnAt = Math.max(0, activityWindow - settings.inactivityWarnAt);

  const health = delegationHealth(record, {
    currentEpoch,
    activityWindow,
    warnAt,
    recentWindow: options.recentWindow,
    nowSec: options.nowSec,
  });

  const facts: GovernanceAlertFacts = {
    windowUsed: health.windowUsed,
    epochsLeft: health.epochsLeft,
    activityWindow: health.activityWindow,
    rationaleRecent: health.rationaleRecent,
    rationaleLongRun: health.rationaleLongRun,
    recentWindow: health.recentWindow,
    stakeLovelace: account?.controlled_amount ?? null,
  };

  const alerts: GovernanceAlert[] = [];

  // Retirement outranks everything and ends the evaluation. It is permanent, so
  // an inactivity countdown alongside it would be advice about a clock that has
  // already stopped, and a note about rationale habits would be pure trivia.
  if (health.retired) {
    alerts.push({
      id: `retired:${drepId}`,
      kind: 'retired',
      severity: 'critical',
      epoch: currentEpoch,
      drepId,
      dismissedUntilEpoch: null,
      facts,
    });
    return alerts;
  }

  if (health.inactiveSoon) {
    alerts.push({
      id: `inactivity:${drepId}`,
      kind: 'inactivity',
      // Already expired is not the same warning as a countdown, but it is the
      // same fact and the same remedy, so it stays one alert with a harder tone.
      severity: health.expired ? 'critical' : 'warning',
      epoch: currentEpoch,
      drepId,
      dismissedUntilEpoch: null,
      facts,
    });
  }

  // Opt-in twice over: the user kept the alert on AND named a rationale minimum
  // in their own Match criteria. Without both, saying anything about how a DRep
  // writes up their votes would be Gero volunteering an opinion.
  const rationaleMin = options.matchCriteria?.rationaleMin;
  const dropPoints = options.rationaleDropPoints ?? DEFAULT_RATIONALE_DROP_POINTS;
  if (
    settings.rationaleDropEnabled &&
    rationaleMin !== null &&
    rationaleMin !== undefined &&
    health.rationaleRecent !== null &&
    health.rationaleLongRun !== null &&
    health.rationaleLongRun - health.rationaleRecent >= dropPoints
  ) {
    alerts.push({
      id: `rationaleDrop:${drepId}`,
      kind: 'rationaleDrop',
      severity: 'info',
      epoch: currentEpoch,
      drepId,
      dismissedUntilEpoch: null,
      facts,
    });
  }

  return alerts;
}

/**
 * Whether an alert is currently showing. Retirement is never snoozable, so no
 * stale dismissal can hide it. An unknown epoch shows the alert: withholding a
 * fact because the tip has not arrived is the wrong way to fail.
 */
export function isAlertActive(alert: GovernanceAlert, currentEpoch: number | null): boolean {
  if (alert.kind === 'retired') return true;
  const until = alert.dismissedUntilEpoch;
  if (until === null || until === undefined) return true;
  if (currentEpoch === null) return true;
  return currentEpoch >= until;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const state = Vue.observable<GovernanceAlertsState>({
  alerts: [],
  settings: defaultSettings(),
  snoozes: {},
  drepId: null,
  evaluatedAt: null,
  loading: false,
  errorKey: null,
});

/** Which wallet's preferences are loaded, so a switch re-reads and a re-render does not. */
let hydratedWalletId: number | null = null;
/**
 * Whether that load actually saw the wallet's config, as opposed to the empty
 * bag `walletStore.config` holds until the ConfigLoader liveQuery delivers.
 */
let hydratedFromConfig = false;

function currentEpoch(): number | null {
  return NetworkStore.getCurrentEpoch();
}

/**
 * The chain's `drep_activity`, or null when the epoch params have not landed.
 * The Cardano SDK params spell it `dRepInactivityPeriod` (that is the field
 * `db/loaders/network.ts` fills from the raw `epoch_params.drep_activity`);
 * the raw gero-backend payload spells it `drep_activity`. Read both.
 *
 * Exported because the alerts SURFACE needs the same number to state the
 * window in its settings card, and a second literal 20 there would quietly
 * misreport any chain that ever moves the parameter.
 */
export function drepActivityWindow(): number | null {
  const params = networkStore.epochParams as unknown as Record<string, unknown> | null;
  const raw = params?.['dRepInactivityPeriod'] ?? params?.['drep_activity'];
  return typeof raw === 'number' && raw > 0 ? raw : null;
}

/** The user's saved Match criteria, if the Match surface has stored any. */
function savedMatchCriteria(): DRepMatchCriteria | null {
  const criteria = walletStore.config?.[MATCH_CRITERIA_KEY];
  return criteria && typeof criteria === 'object' ? (criteria as DRepMatchCriteria) : null;
}

/**
 * Write one preference to the wallet-scoped `config` table — the same table and
 * the same helper every other per-wallet preference uses. `walletStore.config`
 * is refreshed by the ConfigLoader liveQuery, so `hydrate` reads back what this
 * wrote without a second code path.
 */
async function persist(key: string, value: unknown): Promise<void> {
  const walletId = walletStore.loggedWallet?.id;
  if (typeof walletId !== 'number') return;
  try {
    await setWalletConfiguration(walletId, key, value);
  } catch (error) {
    // A preference that failed to save is not worth breaking the surface over;
    // the in-memory value still applies for this session.
    debugLog('governanceAlertsStore: failed to persist', key, error);
  }
}

/** Re-apply the stored snoozes onto a freshly evaluated list, matching by alert id. */
function withSnoozes(alerts: GovernanceAlert[]): GovernanceAlert[] {
  return alerts.map((alert) =>
    alert.kind === 'retired' || state.snoozes[alert.id] === undefined
      ? alert
      : { ...alert, dismissedUntilEpoch: state.snoozes[alert.id] },
  );
}

/** Drop snoozes whose alert no longer fires, so they cannot mute a later recurrence. */
function pruneSnoozes(alerts: GovernanceAlert[]): void {
  const live = new Set(alerts.map((alert) => alert.id));
  let changed = false;
  for (const id of Object.keys(state.snoozes)) {
    if (!live.has(id)) {
      Vue.delete(state.snoozes, id);
      changed = true;
    }
  }
  if (changed) void persist(ALERT_SNOOZES_KEY, { ...state.snoozes });
}

function clearAlerts(): void {
  state.alerts = [];
  state.drepId = null;
  state.errorKey = null;
  state.evaluatedAt = Date.now();
}

const actions = {
  state,

  /**
   * Load this wallet's saved preferences out of `walletStore.config`, which the
   * ConfigLoader liveQuery keeps in step with the wallet DB `config` table.
   *
   * That liveQuery fills the bag ASYNCHRONOUSLY, so the first read after a
   * login or a reload lands on an empty `{}`. Latching on that read would
   * replace the saved threshold and every stored snooze with defaults for the
   * rest of the session and never look again — which is precisely how a
   * "remind me at 18" comes back the moment the user reloads. So the wallet id
   * alone does not count as hydrated: only a read that actually SAW the config
   * closes the door, and `startAlertWatcher` calls back here when it arrives.
   *
   * Returns whether the effective values changed, so the caller can re-evaluate
   * only when it would make a difference.
   */
  hydrate(force = false): boolean {
    const walletId = walletStore.loggedWallet?.id ?? null;
    const config = walletStore.config;
    const configArrived = !!config && Object.keys(config).length > 0;

    if (!force && walletId === hydratedWalletId && hydratedFromConfig) return false;

    hydratedWalletId = walletId;
    hydratedFromConfig = configArrived;

    const before = JSON.stringify([state.settings, state.snoozes]);

    const stored = config?.[ALERT_SETTINGS_KEY];
    state.settings = {
      ...defaultSettings(),
      ...(stored && typeof stored === 'object' ? (stored as Partial<GovernanceAlertSettings>) : {}),
      // Never rehydrated as true, whatever an older record says.
      pushEnabled: false,
    };

    const snoozes = config?.[ALERT_SNOOZES_KEY];
    state.snoozes =
      snoozes && typeof snoozes === 'object' ? { ...(snoozes as Record<string, number>) } : {};

    return JSON.stringify([state.settings, state.snoozes]) !== before;
  },

  /**
   * Recompute the alerts from a DRep record the caller already has. Pure
   * evaluation plus three side effects: stored snoozes are re-applied, dead
   * snoozes are pruned, and the result is stamped.
   */
  evaluate(
    account: Account | null | undefined,
    record: DelegatedDRepRecord | null | undefined,
    epoch: number | null = currentEpoch(),
    options: EvaluateOptions = {},
  ): GovernanceAlert[] {
    const alerts = withSnoozes(
      evaluateAlerts(account, record, epoch, {
        matchCriteria: options.matchCriteria ?? savedMatchCriteria(),
        activityWindow: options.activityWindow ?? drepActivityWindow(),
        rationaleDropPoints: options.rationaleDropPoints,
        recentWindow: options.recentWindow,
        // The wall clock lives HERE, not in the pure evaluator: it feeds the
        // recent-vote veto that stops a stale indexed expiry from claiming a
        // freshly voting DRep is excluded from tallies.
        nowSec: options.nowSec ?? Math.floor(Date.now() / 1000),
        settings: options.settings ?? state.settings,
      }),
    );

    pruneSnoozes(alerts);
    state.alerts = alerts;
    // Null whenever there is nothing to watch, even though alerts is ALSO empty
    // then: a host surface tells the two apart to decide between "all healthy"
    // and no alerts UI at all.
    state.drepId = watchedDRepId(account);
    state.evaluatedAt = Date.now();
    return alerts;
  },

  /** Alerts that are not snoozed right now — what the panel renders and the badge counts. */
  activeAlerts(epoch: number | null = currentEpoch()): GovernanceAlert[] {
    return state.alerts.filter((alert) => isAlertActive(alert, epoch));
  },

  /** The nav badge. Reactive: it reads the observable alerts and the observable tip. */
  alertCount(): number {
    return this.activeAlerts().length;
  },

  /**
   * Snooze one alert until it is `remindAtWindowEpoch` epochs INTO the activity
   * window — the artboard's "Remind me at 18". Epochs into the window advance
   * one-for-one with chain epochs while the DRep stays silent, so the target
   * translates directly. Retirement cannot be snoozed.
   */
  snooze(alertId: string, remindAtWindowEpoch: number = DEFAULT_SNOOZE_WARN_AT): void {
    const alert = state.alerts.find((entry) => entry.id === alertId);
    if (!alert || alert.kind === 'retired') return;

    const epoch = currentEpoch();
    const since = alert.facts.windowUsed;
    if (epoch === null || since === null) return;

    // Always defer by at least one epoch: a target already reached would
    // otherwise re-show the alert immediately and read as a broken button.
    const target = epoch + Math.max(1, remindAtWindowEpoch - since);
    this.snoozeUntil(alertId, target);
  },

  /** Defer an alert for a flat number of epochs — the plain "Dismiss" action. */
  dismiss(alertId: string, epochs: number = DEFAULT_DISMISS_EPOCHS): void {
    const epoch = currentEpoch();
    if (epoch === null) return;
    this.snoozeUntil(alertId, epoch + Math.max(1, epochs));
  },

  /** Hide an alert until a specific chain epoch. Retirement is exempt. */
  snoozeUntil(alertId: string, untilEpoch: number): void {
    const index = state.alerts.findIndex((entry) => entry.id === alertId);
    if (index === -1 || state.alerts[index].kind === 'retired') return;

    Vue.set(state.snoozes, alertId, untilEpoch);
    Vue.set(state.alerts, index, { ...state.alerts[index], dismissedUntilEpoch: untilEpoch });
    void persist(ALERT_SNOOZES_KEY, { ...state.snoozes });
  },

  /** Update the alert preferences and re-apply them to the alerts already on screen. */
  setSettings(next: Partial<GovernanceAlertSettings>): void {
    state.settings = { ...state.settings, ...next, pushEnabled: false };
    void persist(ALERT_SETTINGS_KEY, { ...state.settings });
  },

  /**
   * Fetch the delegated DRep's record and re-evaluate. The only impure path in
   * the store, and the only place anything is fetched: the panel takes the
   * store as its source and never calls an API itself.
   */
  async refresh(): Promise<void> {
    const wallet = walletStore.loggedWallet;
    const account = walletStore.account;

    if (!wallet || wallet.chain !== 'Cardano' || walletStore.isLocked) {
      this.reset();
      return;
    }
    this.hydrate();

    const drepId = watchedDRepId(account);
    if (!drepId) {
      // Note the ordering: `loading` is never raised on this path, so a host
      // surface gating on `drepId || loading` shows nothing at all rather than
      // flashing a skeleton for a DRep that does not exist.
      clearAlerts();
      return;
    }

    // Only raise `loading` when there is nothing on screen yet. A re-evaluation
    // with alerts already computed must not turn the panel back into a skeleton
    // — that reflows the page around it, which is what a reader sees as "it
    // reloaded". Same rule as MyGovernance's own loading flag.
    state.loading = state.evaluatedAt === null;
    state.errorKey = null;
    try {
      // Deliberately the client directly, NOT the shared record cache. The
      // watchdog has to be able to see a lookup fail: served a cached record it
      // would report a clean bill of health from data it did not just check, and
      // `errorKey` would never light during an outage inside the TTL. The
      // duplicate fetch this costs is now at most one per epoch — see the
      // watcher above, which no longer fires per block.
      const { default: blockchainApi } = await import('@/api/blockchain-api');
      const record = await blockchainApi.getDRepById(drepId, wallet.chain, wallet.network);
      this.evaluate(account, record as DelegatedDRepRecord | null, currentEpoch());
    } catch (error) {
      // A lookup failure is NOT a clean bill of health. The last known alerts
      // stay up and the failure is surfaced, rather than the badge quietly
      // going dark on an outage. The upstream text goes to the log, not the
      // user: it is English, and often an axios string rather than a sentence.
      state.errorKey = ALERT_CHECK_FAILED_KEY;
      debugLog('governanceAlertsStore: DRep lookup failed', error);
    } finally {
      state.loading = false;
    }
  },

  reset(): void {
    hydratedWalletId = null;
    hydratedFromConfig = false;
    state.alerts = [];
    state.settings = defaultSettings();
    state.snoozes = {};
    state.drepId = null;
    state.evaluatedAt = null;
    state.loading = false;
    state.errorKey = null;
  },
};

// ---------------------------------------------------------------------------
// Evaluation trigger
// ---------------------------------------------------------------------------

/**
 * When the alerts are recomputed.
 *
 * Poll-on-sync, on the two signals the wallet already receives: the account
 * lands at login, and Gero Sync pushes the tip on every block. Watching the
 * wallet id, the delegated DRep id and the EPOCH (not the tip) means exactly
 * two triggers — a login, and an epoch rollover — instead of a DRep lookup on
 * every block for a countdown that only moves once per epoch.
 *
 * It lives in the store rather than in the panel's parent because the nav badge
 * has to light without the user having opened the governance page first, and
 * because the panel's parent view belongs to another surface.
 */
/**
 * The four values a re-check depends on, as ONE STRING.
 *
 * A string because `watch` compares a getter's result with `Object.is`. This was
 * an array literal, rebuilt on every evaluation, so two arrays holding the same
 * four values were never the same object and the callback fired on every
 * reactive READ of its dependencies rather than on every change. `currentEpoch()`
 * reads the tip, and gero-sync replaces the tip about every 20 seconds, so the
 * watchdog pulled a ~240 KB DRep record and raised its loading flag once per
 * BLOCK — which is precisely what the comment on `startAlertWatcher` says it
 * must not do. Joined to a primitive, the comparison is by value again.
 */
export function alertWatchKey(): string {
  return [
    walletStore.loggedWallet?.id ?? '',
    walletStore.account?.drep_id ?? '',
    walletStore.isLocked,
    currentEpoch() ?? '',
  ].join('|');
}

export function startAlertWatcher(): () => void {
  const stopEvaluation = watch(
    alertWatchKey,
    () => {
      void actions.refresh();
    },
    { immediate: true },
  );

  // `walletStore.config` is filled by a liveQuery AFTER login, so the hydrate
  // above necessarily read an empty bag. Re-read when it lands. `hydrate`
  // reports whether anything actually changed, so ordinary config churn from
  // elsewhere in the app (a currency change, a toggled balance) costs a compare
  // and not a DRep lookup — and a saved threshold that DOES arrive re-evaluates,
  // because it decides which alerts fire.
  const stopHydration = watch(
    () => walletStore.config,
    () => {
      if (actions.hydrate()) void actions.refresh();
    },
  );

  return () => {
    stopEvaluation();
    stopHydration();
  };
}

// Extension UI only. The background service worker has no badge to light, and
// the test runner is neither (`getContextType` reports 'content' there), so
// importing this module in a spec installs nothing.
if (getContextType() === 'browser') {
  startAlertWatcher();
}

export default actions;
