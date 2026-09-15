<template>
  <div v-if="watching" class="delegation-alerts">
    <!-- Nothing to flag: one small card, not a feed. The watchdog earns its room
         on the screen only when it has something to say; until then it states
         the fact and stays out of the way of the page's actual purpose. -->
    <section v-if="healthy" class="delegation-alerts__strip">
      <!-- Shield and sentence are ONE flex item. Wrapping can move the pair but
           can never split it, so no width strands the icon above its own line. -->
      <span class="delegation-alerts__strip-lead">
        <v-icon size="16" color="var(--g-success)">mdi-shield-check-outline</v-icon>
        <span class="t-body-sm delegation-alerts__strip-text">{{ $t('governance.alerts.allHealthy') }}</span>
      </span>
      <AsOf :timestamp="state.evaluatedAt" />
      <AlertSettings
        class="delegation-alerts__disclosure"
        :settings="settings"
        :activity-window="activityWindow"
        @warn-at="onWarnAtChange"
        @rationale="onRationaleChange"
      />
    </section>

    <section v-else class="delegation-alerts__feed glass-panel">
      <header class="delegation-alerts__head">
        <span class="t-label delegation-alerts__eyebrow">{{ $t('governance.alerts.title') }}</span>
        <AsOf :timestamp="state.evaluatedAt" />
      </header>

      <ErrorState v-if="state.errorKey" :message="$t(state.errorKey)" retryable @retry="refresh()" />

      <div v-else-if="state.loading && !alerts.length" class="delegation-alerts__loading">
        <v-skeleton-loader v-for="n in 2" :key="n" type="list-item-two-line" />
      </div>

      <ul v-else class="delegation-alerts__list">
        <li
          v-for="alert in alerts"
          :key="alert.id"
          class="delegation-alerts__card"
          :class="`delegation-alerts__card--${alert.severity}`"
        >
          <span class="delegation-alerts__glyph" :class="`delegation-alerts__glyph--${alert.severity}`">
            <v-icon :size="18">{{ glyph(alert) }}</v-icon>
          </span>

          <div class="delegation-alerts__body">
            <div class="delegation-alerts__row">
              <span class="t-body-2 delegation-alerts__title">{{ title(alert) }}</span>

              <span
                v-if="alert.kind === 'inactivity' && alert.facts.epochsLeft"
                class="t-caption delegation-alerts__pill delegation-alerts__pill--warning"
              >
                {{ $t('governance.epochsRemaining', { n: alert.facts.epochsLeft }) }}
              </span>
              <span
                v-else-if="alert.severity === 'critical'"
                class="t-caption delegation-alerts__pill delegation-alerts__pill--critical"
              >
                {{ $t('governance.alerts.actionNeeded') }}
              </span>

              <span v-if="alert.epoch !== null" class="t-caption delegation-alerts__epoch g-num">
                {{ $t('governance.alerts.atEpoch', { epoch: alert.epoch }) }}
              </span>
            </div>

            <p class="t-body-2 delegation-alerts__text">{{ body(alert) }}</p>

            <div v-if="alert.kind === 'inactivity' && progress(alert) !== null" class="delegation-alerts__progress">
              <span class="delegation-alerts__track" role="img" :aria-label="progressLabel(alert)">
                <span class="delegation-alerts__fill" :style="{ width: `${progress(alert)}%` }"></span>
              </span>
              <span class="t-caption delegation-alerts__progress-label g-num">{{ progressLabel(alert) }}</span>
            </div>

            <div class="delegation-alerts__actions">
              <!-- The replacement CTA always routes to the DIRECTORY. The wallet
                   states facts about the DRep the user chose; picking the next
                   one is the user's call, never a name Gero puts forward. -->
              <GButton
                v-if="alert.kind !== 'rationaleDrop'"
                :tier="alert.id === primaryAlertId ? 'primary' : 'secondary'"
                compact
                @click="goToDirectory()"
              >
                {{ alert.kind === 'retired' ? $t('governance.alerts.chooseNewDRep') : $t('governance.alerts.findReplacement') }}
              </GButton>

              <GButton
                v-if="alert.kind === 'inactivity'"
                tier="secondary"
                compact
                @click="snooze(alert)"
              >
                {{ $t('governance.alerts.remindMeAt', { epoch: snoozeTarget }) }}
              </GButton>

              <GButton
                v-if="alert.kind === 'rationaleDrop'"
                tier="secondary"
                compact
                @click="goToProfile(alert.drepId)"
              >
                {{ $t('governance.alerts.reviewRecord') }}
              </GButton>

              <GButton
                v-if="alert.kind === 'rationaleDrop'"
                tier="tertiary"
                compact
                @click="dismiss(alert)"
              >
                {{ $t('governance.alerts.dismiss') }}
              </GButton>
            </div>
          </div>
        </li>
      </ul>

      <!-- The neutrality promise, stated in the open. This is the weight that
           renders "Find a replacement" and "Choose a new DRep", so the line
           saying the wallet names no replacement of its own has to be readable
           without a click. It sits outside the disclosure in every state this
           card renders in, error and loading included. The compact healthy
           card flags nothing and offers nothing, so there it rides inside the
           settings disclosure instead and the card stays small. -->
      <p class="t-caption delegation-alerts__neutrality">{{ $t('governance.alerts.footer') }}</p>

      <AlertSettings
        :settings="settings"
        :activity-window="activityWindow"
        :show-neutrality-note="false"
        @warn-at="onWarnAtChange"
        @rationale="onRationaleChange"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router/composables';

