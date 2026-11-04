<template>
  <!-- Summary step: the two stages a sweep goes out in, and that one approval covers both. -->
  <section class="glass-tier sweep-timeline" :aria-labelledby="titleId">
    <div class="sweep-timeline__head">
      <!-- The dialog's title is not a heading, so this is the outline's first level. -->
      <h2 :id="titleId" class="t-body-sm sweep-timeline__title">{{ t('send.sweepHowItGoesOut') }}</h2>
      <span class="t-caption sweep-timeline__pill">{{ t('send.sweepPlanPill', { steps }) }}</span>
    </div>
    <!-- The list below is read row by row; this one sentence gives a screen reader the
         whole plan first, the way the markers and connector give it to the eye. -->
    <p class="d-sr-only">{{ t('send.sweepPlanSummary', { steps }) }}</p>
    <ol class="sweep-timeline__list">
      <li class="sweep-timeline__row sweep-timeline__row--merges">
        <span class="t-caption g-num sweep-timeline__marker" aria-hidden="true">{{ merges }}</span>
        <div class="sweep-timeline__text">
          <div class="t-body-sm sweep-timeline__label">{{ tc('send.sweepMergesStep', merges, { merges }) }}</div>
          <div class="t-caption sweep-timeline__detail">{{ t('send.sweepMergesStepNote', { count: utxoCount }) }}</div>
        </div>
        <span class="t-caption g-num sweep-timeline__fee">{{ mergeFee }}</span>
      </li>
      <li class="sweep-timeline__row">
        <span class="t-caption g-num sweep-timeline__marker sweep-timeline__marker--accent" aria-hidden="true">1</span>
        <div class="sweep-timeline__text">
          <div class="t-body-sm sweep-timeline__label">{{ t('send.sweepPaymentLabel') }}</div>
          <div class="t-caption sweep-timeline__detail">{{ t('send.sweepPaymentStepNote') }}</div>
        </div>
        <span class="t-caption g-num sweep-timeline__fee">{{ paymentFee }}</span>
      </li>
    </ol>
    <div class="sweep-timeline__note">
      <v-icon size="16" color="var(--g-text-3)" class="sweep-timeline__note-icon" aria-hidden="true">mdi-information-outline</v-icon>
      <p class="t-caption sweep-timeline__note-text">{{ t('send.sweepApproveOnce', { steps }) }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';

const props = defineProps<{
  /** Transactions the send goes out as: the merges plus the payment. */
  steps: number;
  /** UTxOs the sweep spends in all. */
  utxoCount: number;
  /** The merges' fees together, formatted with the currency symbol. */
  mergeFee: string;
  /** The payment's fee, formatted with the currency symbol. */
  paymentFee: string;
}>();

const { t, tc } = useTranslation();
const titleId = useId();
const merges = computed(() => Math.max(0, props.steps - 1));
</script>

<style scoped>
.sweep-timeline {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
  text-align: left;
}

.sweep-timeline__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
}

.sweep-timeline__title {
  margin: 0;
  color: var(--g-text-1);
  font-weight: 550;
}

.sweep-timeline__pill {
  color: var(--g-text-2);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-pill);
  padding: 2px var(--g-s-2);
  white-space: nowrap;
}

.sweep-timeline__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

/* The marker's size sets the column and the connector's place under it. */
.sweep-timeline__row {
  --sweep-marker: 28px;
  position: relative;
  display: grid;
  grid-template-columns: var(--sweep-marker) minmax(0, 1fr) auto;
  column-gap: var(--g-s-2);
  align-items: start;
}

/* The connector from the merges' marker down to the payment's. */
.sweep-timeline__row--merges {
  padding-bottom: var(--g-s-4);
}

.sweep-timeline__row--merges::before {
  content: '';
  position: absolute;
  left: calc(var(--sweep-marker) / 2);
  top: calc(var(--sweep-marker) + 2px);
  bottom: 2px;
  width: 1px;
  background: var(--g-hairline-2);
}

.sweep-timeline__marker {
  width: var(--sweep-marker);
  height: var(--sweep-marker);
  box-sizing: border-box;
  border-radius: var(--g-r-pill);
  border: 1px solid var(--g-hairline-3);
  display: grid;
  place-items: center;
  color: var(--g-text-2);
}

.sweep-timeline__marker--accent {
  border-color: var(--g-accent);
  color: var(--g-accent);
}

.sweep-timeline__text {
  min-width: 0;
}

.sweep-timeline__label {
  color: var(--g-text-1);
  font-weight: 550;
}

.sweep-timeline__detail {
  line-height: 1.5;
}

.sweep-timeline__fee {
  color: var(--g-text-2);
  white-space: nowrap;
}

.sweep-timeline__note {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-2);
}

.sweep-timeline__note-icon {
  flex: none;
  margin-top: 1px;
}

.sweep-timeline__note-text {
  margin: 0;
  line-height: 1.5;
}
</style>
