<template>
  <!-- Summary step actions: where a sweep is while it signs and sends, and where it stopped. -->
  <div v-if="view" class="sweep-progress">
    <!-- An alert announces itself; it sits outside the live region so it is not read twice. -->
    <div v-if="view.stop" class="sweep-progress__alert" role="alert">
      <v-icon size="18" color="var(--g-error)" class="sweep-progress__alert-icon" aria-hidden="true">mdi-alert-circle-outline</v-icon>
      <div class="sweep-progress__alert-body">
        <p class="t-body-sm sweep-progress__alert-title">{{ tt(view.stop.title) }}</p>
        <p class="t-caption sweep-progress__alert-text">{{ tt(view.stop.body) }}</p>
        <!-- Native disclosure: keyboard-operable with no script, and the reason stays in
             the DOM for anything that reads the page. -->
        <details class="sweep-progress__details">
          <summary class="t-caption sweep-progress__summary">{{ t('send.sweepShowDetails') }}</summary>
          <p class="g-mono sweep-progress__reason">{{ view.stop.reason }}</p>
        </details>
      </div>
    </div>

    <section class="glass-tier sweep-progress__panel" :aria-label="headline" aria-live="polite">
      <div v-if="view.title" class="sweep-progress__head">
        <v-progress-circular indeterminate size="20" width="2" color="var(--g-accent)" aria-hidden="true" />
        <span class="t-body sweep-progress__title">{{ tt(view.title) }}</span>
        <span v-if="view.count" class="t-caption g-num sweep-progress__count">{{ tt(view.count) }}</span>
      </div>

      <!-- One cell per transaction; past 24 of them a single bar says how many are out. -->
      <div v-if="segmented" class="sweep-progress__segments" aria-hidden="true" :style="{ gridTemplateColumns: segmentColumns }">
        <span
          v-for="(state, index) in view.segments"
          :key="index"
          class="sweep-progress__segment"
          :class="`sweep-progress__segment--${state}`"
        ></span>
      </div>
      <div
        v-else
        class="sweep-progress__track"
        role="progressbar"
        :aria-label="headline"
        aria-valuemin="0"
        :aria-valuemax="view.total"
        :aria-valuenow="doneCount"
      >
        <div class="sweep-progress__fill" :class="{ 'sweep-progress__fill--error': !!view.stop }" :style="{ width: fillWidth }"></div>
      </div>

      <ol class="sweep-progress__list">
        <li v-for="row in view.rows" :key="row.id" class="sweep-progress__row">
          <span class="sweep-progress__mark" :class="`sweep-progress__mark--${row.state}`" aria-hidden="true">
            <v-progress-circular v-if="row.state === 'active'" indeterminate size="18" width="2" color="var(--g-accent)" />
            <v-icon v-else-if="row.state === 'done'" size="12" color="var(--g-success)">mdi-check</v-icon>
            <v-icon v-else-if="row.state === 'error'" size="12" color="var(--g-error)">mdi-close</v-icon>
          </span>
          <div class="sweep-progress__text">
            <div class="t-body-sm sweep-progress__label" :class="{ 'sweep-progress__label--pending': row.state === 'pending' }">{{ tt(row.label) }}</div>
            <div class="t-caption g-num sweep-progress__detail">{{ tt(row.detail) }}</div>
          </div>
        </li>
      </ol>

      <p v-if="view.caption" class="t-caption sweep-progress__caption">{{ tt(view.caption) }}</p>
      <p v-else-if="view.stop" class="t-caption sweep-progress__caption">{{ tt(view.stop.tryAgain) }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { SweepProgress, SweepStop } from '@/shared/composables/useTransactionSigning';
import { sweepProgressView, type SweepText } from './sweepProgressView';

/** Cells drawn one per transaction; above this a single bar stands for them all. */
const SEGMENT_CAP = 24;

const props = defineProps<{
  /** Where the sweep is, from the signer's `onProgress`; null once it ends. */
  progress: SweepProgress | null;
  /** Where it stopped, from `onInterrupted`; cleared by the next attempt. */
  stop: SweepStop | null;
}>();

const { t, tc } = useTranslation();
const tt = (value: SweepText): string =>
  (value.choice === undefined ? t(value.key, value.params) : tc(value.key, value.choice, value.params));

const view = computed(() => sweepProgressView(props.progress, props.stop));
/** What the panel is about, for its label: the running title, or where the sweep stopped. */
const headline = computed(() => {
  const current = view.value;
  if (!current) return '';
  return tt(current.title ?? current.stop?.title ?? { key: 'send.sweepStoppedTitle' });
});
const segmented = computed(() => (view.value?.total ?? 0) <= SEGMENT_CAP);
const segmentColumns = computed(() => `repeat(${Math.max(0, (view.value?.total ?? 1) - 1)}, minmax(0, 1fr)) 3fr`);
const doneCount = computed(() => view.value?.segments.filter((state) => state === 'done').length ?? 0);
const fillWidth = computed(() => {
  const total = view.value?.total ?? 0;
  return total > 0 ? `${Math.round((doneCount.value / total) * 100)}%` : '0%';
});
</script>

<style scoped>
.sweep-progress {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  width: 100%;
  margin-bottom: var(--g-s-3);
  text-align: left;
}

/* ─── Stop banner ─── */
.sweep-progress__alert {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-2);
  padding: var(--g-s-3) var(--g-s-4);
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
  border-radius: var(--g-r-card);
}