import AlertSettings from '@/modules/governance/components/alerts/AlertSettings.vue';
import AsOf from '@/modules/governance/components/actions/AsOf.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import filters from '@/shared/utils/filters';
import { DEFAULT_DREP_ACTIVITY_EPOCHS } from '@/shared/composables/useDelegationHealth';
import governanceAlertsStore, {
  DEFAULT_SNOOZE_WARN_AT,
  drepActivityWindow,
  type GovernanceAlert,
} from '@/stores/governanceAlertsStore';
import NetworkStore from '@/stores/networkStore';

/**
 * The delegation watchdog's surface.
 *
 * Self-contained by design: it fetches nothing, computes nothing about a DRep,
 * and holds no state of its own. Its sources are `governanceAlertsStore` (which
 * owns evaluation, the settings and the snoozes) and the router. Everything it
 * renders is a public on-chain fact the store already asserted, which is what
 * the neutrality footnote promises the user.
 *
 * The replacement CTAs route to the DRep DIRECTORY, never to a named DRep — the
 * wallet does not put candidates forward.
 *
 * TWO SHAPES, one component. With something to flag it is the full feed card,
 * unchanged: severity hairlines, the countdown track, snooze and dismiss. With
 * nothing to flag it collapses to a small stacked card, because a watchdog that
 * has found nothing has no claim on half the page — and the settings it used to
 * shout about live behind a closed disclosure in both shapes.
 *
 * The neutrality footnote does NOT follow the settings into the disclosure. It
 * is only collapsible on the shape that flags nothing; wherever alerts and
 * their replacement CTAs render, it is a visible line on the card.
 */

const router = useRouter();
const { t } = useTranslation();

const state = governanceAlertsStore.state;
const settings = computed(() => state.settings);

const alerts = computed(() => governanceAlertsStore.activeAlerts());

/**
 * Nothing to say, so say it in one line.
 *
 * Deliberately the narrowest of the four states: a failed check still owes the
 * user its error, and a check still running still owes it a skeleton. Only
 * "watched, looked, found nothing" collapses — anything else keeps the feed
 * card, so the compaction can never swallow a fact.
 */
const healthy = computed(() => !state.errorKey && !state.loading && alerts.value.length === 0);

/**
 * Whether there is a DRep to say anything about at all.
 *
 * Without this the panel renders its "nothing to flag, your DRep is registered
 * and active" strip on the very screens that exist BECAUSE the wallet has no
 * DRep — flatly contradicting the hero above it on registeredNoDRep and
 * notInGovernance, and misdescribing an always-abstain delegation as a healthy
 * representative. The gate lives here rather than in
 * the host so that mounting this component unconditionally is always safe.
 *
 * `loading` keeps the skeleton reachable: the store only raises it once it has
 * a real DRep to look up, so a wallet with none never flashes one.
 */
const watching = computed(() => state.drepId !== null || state.loading);

/**
 * At most one gradient CTA on the surface. Retirement and inactivity are
 * mutually exclusive by construction (the store suppresses the countdown once a
 * DRep has deregistered), so this resolves to a single alert or none.
 */
