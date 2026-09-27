<template>
  <figure class="realfi-yield">
    <figcaption class="realfi-yield__head">
      <span class="t-label">{{ $t('realfi.yield.title') }}</span>
      <span class="realfi-yield__avg">
        <span class="t-heading g-num">{{ avgLabel }}</span>
        <span class="t-caption">{{ $t('realfi.yield.avg') }}</span>
      </span>
    </figcaption>

    <!-- One series, one accent. The dashed line is the average the headline quotes, so
         the eye can see how far each day sat from it. -->
    <div class="realfi-yield__plot">
      <svg
        class="realfi-yield__chart"
        :viewBox="`0 0 ${W} ${H}`"
        preserveAspectRatio="none"
        role="img"
        :aria-label="ariaLabel"
      >
        <path class="realfi-yield__area" :d="areaPath" />
        <line
          class="realfi-yield__ref"
          x1="0"
          :x2="W"
          :y1="avgY"
          :y2="avgY"
          vector-effect="non-scaling-stroke"
        />
        <path class="realfi-yield__line" :d="linePath" vector-effect="non-scaling-stroke" />
      </svg>
      <!-- Outside the stretched SVG so it stays round at any width. -->
      <span class="realfi-yield__dot" :style="{ top: `${(lastY / H) * 100}%` }" aria-hidden="true" />
    </div>

    <div class="realfi-yield__foot t-caption">
      <span>{{ firstDate }}</span>
      <span class="g-num">{{ latestLabel }}</span>
    </div>
    <p class="t-caption realfi-yield__note">{{ $t('realfi.yield.note') }}</p>
  </figure>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import i18n from '@/plugins/i18n';
import type { RealFiApyPoint } from '../types';

/**
 * RealFi's published portfolio yield over the last 90 days, as a hairline area.
 *
 * Deliberately quiet: no axes, no gridlines, no hover. It answers one question — has
 * the yield been steady — and the two numbers that matter (the average and the latest
 * day, with its date) are printed, not left for the chart to imply.
 */
const props = defineProps<{
  history: RealFiApyPoint[];
  avgPercent: number;
}>();

const t = (key: string, values?: Record<string, unknown>) => i18n.t(key, values) as string;

const W = 300;
const H = 72;
/** Room above and below the series so the stroke and dot are never clipped. */
const PAD = 6;

const values = computed(() => props.history.map((p) => p.apyPercent));

/** The y-range, widened a little so a nearly flat series does not look volatile. */
const range = computed(() => {
  const all = [...values.value, props.avgPercent];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = Math.max(hi - lo, 0.5);
  const mid = (hi + lo) / 2;
  return { lo: mid - span * 0.6, hi: mid + span * 0.6 };
});

function y(value: number): number {
  const { lo, hi } = range.value;
  return PAD + (1 - (value - lo) / (hi - lo)) * (H - PAD * 2);
}

function x(i: number): number {
  const n = values.value.length;
  return n > 1 ? (i / (n - 1)) * W : W;
}

const points = computed(() => values.value.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`));
const linePath = computed(() => (points.value.length ? `M${points.value.join('L')}` : ''));
const areaPath = computed(() =>
  points.value.length ? `M0,${H}L${points.value.join('L')}L${W},${H}Z` : '',
);
const avgY = computed(() => y(props.avgPercent));
const lastY = computed(() => y(values.value[values.value.length - 1] ?? props.avgPercent));

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function shortDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(i18n.locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const avgLabel = computed(() => pct(props.avgPercent));
const latest = computed(() => props.history[props.history.length - 1]);
const firstDate = computed(() => shortDate(props.history[0]?.date));
const latestLabel = computed(() =>
  latest.value
    ? t('realfi.yield.latest', { rate: pct(latest.value.apyPercent), date: shortDate(latest.value.date) })
    : '',
);
const ariaLabel = computed(() =>
  t('realfi.yield.aria', {
    lo: pct(Math.min(...values.value)),
    hi: pct(Math.max(...values.value)),
    avg: avgLabel.value,
  }),
);
</script>

<style lang="scss" scoped>
.realfi-yield {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin: 0;
}

.realfi-yield__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.realfi-yield__avg {
  display: inline-flex;
  align-items: baseline;
  gap: var(--g-s-1);
  color: var(--g-text-1);
}

.realfi-yield__chart {
  display: block;
  width: 100%;
  height: 72px;
  overflow: visible;
}

.realfi-yield__area {
  fill: var(--g-partner-realfi);
  fill-opacity: 0.1;
}

.realfi-yield__line {
  fill: none;
  stroke: var(--g-partner-realfi);
  stroke-width: 1.5;
  stroke-linejoin: round;
}

.realfi-yield__ref {
  stroke: var(--g-hairline-3);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.realfi-yield__plot {
  position: relative;
}

/* The latest day, on the series' last point. */
.realfi-yield__dot {
  position: absolute;
  right: -3px;
  width: 6px;
  height: 6px;
  transform: translateY(-50%);
  background: var(--g-partner-realfi);
  border-radius: var(--g-r-pill);
  pointer-events: none;
}

.realfi-yield__foot {
  display: flex;
  justify-content: space-between;
  gap: var(--g-s-2);
}

.realfi-yield__note {
  margin: 0;
  color: var(--g-text-3);
}
</style>
