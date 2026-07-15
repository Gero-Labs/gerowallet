<template>
  <div class="ps-widget glass-panel">
    <!-- Header: label + full-page link (mirrors dust-gauge__head / the
         Recent Transactions "View all" link pattern, tokenized). -->
    <div class="ps-widget__head">
      <div class="ps-widget__title t-label">
        <v-icon x-small class="mr-1">mdi-server-security</v-icon>
        {{ t('midnight.proofServerPage.title') }}
      </div>
      <router-link to="/proof-server" class="ps-widget__link">
        {{ t('midnight.proofServerPage.openPage') }}
        <v-icon size="12">mdi-chevron-right</v-icon>
      </router-link>
    </div>

    <!-- Mode switch: the same three choices as the full page's mode cards,
         compacted into a segmented control. -->
    <div class="ps-widget__toggle" role="group" :aria-label="t('midnight.proofServerPage.title')">
      <button
        type="button"
        class="ps-widget__toggle-btn ps-widget__toggle-btn--remote"
        :class="{ 'ps-widget__toggle-btn--active': proofServerMode === 'remote' }"
        :disabled="proofServerSaving"
        @click="proofServerMode = 'remote'"
      >
        <v-icon size="14" class="ps-widget__toggle-icon">mdi-cloud-outline</v-icon>
        {{ t('midnight.proofServerPage.compareRemoteTitle') }}
      </button>
      <button
        type="button"
        class="ps-widget__toggle-btn ps-widget__toggle-btn--zkpaas"
        :class="{ 'ps-widget__toggle-btn--active': proofServerMode === 'zkpaas' }"
        :disabled="proofServerSaving"
        @click="proofServerMode = 'zkpaas'"
      >
        <v-icon size="14" class="ps-widget__toggle-icon">mdi-google-cloud</v-icon>
        {{ t('midnight.proofServerPage.compareZkpaasTitle') }}
        <span v-if="proofServerMode === 'zkpaas' && healthStatus === 'detected'" class="ps-widget__pulse-dot" />
      </button>
      <button
        type="button"
        class="ps-widget__toggle-btn ps-widget__toggle-btn--local"
        :class="{ 'ps-widget__toggle-btn--active': proofServerMode === 'local' }"
        :disabled="proofServerSaving"
        @click="proofServerMode = 'local'"
      >
        <v-icon size="14" class="ps-widget__toggle-icon">mdi-laptop</v-icon>
        {{ t('midnight.proofServerPage.compareLocalTitle') }}
        <!-- Live connection pulse - only rendered while genuinely detected,
             so it is a real signal (per the project's motion rule: connection
             pulses are kept, decorative loops are not) rather than a fake
             "always on" indicator. Gero Cloud has no client-side health
             check to honestly pulse about, so it gets none; local and
             Arkhia do (both are health-checked from the wallet). -->
        <span v-if="proofServerMode === 'local' && healthStatus === 'detected'" class="ps-widget__pulse-dot" />
      </button>
    </div>

    <!-- Footer stats: mirrors dust-gauge__stats exactly (same 3-column
         k/v layout) so the two widgets read as one family side by side. -->
    <div class="ps-widget__stats">
      <div class="ps-widget__stat">
        <span class="k">{{ t('midnight.proofServerPage.widgetStatus') }}</span>
        <span class="v" :class="statusClass">{{ statusValue }}</span>
      </div>
      <div class="ps-widget__stat">
        <span class="k">{{ t('midnight.proofServerPage.widgetLatency') }}</span>
        <span class="v">{{ latencyValue }}</span>
      </div>
      <div class="ps-widget__stat">
        <span class="k">{{ t('midnight.proofServerPage.widgetLastProof') }}</span>
        <span class="v">{{ lastProofValue }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useMidnightProofServer, formatRelativeTime } from '@/chains/midnight/useProofServerSettings';

const { t } = useTranslation();

const {
  proofServerMode,
  proofServerSaving,
  healthStatus,
  lastCheckLatencyMs,
  provingHistory,
} = useMidnightProofServer();

// Status/latency only have live meaning in the wallet-side modes (local +
// Arkhia zkPaaS, both health-checked from the wallet) - remote (Gero Cloud)
// isn't, so showing a fabricated "connected" would overclaim. "Last proof"
// is a standing history fact and shows regardless of the selected mode.
const statusValue = computed(() => {
  if (proofServerMode.value === 'remote') return t('midnight.proofServerPage.compareRemoteTitle');
  if (healthStatus.value === 'detected') return t('midnight.proofServerPage.statusDetectedShort');
  if (healthStatus.value === 'notDetected') return t('midnight.proofServer.statusNotDetected');
  if (healthStatus.value === 'notConfigured') return t('midnight.proofServerPage.statusNotConfiguredShort');
  return t('midnight.proofServer.statusChecking');
});
const statusClass = computed(() => (
  proofServerMode.value !== 'remote' && healthStatus.value === 'detected' ? 'v--ok' : ''
));

