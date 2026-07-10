<template>
  <div class="vpc-root">
    <!-- Period Selector -->
    <div class="vpc-periods">
      <button
        v-for="p in periods"
        :key="p"
        :class="['vpc-period-btn', { 'vpc-period-btn--active': activePeriod === p }]"
        @click="selectPeriod(p)"
      >
        {{ p }}
      </button>
    </div>

    <!-- Chart Area -->
    <div class="vpc-chart-wrap">
      <!-- Loading skeleton -->
      <div v-if="loading" class="vpc-loading">
        <div class="vpc-skeleton-line" />
        <div class="vpc-skeleton-line vpc-skeleton-line--short" />
      </div>

      <!-- No data -->
      <div v-else-if="!chartPoints.length" class="vpc-empty">
        <v-icon size="28" color="var(--g-text-3)">mdi-chart-line-variant</v-icon>
        <span class="vpc-empty__text">{{ $t('vaults.noData') }}</span>
      </div>

      <!-- SVG Chart -->
      <svg v-else ref="svgEl" class="vpc-svg" :viewBox="`0 0 ${SVG_W} ${SVG_H}`" preserveAspectRatio="none">
        <defs>
          <linearGradient id="vpc-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style="stop-color: var(--g-accent)" stop-opacity="0.25" />
            <stop offset="100%" style="stop-color: var(--g-accent)" stop-opacity="0.01" />
          </linearGradient>
          <clipPath id="vpc-clip">
            <rect x="0" y="0" :width="SVG_W" :height="SVG_H" />
          </clipPath>
        </defs>

        <!-- Horizontal grid lines -->
        <line
          v-for="y in gridYs"
          :key="y"
          :x1="0" :y1="y" :x2="SVG_W" :y2="y"
          style="stroke: var(--g-hairline-1)"
          stroke-width="1"
        />

        <!-- Fill area -->
        <polygon
          :points="fillPoints"
          fill="url(#vpc-grad)"
          clip-path="url(#vpc-clip)"
        />

        <!-- Line -->
        <polyline
          :points="linePoints"
          fill="none"
          style="stroke: var(--g-accent)"
          stroke-width="1.5"
          stroke-linejoin="round"
          stroke-linecap="round"
          clip-path="url(#vpc-clip)"
        />

        <!-- Hover dot (always show last point) -->
        <circle
          v-if="chartPoints.length"
          :cx="chartPoints[chartPoints.length - 1].x"
          :cy="chartPoints[chartPoints.length - 1].y"
          r="3"
          style="fill: var(--g-accent)"
          opacity="0.9"
        />
      </svg>

      <!-- Y-axis labels -->
      <div v-if="chartPoints.length" class="vpc-ylabels">
        <span class="vpc-ylabel">{{ formatTvl(yMax) }}</span>
        <span class="vpc-ylabel">{{ formatTvl(yMid) }}</span>
        <span class="vpc-ylabel">{{ formatTvl(yMin) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { VaultPeriod } from '@/api/strike-v2.types';

// ── Props & Emits ─────────────────────────────────────────────────────────────
const props = defineProps<{
  /** Array of [timestamp, tvl, pnl, fees] tuples */
  history: Array<[number, number, number, number]>;
  loading: boolean;
}>();

const emit = defineEmits<{
  (e: 'period-change', period: VaultPeriod): void;
}>();

// ── Constants ─────────────────────────────────────────────────────────────────
const SVG_W = 400;
const SVG_H = 100;
const PAD_X = 4;
const PAD_Y = 8;

const periods: VaultPeriod[] = ['24h', '7d', '30d', '6m', '1y', 'all'];
const activePeriod = ref<VaultPeriod>('30d');

// ── Computed: chart data ───────────────────────────────────────────────────────
const chartPoints = computed(() => {
  const data = props.history;
  if (!data || data.length < 2) return [];

  const tvlValues = data.map((d) => d[1]);
  const minV = Math.min(...tvlValues);
  const maxV = Math.max(...tvlValues);
  const range = maxV - minV || 1;

  const minT = data[0][0];
  const maxT = data[data.length - 1][0];
  const timeRange = maxT - minT || 1;

  return data.map(([ts, tvl]) => ({
    x: PAD_X + ((ts - minT) / timeRange) * (SVG_W - PAD_X * 2),
    y: PAD_Y + (1 - (tvl - minV) / range) * (SVG_H - PAD_Y * 2),
    tvl,
  }));
});

const linePoints = computed(() =>
  chartPoints.value.map((p) => `${p.x},${p.y}`).join(' ')
);

const fillPoints = computed(() => {
  if (!chartPoints.value.length) return '';
  const pts = chartPoints.value.map((p) => `${p.x},${p.y}`).join(' ');
  const first = chartPoints.value[0];
  const last = chartPoints.value[chartPoints.value.length - 1];
  return `${first.x},${SVG_H} ${pts} ${last.x},${SVG_H}`;
});

const gridYs = computed(() => [PAD_Y, SVG_H / 2, SVG_H - PAD_Y]);

const yMin = computed(() => {
  if (!props.history.length) return 0;
  return Math.min(...props.history.map((d) => d[1]));
});
const yMax = computed(() => {
  if (!props.history.length) return 0;
  return Math.max(...props.history.map((d) => d[1]));
});
const yMid = computed(() => (yMin.value + yMax.value) / 2);

// ── Methods ───────────────────────────────────────────────────────────────────
function selectPeriod(p: VaultPeriod) {
  activePeriod.value = p;
  emit('period-change', p);
}

function formatTvl(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
</script>

<style scoped>
/* ── Root ── */
.vpc-root {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── Period Buttons ── */
.vpc-periods {
  display: flex;
  gap: 4px;
}

.vpc-period-btn {
  padding: 3px 8px;
  border-radius: var(--g-r-chip);
  border: 1px solid var(--g-hairline-2);
  background: transparent;
  color: var(--g-text-3);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.vpc-period-btn:hover {
  border-color: color-mix(in srgb, var(--g-accent) 35%, transparent);
  color: color-mix(in srgb, var(--g-accent) 70%, transparent);
}

.vpc-period-btn--active {
  background: color-mix(in srgb, var(--g-accent) 12%, transparent) !important;
  border-color: color-mix(in srgb, var(--g-accent) 40%, transparent) !important;
  color: var(--g-accent) !important;
}

/* ── Chart Wrapper ── */
.vpc-chart-wrap {
  position: relative;
  height: 100px;
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  overflow: hidden;
}

/* ── SVG ── */
.vpc-svg {
  position: absolute;
  inset: 0;
  width: calc(100% - 40px);
  height: 100%;
}

/* ── Y-labels ── */
.vpc-ylabels {
  position: absolute;
  right: 6px;
  top: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 6px 0;
  pointer-events: none;
}

.vpc-ylabel {
  font-size: 11px;
  font-family: var(--g-font-mono);
  color: var(--g-text-3);
  line-height: 1;
}

/* ── Loading Skeleton ── */
.vpc-loading {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  padding: 20px 16px;
  height: 100%;
}

.vpc-skeleton-line {
  height: 8px;
  border-radius: 4px;
  background: linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.05) 75%);
  background-size: 200% 100%;
  animation: vpc-shimmer 1.4s infinite;
}

.vpc-skeleton-line--short {
  width: 60%;
}

@keyframes vpc-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ── Empty State ── */
.vpc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 6px;
}

.vpc-empty__text {
  font-size: 11px;
  color: var(--g-text-3);
}
</style>
