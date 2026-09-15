<template>
  <details class="alert-settings">
    <summary class="alert-settings__summary t-caption">
      <span>{{ $t('governance.alerts.settingsTitle') }}</span>
      <span class="alert-settings__preview">
        {{ $t('governance.alerts.settingsInactivityValue', { at: settings.inactivityWarnAt, window: activityWindow }) }}
      </span>
      <v-icon size="16" class="alert-settings__chevron">mdi-chevron-down</v-icon>
    </summary>

    <div class="alert-settings__body">
      <div class="alert-settings__row">
        <span class="t-body-2 alert-settings__label">{{ $t('governance.alerts.settingsInactivity') }}</span>
      </div>
      <v-chip-group :value="settings.inactivityWarnAt" mandatory @change="onWarnAt">
        <v-chip v-for="at in WARN_AT_CHOICES" :key="at" :value="at" small outlined class="g-num">
          {{ at }}
        </v-chip>
      </v-chip-group>

      <div class="alert-settings__row">
        <span class="t-body-2 alert-settings__label">{{ $t('governance.alerts.settingsRationale') }}</span>
        <v-switch
          :input-value="settings.rationaleDropEnabled"
          dense
          hide-details
          class="alert-settings__switch"
          :aria-label="$t('governance.alerts.settingsRationale')"
          @change="onRationale"
        />
      </div>

      <div class="alert-settings__row">
        <span class="t-body-2 alert-settings__label">{{ $t('governance.alerts.settingsRetirement') }}</span>
        <span class="t-caption alert-settings__value">{{ $t('governance.alerts.alwaysOn') }}</span>
      </div>

      <div class="alert-settings__row">
        <span class="t-body-2 alert-settings__label">{{ $t('governance.alerts.settingsPush') }}</span>
        <span class="t-caption alert-settings__muted">{{ $t('common.off') }}</span>
      </div>
      <p class="t-caption alert-settings__note">{{ $t('governance.alerts.pushUnavailable') }}</p>

      <!-- The standing neutrality promise, but ONLY where nothing is being
           flagged. On a strip that says "nothing to flag" there is no call to
           action to qualify, so the promise can ride inside the disclosure
           rather than claim a full-width block. The moment alerts and their
           replacement CTAs are on screen the host renders it in the open and
           sets `show-neutrality-note` false, because a promise that the wallet
           never names a replacement may not sit behind a click on the very
           weight that offers to find one. -->
      <p v-if="showNeutralityNote" class="t-caption alert-settings__note">
        {{ $t('governance.alerts.footer') }}
      </p>
    </div>
  </details>
</template>

<script setup lang="ts">
import type { PropType } from 'vue';

import type { GovernanceAlertSettings } from '@/stores/governanceAlertsStore';

/**
 * Alert settings, behind a native disclosure that is CLOSED by default.
 *
 * Native `<details>` on purpose, for three reasons that all matter here:
 *  - it keeps its children MOUNTED when closed, so nothing that reads the
 *    rendered markup loses sight of a setting the user can still reach;
 *  - it is keyboard-operable and screen-reader-labelled with no JS and no
 *    `@click` on a `<div>`. The baseline :focus-visible selector does NOT list
 *    `summary`, so the ring is re-stated in this file's styles rather than left
 *    to whatever the user agent draws;
 *  - it costs zero pixels until opened, which is the whole point: the healthy
 *    state of the watchdog had been spending a full card on controls nobody
 *    opened.
 *
 * Because closed still means mounted, "is the panel collapsed?" must be read
 * off the `open` attribute, never off whether these nodes exist.
 *
 * Stateless: the store owns the settings, this only reports the user's intent.
 */

defineProps({
  settings: { type: Object as PropType<GovernanceAlertSettings>, required: true },
  /** The activity window the warning threshold is quoted against. */
  activityWindow: { type: Number, required: true },
  /**
   * Whether the neutrality promise lives inside this disclosure.
   *
   * True only where the disclosure is the whole surface — the compact healthy
   * strip, which flags nothing and offers nothing. A host that is showing
   * alerts renders that line in the open and passes false, so it is never
   * collapsed on a weight that carries replacement CTAs.
   */
  showNeutralityNote: { type: Boolean, default: true },
});

const emit = defineEmits<{
  (event: 'warn-at', value: number): void;
  (event: 'rationale', value: boolean): void;
}>();

/** How far into the window the warning may be moved. Endpoints, not advice. */
const WARN_AT_CHOICES = [10, 12, 15, 18];

function onWarnAt(value: number | undefined): void {
  if (typeof value !== 'number') return;
  emit('warn-at', value);
}

function onRationale(value: boolean | null): void {
  emit('rationale', !!value);
}
</script>

<style scoped>
.alert-settings {
  flex: none;
}

.alert-settings__summary {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  min-height: var(--g-btn-h-compact);
  color: var(--g-text-3);
  cursor: pointer;
  /* Drops the default triangle only. Nothing here removes an outline. */
  list-style: none;
}
.alert-settings__summary::-webkit-details-marker {
  display: none;
}
/* The accessibility floor for the one control that gates every alert setting.
   baseline.css matches a, button, [role='button'], .v-btn, inputs and
   [tabindex] — `summary` is on none of those lists, so without this rule a
   keyboard user gets whatever ring the user agent happens to draw. Same 2px
   accent ring as the baseline; the outline is drawn here, never removed. */
.alert-settings__summary:focus-visible {
  outline: 2px solid var(--g-accent);
  outline-offset: 2px;
  border-radius: var(--g-r-control);
}
.alert-settings__summary:hover {
  color: var(--g-text-2);
}
.alert-settings__preview {
  color: var(--g-accent);
}
.alert-settings__chevron {
  color: inherit;
  transition: transform var(--g-dur-fast) var(--g-ease);
}
.alert-settings[open] .alert-settings__chevron {
  transform: rotate(180deg);
}

.alert-settings__body {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding-top: var(--g-s-3);
}
.alert-settings__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  min-height: var(--g-btn-h-compact);
}
.alert-settings__label {
  color: var(--g-text-2);
}
.alert-settings__value {
  color: var(--g-accent);
}
.alert-settings__muted {
  color: var(--g-text-3);
}
.alert-settings__switch {
  margin: 0;
  padding: 0;
  flex: none;
}
.alert-settings__note {
  margin: 0;
  color: var(--g-text-3);
}
</style>
