<template>
  <figure class="realfi-trend">
    <figcaption class="realfi-trend__head">
      <span class="t-body-sm realfi-trend__title">{{ $t('realfi.reserves.trend.title') }}</span>
      <span class="t-caption realfi-trend__legend">
        <span v-if="navPoints.length" class="realfi-trend__key">
          <span class="realfi-trend__swatch realfi-trend__swatch--nav" aria-hidden="true" />
          {{ $t('realfi.reserves.trend.nav') }}
        </span>
        <span v-if="supplyPoints.length" class="realfi-trend__key">
          <span class="realfi-trend__swatch realfi-trend__swatch--supply" aria-hidden="true" />
          {{ $t('realfi.reserves.trend.supply') }}
        </span>
      </span>
    </figcaption>

    <!-- Two series on one dollar scale: NAV is struck weekly, circulation is daily, so
         the NAV line only bends where a strike lands and each strike gets a dot. -->
    <div class="realfi-trend__plot">
      <svg
        class="realfi-trend__chart"
        :viewBox="`0 0 ${W} ${H}`"
        preserveAspectRatio="none"
        role="img"
        :aria-label="ariaLabel"
      >
        <path v-if="navArea" class="realfi-trend__area" :d="navArea" />
        <path
          v-if="supplyLine"
          class="realfi-trend__supply"
          :d="supplyLine"
          vector-effect="non-scaling-stroke"
        />
        <path
          v-if="navLine"
          class="realfi-trend__nav"
          :d="navLine"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <!-- Outside the stretched SVG so they stay round at any width. -->
      <span
        v-for="dot in navDots"
        :key="dot.date"
        class="realfi-trend__dot"
        :style="{ left: `${dot.left}%`, top: `${dot.top}%` }"
        aria-hidden="true"
      />
    </div>

    <div class="realfi-trend__foot t-caption g-num">
      <span>{{ firstLabel }}</span>
      <span>{{ lastLabel }}</span>
    </div>
  </figure>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import i18n from '@/plugins/i18n';
import { shortDate } from '../reservesFormat';

/**
 * Net asset value and USDrf in circulation over the last 90 days.
 *
 * Quiet on purpose, like the yield chart: no axes and no hover. It answers whether the
 * two have moved together; the exact figures sit above it, each with its own date.
 */
const props = defineProps<{
  nav: { date: string; totalUsd: number }[];
  supply: { date: string; usdr: number }[];
}>();

const t = (key: string, values?: Record<string, unknown>) => i18n.t(key, values) as string;

const W = 600;
const H = 96;
/** Room above and below the series so the stroke and dots are never clipped. */
const PAD = 8;
const WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;

function dayMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

/** The window ends at the newest point of either series and reaches back 90 days. */
const dateWindow = computed(() => {
  const ends = [...props.nav, ...props.supply].map((p) => dayMs(p.date));
  const to = ends.length ? Math.max(...ends) : 0;
  return { from: to - WINDOW_DAYS * DAY_MS, to };
});

const navPoints = computed(() =>
  props.nav.filter((p) => dayMs(p.date) >= dateWindow.value.from).map((p) => ({ date: p.date, v: p.totalUsd })),
);
const supplyPoints = computed(() =>
  props.supply.filter((p) => dayMs(p.date) >= dateWindow.value.from).map((p) => ({ date: p.date, v: p.usdr })),
);

/** The x-range is the data's own span, so a feed younger than 90 days fills the width. */
const span = computed(() => {
  const all = [...navPoints.value, ...supplyPoints.value].map((p) => dayMs(p.date));
  return { from: Math.min(...all), to: Math.max(...all) };
});

/** One y-range for both, widened a little so a flat series does not look volatile. */
const range = computed(() => {
  const all = [...navPoints.value, ...supplyPoints.value].map((p) => p.v);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = Math.max(hi - lo, hi * 0.02) * 0.1;
  return { lo: lo - pad, hi: hi + pad };
});

function x(date: string): number {
  const { from, to } = span.value;
  return to > from ? ((dayMs(date) - from) / (to - from)) * W : W;
}

function y(value: number): number {
  const { lo, hi } = range.value;
  return PAD + (1 - (value - lo) / (hi - lo)) * (H - PAD * 2);
}

function path(points: { date: string; v: number }[]): string {
  if (points.length < 2) return '';
  return `M${points.map((p) => `${x(p.date).toFixed(2)},${y(p.v).toFixed(2)}`).join('L')}`;
}

const navLine = computed(() => path(navPoints.value));
const supplyLine = computed(() => path(supplyPoints.value));
const navArea = computed(() => {
  const pts = navPoints.value;
  if (pts.length < 2) return '';
  const first = x(pts[0]!.date).toFixed(2);
  const last = x(pts[pts.length - 1]!.date).toFixed(2);
  return `M${first},${H}L${navLine.value.slice(1)}L${last},${H}Z`;
});

const navDots = computed(() =>
  navPoints.value.map((p) => ({ date: p.date, left: (x(p.date) / W) * 100, top: (y(p.v) / H) * 100 })),
);

const firstLabel = computed(() => shortDate(new Date(span.value.from).toISOString().slice(0, 10)));
const lastLabel = computed(() => shortDate(new Date(span.value.to).toISOString().slice(0, 10)));
const ariaLabel = computed(() =>
  t('realfi.reserves.trend.aria', { from: firstLabel.value, to: lastLabel.value }),
);
</script>

<style lang="scss" scoped>
.realfi-trend {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin: 0;
}

.realfi-trend__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.realfi-trend__title {
  font-weight: 550;
  color: var(--g-text-1);
}

.realfi-trend__legend {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--g-s-4);
  color: var(--g-text-2);
}

.realfi-trend__key {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
}

.realfi-trend__swatch {
  width: 14px;
}

.realfi-trend__swatch--nav {
  border-top: 2px solid var(--g-partner-realfi);
}

.realfi-trend__swatch--supply {
  border-top: 2px dashed var(--g-text-3);
}

.realfi-trend__plot {
  position: relative;
}

.realfi-trend__chart {
  display: block;
  width: 100%;
  height: 96px;
  overflow: visible;
}

.realfi-trend__area {
  fill: var(--g-partner-realfi);
  fill-opacity: 0.08;
}

.realfi-trend__nav {
  fill: none;
  stroke: var(--g-partner-realfi);
  stroke-width: 1.5;
  stroke-linejoin: round;
}

.realfi-trend__supply {
  fill: none;
  stroke: var(--g-text-3);
  stroke-width: 1.5;
  stroke-dasharray: 4 4;
}

/* A NAV strike. */
.realfi-trend__dot {
  position: absolute;
  width: 6px;
  height: 6px;
  transform: translate(-50%, -50%);
  background: var(--g-partner-realfi);
  border-radius: var(--g-r-pill);
  pointer-events: none;
}

.realfi-trend__foot {
  display: flex;
  justify-content: space-between;
  gap: var(--g-s-2);
  color: var(--g-text-3);
}
</style>