.sweep-progress__alert-icon {
  flex: none;
  margin-top: 1px;
}

.sweep-progress__alert-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.sweep-progress__alert-title {
  margin: 0;
  color: var(--g-text-1);
  font-weight: 600;
}

.sweep-progress__alert-text {
  margin: 0;
  line-height: 1.5;
  color: var(--g-text-2);
}

.sweep-progress__summary {
  color: var(--g-accent);
  cursor: pointer;
  /* Drops the default triangle only; the focus ring below is drawn, never removed. */
  list-style: none;
}

.sweep-progress__summary::-webkit-details-marker {
  display: none;
}

/* baseline.css rings a, button, inputs and [tabindex]; `summary` is on none of those
   lists, so the same 2px accent ring is restated here. */
.sweep-progress__summary:focus-visible {
  outline: 2px solid var(--g-accent);
  outline-offset: 2px;
  border-radius: var(--g-r-control);
}

.sweep-progress__reason {
  margin: var(--g-s-2) 0 0;
}

/* ─── Progress panel ─── */
.sweep-progress__panel {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
}

.sweep-progress__head {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

.sweep-progress__title {
  flex: 1;
  min-width: 0;
  color: var(--g-text-1);
  font-weight: 550;
}

.sweep-progress__count {
  white-space: nowrap;
}

.sweep-progress__segments {
  display: grid;
  gap: var(--g-s-1);
  height: 8px;
}

.sweep-progress__segment {
  box-sizing: border-box;
  border-radius: var(--g-r-chip);
}

/* A cell is a control-sized mark, so the pending state may use a solid surface. */
.sweep-progress__segment--pending {
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
}

.sweep-progress__segment--done {
  background: var(--g-accent);
}

/* The one in flight: the accent, softened, with no motion of its own; the spinner
   beside the title is the feedback. */
.sweep-progress__segment--active {
  background: var(--g-accent);
  opacity: 0.6;
}

.sweep-progress__segment--error {
  background: var(--g-error);
}

.sweep-progress__track {
  height: 8px;
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-pill);
  overflow: hidden;
}

.sweep-progress__fill {
  height: 100%;
  background: var(--g-accent);
  border-radius: var(--g-r-pill);
  transition: width var(--g-dur-base) var(--g-ease);
}

.sweep-progress__fill--error {
  background: var(--g-error);
}

.sweep-progress__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}

.sweep-progress__row {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-2);
}

.sweep-progress__mark {
  flex: none;
  width: 20px;
  height: 20px;
  box-sizing: border-box;
  border-radius: var(--g-r-pill);
  display: grid;
  place-items: center;
}

.sweep-progress__mark--pending {
  border: 2px solid var(--g-hairline-3);
}

.sweep-progress__mark--done {
  background: var(--g-success-fill);
  border: 1px solid var(--g-success-line);
}

.sweep-progress__mark--error {
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
}

.sweep-progress__text {
  min-width: 0;
}

.sweep-progress__label {
  color: var(--g-text-1);
}

.sweep-progress__label--pending {
  color: var(--g-text-2);
}

.sweep-progress__detail {
  line-height: 1.5;
}

.sweep-progress__caption {
  margin: 0;
  line-height: 1.5;
  color: var(--g-text-2);
}
</style>
