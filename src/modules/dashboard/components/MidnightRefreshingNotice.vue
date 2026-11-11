<template>
  <!-- "Refreshing" (midnightRefresh.ts): the wallet's Midnight data is being
       rebuilt, and the balances and history below are the last ones it knew,
       greyed. Renders nothing otherwise, so a parent's spacing class lands only
       on the notice. -->
  <section
    v-if="refreshing"
    class="refresh-notice"
    :class="stalled ? 'refresh-notice--stalled' : 'glass-panel'"
    data-test="midnight-refreshing"
  >
    <div class="refresh-notice__row">
      <v-icon
        size="20"
        :color="stalled ? 'warning' : undefined"
        class="refresh-notice__icon"
        aria-hidden="true"
      >{{ stalled ? 'mdi-wifi-alert' : 'mdi-refresh' }}</v-icon>
      <!-- Not a live region: this card comes and goes with the refresh. The notice
           slot's always-mounted region says the sentence (MidnightNoticeSlot.vue). -->
      <p class="refresh-notice__text t-body-sm" data-test="midnight-refreshing-text">{{ sentence }}</p>
      <span v-if="showProgress" class="refresh-notice__pct t-body-sm g-num" aria-hidden="true">{{ progress }}%</span>
    </div>
    <!-- Determinate only: shown when the sync service reports progress. -->
    <div
      v-if="showProgress"
      class="refresh-notice__track"
      role="progressbar"
      :aria-valuenow="progress ?? 0"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="sentence"
    >
      <i :style="{ width: `${progress}%` }" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useMidnightRefresh, useMidnightRefreshSentence } from '@/shared/composables/useMidnightRefresh';

const { refreshing, stalled, progress } = useMidnightRefresh();
const sentence = useMidnightRefreshSentence();
const showProgress = computed(() => !stalled.value && progress.value !== null);
</script>

<style scoped lang="scss">
/* A status card on the panel material: the accent glyph, the sentence, an optional determinate track. */
.refresh-notice {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-3) var(--g-s-4);
  border-radius: var(--g-r-card);
}

.refresh-notice__row {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-3);
}

/* Stalled: the muted warning pair, like the sibling banners (not the panel material). */
.refresh-notice--stalled {
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
}

.refresh-notice__icon {
  flex: none;
  margin-top: 2px;
  color: var(--g-accent);
}

.refresh-notice--stalled .refresh-notice__icon {
  color: var(--g-warning);
}

.refresh-notice__text {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--g-text-1);
}

.refresh-notice__pct {
  flex: none;
  color: var(--g-text-2);
}

/* A control, so a justified solid track; the accent fill. */
.refresh-notice__track {
  position: relative;
  height: 4px;
  overflow: hidden;
  border-radius: var(--g-r-pill);
  background: var(--g-raised);
}

.refresh-notice__track > i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: var(--g-accent);
  transition: width var(--g-dur-base) var(--g-ease);
}

@media (prefers-reduced-motion: reduce) {
  .refresh-notice__track > i {
    transition: none;
  }
}
</style>