const primaryAlertId = computed(
  () => alerts.value.find((alert) => alert.kind !== 'rationaleDrop')?.id ?? null,
);

/**
 * The activity window to state in the settings card: the one the current alerts
 * were actually measured against, else the chain's own `drep_activity` from the
 * epoch params, and only then CIP-1694's default. A literal here would misreport
 * the settings card on any chain that moves the parameter.
 */
const activityWindow = computed(
  () =>
    alerts.value[0]?.facts.activityWindow ?? drepActivityWindow() ?? DEFAULT_DREP_ACTIVITY_EPOCHS,
);

/** The "remind me at N" target, kept in step with a moved warning threshold. */
const snoozeTarget = computed(() =>
  Math.min(activityWindow.value, Math.max(settings.value.inactivityWarnAt + 3, DEFAULT_SNOOZE_WARN_AT)),
);

function glyph(alert: GovernanceAlert): string {
  if (alert.kind === 'retired') return 'mdi-account-arrow-left-outline';
  if (alert.kind === 'rationaleDrop') return 'mdi-message-text-outline';
  return 'mdi-clock-alert-outline';
}

function title(alert: GovernanceAlert): string {
  if (alert.kind === 'retired') return t('governance.alerts.retiredTitle');
  if (alert.kind === 'rationaleDrop') return t('governance.alerts.rationaleTitle');
  return alert.severity === 'critical'
    ? t('governance.alerts.inactivityExpiredTitle')
    : t('governance.alerts.inactivityTitle');
}

/** The stake at risk, through the shared lovelace formatter — never re-derived here. */
function stake(alert: GovernanceAlert): string {
  return filters.toCurrency(alert.facts.stakeLovelace ?? '0');
}

function body(alert: GovernanceAlert): string {
  const { facts } = alert;
  if (alert.kind === 'retired') {
    return t('governance.alerts.retiredBody', { amount: stake(alert) });
  }
  if (alert.kind === 'rationaleDrop') {
    return t('governance.alerts.rationaleBody', {
      window: facts.recentWindow,
      recent: facts.rationaleRecent ?? 0,
      longRun: facts.rationaleLongRun ?? 0,
    });
  }
  return alert.severity === 'critical'
    ? t('governance.alerts.inactivityExpiredBody', { window: facts.activityWindow, amount: stake(alert) })
    : t('governance.alerts.inactivityBody', {
        since: facts.windowUsed ?? 0,
        window: facts.activityWindow,
        amount: stake(alert),
      });
}

/**
 * How far through the activity window the countdown says the DRep is, as a
 * percentage of the track. `windowUsed` is expiry-derived, so the copy around
 * it speaks of the window, never of votes.
 */
function progress(alert: GovernanceAlert): number | null {
  const { windowUsed, activityWindow: window } = alert.facts;
  if (windowUsed === null || window <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((windowUsed / window) * 100)));
}

function progressLabel(alert: GovernanceAlert): string {
  return t('governance.alerts.inactivityProgress', {
    since: alert.facts.windowUsed ?? 0,
    window: alert.facts.activityWindow,
  });
}

function goToDirectory(): void {
  router.push({ name: 'governanceDReps' }).catch(() => undefined);
}

/**
 * The DRep's own page. That route arrives with the DRep surfaces; until it
 * does, the directory's existing `?drep=` deep link reaches the same record, so
 * the button is never a dead end.
 */
function goToProfile(drepId: string | null): void {
  if (!drepId) return;
  const path = `/governance/dreps/${drepId}`;
  const resolved = router.resolve(path);
  if (resolved.route.matched.length > 0) {
    router.push(path).catch(() => undefined);
    return;
  }
  router.push({ name: 'governanceDReps', query: { drep: drepId } }).catch(() => undefined);
}

function snooze(alert: GovernanceAlert): void {
  governanceAlertsStore.snooze(alert.id, snoozeTarget.value);
}

function dismiss(alert: GovernanceAlert): void {
  governanceAlertsStore.dismiss(alert.id);
}

function refresh(): void {
  void governanceAlertsStore.refresh();
}

function onWarnAtChange(value: number): void {
  governanceAlertsStore.setSettings({ inactivityWarnAt: value });
  refresh();
}