const latencyValue = computed(() => {
  if (proofServerMode.value === 'remote' || lastCheckLatencyMs.value === null) return '—';
  return `${lastCheckLatencyMs.value}ms`;
});

const lastProofValue = computed(() => {
  const latest = provingHistory.value[0];
  return latest ? formatRelativeTime(latest.timestamp) : '—';
});
</script>

<style scoped>
/* Same shell as .dust-gauge (MidnightDustGauge.vue) so the pair reads as
   one family at 50/50 width - intentionally not extracted into a shared
   class since the two are independent components with their own bodies. */
.ps-widget {
  padding: 14px 16px;
  border-radius: var(--g-r-card);
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}

.ps-widget__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

/* Type comes from the shared .t-label class (template) - reuses the
   canonical small-caps label style from baseline.css instead of a second
   from-scratch declaration. */
.ps-widget__title {
  display: flex;
  align-items: center;
}

.ps-widget__link {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  color: var(--g-text-3);
  text-decoration: none;
}

.ps-widget__link:hover {
  color: var(--g-text-1);
}

.ps-widget__toggle {
  display: flex;
  gap: 4px;
  background: rgba(2, 6, 18, 0.35);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 3px;
}

.ps-widget__toggle-btn {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 5px 6px;
  border-radius: var(--g-r-control);
  font-size: 12px;
  font-weight: 600;
  color: var(--g-text-3);
  background: transparent;
  transition: background var(--g-dur-fast) ease, color var(--g-dur-fast) ease;
}

.ps-widget__toggle-btn:disabled {
  cursor: default;
  opacity: 0.7;
}

/* Two color families across the options so hosted and self-hosted read as
   distinct kinds of choice, not a generic on/off toggle - info-blue for
   HOSTED services (Gero Cloud and Arkhia zkPaaS alike), the chain accent
   for the user's own machine (same accent the full /proof-server page's
   Local mode card already uses). */
.ps-widget__toggle-btn--remote.ps-widget__toggle-btn--active,
.ps-widget__toggle-btn--zkpaas.ps-widget__toggle-btn--active {
  background: color-mix(in srgb, var(--g-info) 16%, var(--g-raised));
  color: var(--g-info);
}

.ps-widget__toggle-btn--local.ps-widget__toggle-btn--active {
  background: color-mix(in srgb, var(--g-accent) 16%, var(--g-raised));
  color: var(--g-accent);
}

/* Selection feedback: a one-shot pop-in on the icon when its button becomes
   active, not a looping decorative animation (see the ratchet's motion
   rule) - it only plays once per selection change. */
.ps-widget__toggle-icon {
  transition: transform var(--g-dur-base) cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ps-widget__toggle-btn--active .ps-widget__toggle-icon {
  transform: scale(1.12);
}

/* Live connection pulse (Local only, only while actually detected) - same
   restrained pattern as the pool-operator node-status dot: opacity pulse on
   a small glowing dot, not a color-shift or a permanent decorative loop.
   Stops entirely (v-if unmounts it) the moment the connection is lost. */
.ps-widget__pulse-dot {
  position: absolute;
  top: 4px;
  right: 6px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--g-accent);
  box-shadow: 0 0 6px color-mix(in srgb, var(--g-accent) 70%, transparent);
  animation: ps-connection-pulse 2s ease-in-out infinite;
}

/* On the Arkhia segment the dot matches that segment's hosted (info) hue. */
.ps-widget__toggle-btn--zkpaas .ps-widget__pulse-dot {
  background: var(--g-info);
  box-shadow: 0 0 6px color-mix(in srgb, var(--g-info) 70%, transparent);
}

@keyframes ps-connection-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

@media (prefers-reduced-motion: reduce) {
  .ps-widget__toggle-icon { transition: none; }
  .ps-widget__pulse-dot { animation: none; }
}

.ps-widget__stats {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  /* Pin to the card bottom so the stats row aligns with the DUST battery's. */
  margin-top: auto;
}

.ps-widget__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ps-widget__stat .k {
  font-size: 11px;
  color: var(--g-text-3);
  white-space: nowrap;
}

.ps-widget__stat .v {
  font-family: var(--g-font-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--g-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ps-widget__stat .v--ok { color: var(--g-success); }
</style>
