<template>
  <!-- Compact proof-server card for mini-Gero - same composable + mode/health
       state as the dashboard's MidnightProofServerWidget (never a separate
       copy of the logic), shrunk to mini-dust's single-card layout. -->
  <v-card flat class="liquid-glass mini-ps">
    <div class="mini-ps__row">
      <span class="mini-ps__label t-label">
        <v-icon x-small class="mr-1" color="var(--g-text-3)">mdi-server-security</v-icon>
        {{ t('midnight.proofServerPage.title') }}
      </span>
      <button type="button" class="mini-ps__link" @click="openFullPage">
        {{ t('midnight.proofServerPage.openPage') }}
        <v-icon size="11">mdi-chevron-right</v-icon>
      </button>
    </div>

    <div class="mini-ps__toggle" role="group" :aria-label="t('midnight.proofServerPage.title')">
      <button
        type="button"
        class="mini-ps__toggle-btn mini-ps__toggle-btn--remote"
        :class="{ 'mini-ps__toggle-btn--active': proofServerMode === 'remote' }"
        :disabled="proofServerSaving"
        @click="proofServerMode = 'remote'"
      >
        <v-icon size="12">mdi-cloud-outline</v-icon>
        {{ t('midnight.proofServerPage.compareRemoteTitle') }}
      </button>
      <button
        type="button"
        class="mini-ps__toggle-btn mini-ps__toggle-btn--zkpaas"
        :class="{ 'mini-ps__toggle-btn--active': proofServerMode === 'zkpaas' }"
        :disabled="proofServerSaving"
        @click="proofServerMode = 'zkpaas'"
      >
        <v-icon size="12">mdi-google-cloud</v-icon>
        {{ t('midnight.proofServerPage.compareZkpaasTitle') }}
        <span v-if="proofServerMode === 'zkpaas' && healthStatus === 'detected'" class="mini-ps__pulse-dot" />
      </button>
      <button
        type="button"
        class="mini-ps__toggle-btn mini-ps__toggle-btn--local"
        :class="{ 'mini-ps__toggle-btn--active': proofServerMode === 'local' }"
        :disabled="proofServerSaving"
        @click="proofServerMode = 'local'"
      >
        <v-icon size="12">mdi-laptop</v-icon>
        {{ t('midnight.proofServerPage.compareLocalTitle') }}
        <span v-if="proofServerMode === 'local' && healthStatus === 'detected'" class="mini-ps__pulse-dot" />
      </button>
    </div>

    <div class="mini-ps__sub">
      <span :class="{ 'mini-ps__sub--ok': proofServerMode !== 'remote' && healthStatus === 'detected' }">
        {{ statusValue }}
      </span>
      <span v-if="latencyValue"> · {{ latencyValue }}</span>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useMidnightProofServer } from '@/chains/midnight/useProofServerSettings';

const { t } = useTranslation();

const {
  proofServerMode,
  proofServerSaving,
  healthStatus,
  lastCheckLatencyMs,
} = useMidnightProofServer();

// Same gating logic as the dashboard widget: no fabricated "connected" state
// for Gero Cloud, since it is never health-checked from the wallet. Local
// and Arkhia zkPaaS are, so both surface live health.
const statusValue = computed(() => {
  if (proofServerMode.value === 'remote') return t('midnight.proofServerPage.compareRemoteTitle');
  if (healthStatus.value === 'detected') return t('midnight.proofServerPage.statusDetectedShort');
  if (healthStatus.value === 'notDetected') return t('midnight.proofServer.statusNotDetected');
  if (healthStatus.value === 'notConfigured') return t('midnight.proofServerPage.statusNotConfiguredShort');
  return t('midnight.proofServer.statusChecking');
});

const latencyValue = computed(() => {
  if (proofServerMode.value === 'remote' || lastCheckLatencyMs.value === null) return '';
  return `${lastCheckLatencyMs.value}ms`;
});

function openFullPage() {
  window.open(chrome.runtime.getURL('index.html#/proof-server'), '_blank');
}
</script>

<style scoped>
/* Background/border/radius come from the global .liquid-glass card styles,
   same as mini-dust. */
.mini-ps {
  margin: 0 16px 12px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.mini-ps__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

/* Type comes from the shared .t-label class (template) - reuses baseline.css's
   canonical small-caps label style (imported by sidepanel/main.ts) instead of
   a second from-scratch uppercase declaration. */
.mini-ps__label {
  display: flex;
  align-items: center;
}

.mini-ps__link {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  color: var(--g-text-3);
  background: transparent;
}

.mini-ps__link:hover {
  color: var(--g-text-1);
}

.mini-ps__toggle {
  display: flex;
  gap: 4px;
  background: rgba(2, 6, 18, 0.35);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 3px;
}

.mini-ps__toggle-btn {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 6px;
  border-radius: var(--g-r-control);
  font-size: 11px;
  font-weight: 600;
  color: var(--g-text-3);
  background: transparent;
  transition: background var(--g-dur-fast) ease, color var(--g-dur-fast) ease;
}

.mini-ps__toggle-btn:disabled {
  cursor: default;
  opacity: 0.7;
}

/* Same color identity as the dashboard widget: info-blue for the hosted
   services (Gero Cloud + Arkhia zkPaaS), the chain accent for the user's
   own machine. */
.mini-ps__toggle-btn--remote.mini-ps__toggle-btn--active,
.mini-ps__toggle-btn--zkpaas.mini-ps__toggle-btn--active {
  background: color-mix(in srgb, var(--g-info) 16%, var(--g-raised));
  color: var(--g-info);
}

.mini-ps__toggle-btn--local.mini-ps__toggle-btn--active {
  background: color-mix(in srgb, var(--g-accent) 16%, var(--g-raised));
  color: var(--g-accent);
}

/* Live connection pulse (Local only, only while actually detected) - same
   restrained, state-gated pattern as the dashboard widget and the
   pool-operator node-status dot; not a decorative loop. */
.mini-ps__pulse-dot {
  position: absolute;
  top: 3px;
  right: 5px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--g-accent);
  box-shadow: 0 0 5px color-mix(in srgb, var(--g-accent) 70%, transparent);
  animation: mini-ps-connection-pulse 2s ease-in-out infinite;
}

/* On the Arkhia segment the dot matches that segment's hosted (info) hue. */
.mini-ps__toggle-btn--zkpaas .mini-ps__pulse-dot {
  background: var(--g-info);
  box-shadow: 0 0 5px color-mix(in srgb, var(--g-info) 70%, transparent);
}

@keyframes mini-ps-connection-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.mini-ps__sub {
  font-size: 10px;
  color: var(--g-text-3);
  font-family: var(--g-font-mono);
}

.mini-ps__sub--ok {
  color: var(--g-success);
}

@media (prefers-reduced-motion: reduce) {
  .mini-ps__pulse-dot { animation: none; }
}
</style>