function onRationaleChange(value: boolean): void {
  governanceAlertsStore.setSettings({ rationaleDropEnabled: value });
  refresh();
}

// The store re-evaluates on login and on every epoch rollover, so the alerts are
// normally already in place when this mounts. This covers the one gap that
// leaves: a wallet whose tip has not moved since the store last looked, opened
// from a cold start.
onMounted(() => {
  if (state.evaluatedAt === null && NetworkStore.getCurrentEpoch() !== null) refresh();
});
</script>

<style scoped>
.delegation-alerts {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

.delegation-alerts__feed {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
  border-radius: var(--g-r-card);
}

/* Solid, not glass: glass means "this floats above content", and a status card
   that flags nothing is the most static thing on the page.

   Stacked rather than a single wide row. The panel now lives in the governance
   home's SIDE column, roughly a third of the page, so a row that fitted a
   sentence, a timestamp and a disclosure across 1200px could only shred itself
   there. A small column card is the shape the column actually has, and it is
   width-independent: the same card works at 360px in the popup. */
.delegation-alerts__strip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-2);
  padding: var(--g-s-4);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
}
/* The lead is the flex item, not the sentence: the shield travels with the
   words it belongs to at every width. */
.delegation-alerts__strip-lead {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-2);
  min-width: 0;
}
.delegation-alerts__strip-text {
  min-width: 0;
  color: var(--g-text-2);
}
/* The disclosure spans the card in both states now that the card is a column;
   opening it simply grows the card downwards. Attribute selector, no JS. */
.delegation-alerts__disclosure {
  align-self: stretch;
}

.delegation-alerts__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
}
.delegation-alerts__eyebrow {
  color: var(--g-text-3);
}

.delegation-alerts__loading,
.delegation-alerts__list {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Elevation is surface plus a hairline; the severity only tints the hairline. */
.delegation-alerts__card {
  display: flex;
  gap: var(--g-s-3);
  align-items: flex-start;
  padding: var(--g-s-4);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}
.delegation-alerts__card--warning {
  border-color: var(--g-warning-line);
}
.delegation-alerts__card--critical {
  border-color: var(--g-error-line);
}

.delegation-alerts__glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: var(--g-btn-h-compact);
  height: var(--g-btn-h-compact);
  border-radius: var(--g-r-control);
  background: var(--g-overlay);
  color: var(--g-info);
}
.delegation-alerts__glyph--warning {
  background: var(--g-warning-fill);
  color: var(--g-warning);
}
.delegation-alerts__glyph--critical {
  background: var(--g-error-fill);
  color: var(--g-error);
}
.delegation-alerts__glyph .v-icon {
  color: inherit;
}

.delegation-alerts__body {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  flex: 1;
  min-width: 0;
}
.delegation-alerts__row {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  flex-wrap: wrap;
}
.delegation-alerts__title {
  color: var(--g-text-1);
}
.delegation-alerts__epoch {
  margin-left: auto;
  color: var(--g-text-3);
}
.delegation-alerts__text {
  margin: 0;
  color: var(--g-text-2);
}

.delegation-alerts__pill {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--g-s-2);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-chip);
}
.delegation-alerts__pill--warning {
  color: var(--g-warning);
  background: var(--g-warning-fill);
  border-color: var(--g-warning-line);
}
.delegation-alerts__pill--critical {
  color: var(--g-error);
  background: var(--g-error-fill);
  border-color: var(--g-error-line);
}

.delegation-alerts__progress {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
}
.delegation-alerts__track {
  flex: 1;
  overflow: hidden;
  height: var(--g-s-2);
  border-radius: var(--g-r-pill);
  background: var(--g-overlay);
}
.delegation-alerts__fill {
  display: block;
  height: 100%;
  background: var(--g-warning);
  transition: width var(--g-dur-base) var(--g-ease);
}
.delegation-alerts__progress-label {
  color: var(--g-text-3);
}

.delegation-alerts__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}

.delegation-alerts__neutrality {
  margin: 0;
  color: var(--g-text-3);
}

/* No narrow-width rule any more: the card stacks at every width by
   construction, so the popup at 360px gets exactly the layout the side column
   gets. The old rule existed to break a single row apart; there is no row left
   to break. The shield still travels inside `__strip-lead`, which is markup
   rather than a stylesheet, so it cannot be stranded above its own sentence. */
</style>
