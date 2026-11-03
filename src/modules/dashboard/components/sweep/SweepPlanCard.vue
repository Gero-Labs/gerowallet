<template>
  <!-- Recipients step: how a Max over the request limit goes out. While the merges are
       being built it is a live region with a determinate bar; once built, the plan.
       Both states have the same four rows, and the texts that change share one cell
       each (the others hidden), so the card, and the centred dialog around it, keeps
       one height from the first merge built to the plan. -->
  <section
    class="glass-tier sweep-plan"
    :aria-label="title"
    :aria-live="preparing ? 'polite' : undefined"
  >
    <div class="sweep-plan__head">
      <v-progress-circular v-if="preparing" indeterminate size="18" width="2" color="var(--g-accent)" aria-hidden="true" />
      <v-icon v-else size="18" color="var(--g-accent)" aria-hidden="true">mdi-call-merge</v-icon>
      <span class="t-body-sm sweep-plan__title">{{ title }}</span>
      <span class="sweep-plan__aside sweep-plan__stack">
        <span class="t-caption g-num sweep-plan__count" :class="{ 'sweep-plan__hidden': !preparing }">{{ preparingCount }}</span>
        <span class="t-caption sweep-plan__pill" :class="{ 'sweep-plan__hidden': !!preparing }">{{ t('send.sweepOneApproval') }}</span>
      </span>
    </div>

    <div
      v-if="preparing"
      class="sweep-plan__track"
      role="progressbar"
      :aria-label="preparingCount"
      aria-valuemin="0"
      :aria-valuemax="preparing.total"
      :aria-valuenow="preparing.built"
    >
      <div class="sweep-plan__fill" :style="{ width: fillWidth }"></div>
    </div>
    <!-- One cell per merge and a wider one for the payment; past 24 cells the bar is
         only the two parts, since cells thinner than their gap read as noise. -->
    <div v-else class="sweep-plan__segments" aria-hidden="true" :style="{ gridTemplateColumns: segmentColumns }">
      <template v-if="segmented">
        <span v-for="n in merges" :key="n" class="sweep-plan__segment"></span>
      </template>
      <span v-else class="sweep-plan__segment"></span>
      <span class="sweep-plan__segment sweep-plan__segment--payment"></span>
    </div>

    <div class="sweep-plan__legend">
      <span class="t-caption">{{ tc('send.sweepMergesLabel', merges, { merges }) }}</span>
      <span class="t-caption sweep-plan__legend-payment">{{ t('send.sweepPaymentLabel') }}</span>
    </div>

    <div class="sweep-plan__notes sweep-plan__stack">
      <p class="t-caption sweep-plan__note" :class="{ 'sweep-plan__hidden': !preparing || preparing.waiting }">{{ t('send.sweepPreparingNote', { count: utxoCount }) }}</p>
      <p class="t-caption sweep-plan__note" :class="{ 'sweep-plan__hidden': !!preparing }">{{ t('send.sweepPlanNote', { count: utxoCount }) }}</p>
      <!-- A merge build is waiting out the server's request limit: the count stays, and the
           wait takes the explanation's place until the next merge lands. Mounted only then,
           so the live region announces it; the sizer below reserves its size meanwhile. -->
      <p v-if="preparing?.waiting" class="t-caption sweep-plan__note">{{ t('send.sweepPreparingWaiting') }}</p>
      <span class="t-caption sweep-plan__note sweep-plan__sizer" :data-sizer="t('send.sweepPreparingWaiting')" aria-hidden="true"></span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';

/** Cells drawn one per transaction; above this the bar shows merges and payment as two parts. */
const SEGMENT_CAP = 24;

const props = defineProps<{
  /** UTxOs the sweep spends in all. */
  utxoCount: number;
  /** Merge transactions before the payment. */
  merges: number;
  /**
   * Set while the merges are being built: how many are done out of how many the plan
   * has, and whether a build is waiting out the server's request limit.
   */
  preparing: { built: number; total: number; waiting?: boolean } | null;
}>();

const { t, tc } = useTranslation();

const steps = computed(() => (props.preparing ? props.preparing.total : props.merges) + 1);
const title = computed(() => t(props.preparing ? 'send.sweepPreparing' : 'send.sweepPlanTitle', { steps: steps.value }));
const preparingCount = computed(() => {
  const preparing = props.preparing;
  return preparing ? tc('send.sweepPreparingCount', preparing.total, { built: preparing.built, total: preparing.total }) : '';
});
const segmented = computed(() => props.merges + 1 <= SEGMENT_CAP);
const segmentColumns = computed(() => (segmented.value ? `repeat(${props.merges}, minmax(0, 1fr)) 3fr` : '3fr 1fr'));
const fillWidth = computed(() => {
  const total = props.preparing?.total ?? 0;
  if (total <= 0) return '0%';
  return `${Math.min(100, Math.round(((props.preparing?.built ?? 0) / total) * 100))}%`;
});
</script>

<style scoped>
.sweep-plan {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-3) var(--g-s-4);
  margin-top: var(--g-s-2);
  text-align: left;
}

.sweep-plan__head {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

.sweep-plan__title {
  flex: 1;
  min-width: 0;
  color: var(--g-text-1);
  font-weight: 550;
}

.sweep-plan__pill {
  color: var(--g-text-2);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-pill);
  padding: 2px var(--g-s-2);
  white-space: nowrap;
}

/* Texts that take turns share one grid cell; the cell is as tall and wide as the
   largest, whichever is showing. */
.sweep-plan__stack {
  display: grid;
}

.sweep-plan__stack > * {
  grid-area: 1 / 1;
}

/* Out of sight and out of the accessibility tree, but still sizing its cell. */
.sweep-plan__hidden {
  visibility: hidden;
}

/* Sizes its cell to a text drawn from an attribute, so the text never sits in the DOM. */
.sweep-plan__sizer {
  visibility: hidden;
}

.sweep-plan__sizer::before {
  content: attr(data-sizer);
}

.sweep-plan__aside {
  justify-items: end;
  align-items: center;
}

/* The track is a control (a bar), so a solid surface is right here. As tall as the
   plan's segments, so the bar row keeps its height when one replaces the other. */
.sweep-plan__track {
  height: 8px;
  background: var(--g-raised);
  border-radius: var(--g-r-pill);
  overflow: hidden;
}

.sweep-plan__fill {
  height: 100%;
  background: var(--g-accent);
  border-radius: var(--g-r-pill);
  transition: width var(--g-dur-base) var(--g-ease);
}

.sweep-plan__segments {
  display: grid;
  gap: var(--g-s-1);
  height: 8px;
}

.sweep-plan__segment {
  background: var(--g-hairline-3);
  border-radius: var(--g-r-chip);
}

.sweep-plan__segment--payment {
  background: var(--g-accent);
}

.sweep-plan__legend {
  display: flex;
  justify-content: space-between;
  gap: var(--g-s-2);
}

.sweep-plan__legend-payment {
  color: var(--g-text-1);
  text-align: right;
}

.sweep-plan__note {
  margin: 0;
  line-height: 1.5;
  color: var(--g-text-2);
}
</style>
