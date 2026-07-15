<template>
  <!-- Empty-wallet hero: the asset the user is about to buy, in the exact slot
       the portfolio chart occupies once they own it. Shared glass-panel
       material (user request 2026-07-15), surface styling owned by
       liquid-glass.css. A plain div, not v-card, so no Vuetify cascade fight. -->
  <div class="fill-height d-flex flex-column glass-panel ada-hero">
    <div class="ada-hero__header">
      <div>
        <span class="t-heading">{{ $t('assets.cardano') }}</span>
        <span class="ada-hero__ticker g-mono">ADA</span>
      </div>
      <div class="ada-hero__pricing g-num">
        <span class="ada-hero__price">{{ priceLabel }}</span>
        <span v-if="changeLabel" :class="['ada-hero__delta', change > 0 ? 'delta-up' : change < 0 ? 'delta-down' : '']">
          {{ changeLabel }}
        </span>
      </div>
    </div>

    <div class="ada-hero__chart-wrap flex-grow-1">
      <div ref="chartEl" class="ada-hero__chart"></div>
      <!-- Crosshair tooltip: direct DOM writes from subscribeCrosshairMove for
           zero-lag tracking (same pattern as PortfolioChart). -->
      <div ref="tooltipEl" class="ada-hero__tooltip" style="display: none;">
        <div class="ada-hero__tooltip-date g-mono"></div>
        <div class="ada-hero__tooltip-value g-num"></div>
      </div>
      <div v-if="noData" class="ada-hero__no-data t-caption">{{ $t('market.noChartData') }}</div>
    </div>

    <div class="ada-hero__ranges">
      <button
        v-for="r in RANGES"
        :key="r.key"
        type="button"
        :class="['ada-hero__range', 'g-mono', { 'ada-hero__range--active': r.key === activeRange }]"
        @click="setRange(r.key)"
      >
        {{ r.label }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, toRefs } from 'vue';
import { createChart, AreaSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, AreaData, Time, SolidColor, MouseEventParams } from 'lightweight-charts';
import { useMarketData } from '@/modules/market/composables/useMarketData';
import { walletStore } from '@/stores/walletStore';
import { chainAccents, chainKeyFor } from '@/config/themes';
import { formatPrice, formatSignedChange } from '@/shared/utils/format';

const { adaData, getTokenCandles } = useMarketData();
const { loggedWallet } = toRefs(walletStore);

// ── Price header ──────────────────────────────────────────────────────────────

const price = computed(() => adaData.value?.priceUsd ?? null);
const change = computed(() => adaData.value?.priceChange24h ?? 0);
const priceLabel = computed(() => (price.value != null ? formatPrice(price.value) : '—'));
const changeLabel = computed(() => (adaData.value ? formatSignedChange(change.value) : ''));

// ── Range pills ───────────────────────────────────────────────────────────────
// Candle timeframes reuse getTokenCandles' backend mapping ('15m'/'1h'/'1D');
// the fetch returns the full lookback window, so each range slices client-side.

const RANGES = [
  { key: '24h', label: '24H', timeframe: '15m', windowSec: 24 * 3600 },
  { key: '7d', label: '7D', timeframe: '1h', windowSec: 7 * 86400 },
  { key: '30d', label: '30D', timeframe: '1h', windowSec: 30 * 86400 },
  { key: '1y', label: '1Y', timeframe: '1d', windowSec: 365 * 86400 },
] as const;

type RangeKey = typeof RANGES[number]['key'];
const activeRange = ref<RangeKey>('7d');
const noData = ref(false);

function setRange(key: RangeKey) {
  if (key === activeRange.value) return;
  activeRange.value = key;
  loadRange();
}

// ── Chart ─────────────────────────────────────────────────────────────────────

const chartEl = ref<HTMLElement | null>(null);
const tooltipEl = ref<HTMLElement | null>(null);
let chart: IChartApi | null = null;
let series: ISeriesApi<'Area'> | null = null;
let resizeObserver: ResizeObserver | null = null;
let initRetryTimer: ReturnType<typeof setTimeout> | null = null;
let requestId = 0;
// Latest fetched series, buffered so data that arrives while initChart is
// still retrying (zero-size mount) isn't lost.
let lastPoints: AreaData<Time>[] | null = null;

const chartTheme = computed(() => {
  const hex = chainAccents[chainKeyFor(loggedWallet.value?.chain)].accent;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { line: hex, topFill: `rgba(${r}, ${g}, ${b}, 0.3)`, bottomFill: `rgba(${r}, ${g}, ${b}, 0)` };
});

function initChart() {
  if (!chartEl.value || chart) return;
  const width = chartEl.value.clientWidth;
  const height = chartEl.value.clientHeight;
  if (!width || !height) {
    // Mounted before layout settled — retry, same pattern as PortfolioChart.
    initRetryTimer = setTimeout(() => initChart(), 100);
    return;
  }

  chart = createChart(chartEl.value, {
    width,
    height,
    layout: {
      attributionLogo: false,
      background: { type: 'solid' as const, color: 'transparent' } as SolidColor,
      textColor: 'rgba(255, 255, 255, 0.35)',
      fontFamily: 'Inter Variable, Inter, sans-serif',
    },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    rightPriceScale: {
      visible: true,
      borderVisible: false,
      scaleMargins: { top: 0.15, bottom: 0.05 },
      textColor: 'rgba(255, 255, 255, 0.35)',
    },
    timeScale: { visible: false, fixLeftEdge: true, fixRightEdge: true },
    crosshair: {
      mode: 1,
      vertLine: { color: 'rgba(255, 255, 255, 0.15)', width: 1, style: 2, labelVisible: false },
      horzLine: { color: 'rgba(255, 255, 255, 0.15)', width: 1, style: 2, labelVisible: false },
    },
    handleScroll: false,
    handleScale: false,
  });

  series = chart.addSeries(AreaSeries, {
    lineColor: chartTheme.value.line,
    lineWidth: 2,
    lineType: 2,
    topColor: chartTheme.value.topFill,
    bottomColor: chartTheme.value.bottomFill,
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 4,
    priceLineVisible: false,
    lastValueVisible: false,
    priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
  });

  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width: w, height: h } = entry.contentRect;
      if (w > 0 && h > 0 && chart) chart.applyOptions({ width: w, height: h });
    }
  });
  resizeObserver.observe(chartEl.value);

  chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
    const el = tooltipEl.value;
    if (!el || !series) return;

    if (!param.point || !param.time || !param.seriesData || param.seriesData.size === 0) {
      el.style.display = 'none';
      return;
    }

    const data = param.seriesData.get(series) as AreaData<Time> | undefined;
    if (!data || data.value === undefined) {
      el.style.display = 'none';
      return;
    }

    const timestamp = typeof param.time === 'number' ? param.time * 1000 : 0;
    if (timestamp > 0) {
      const date = new Date(timestamp);
      el.children[0].textContent = date.toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
      }) + ' ' + date.toLocaleTimeString(undefined, {
        hour: '2-digit', minute: '2-digit',
      });
    }
    el.children[1].textContent = formatPrice(data.value as number);

    // Position via transform (GPU composited); flip sides near the right edge.
    const wrap = chartEl.value;
    if (wrap) {
      const tooltipWidth = 132;
      const tx = param.point.x + 14 + tooltipWidth > wrap.clientWidth
        ? param.point.x - tooltipWidth - 14
        : param.point.x + 14;
      const ty = Math.max(0, Math.min(param.point.y - 20, wrap.clientHeight - 44));
      el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      el.style.display = 'block';
    }
  });

  // Apply data that landed while init was still waiting on layout.
  if (lastPoints && series) {
    series.setData(lastPoints);
    chart.timeScale().fitContent();
  }
}

async function loadRange() {
  const range = RANGES.find(r => r.key === activeRange.value);
  if (!range) return;
  const id = ++requestId;
  try {
    const candles = await getTokenCandles('lovelace', range.timeframe, 'usd');
    if (id !== requestId) return; // stale response — a newer range is loading
    const cutoff = Math.floor(Date.now() / 1000) - range.windowSec;
    const points: AreaData<Time>[] = candles
      .filter(c => c.time >= cutoff && c.close != null)
      .map(c => ({ time: c.time as Time, value: c.close }));
    noData.value = points.length === 0;
    lastPoints = points;
    if (series) {
      series.setData(points);
      chart?.timeScale().fitContent();
    }
  } catch {
    if (id === requestId) noData.value = true;
  }
}

onMounted(() => {
  initChart();
  loadRange();
});

onBeforeUnmount(() => {
  if (initRetryTimer) clearTimeout(initRetryTimer);
  initRetryTimer = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  chart?.remove();
  chart = null;
  series = null;
});
</script>

<style scoped>
/* Surface (background/border/radius) comes from the shared .glass-panel
   material; only layout lives here. */
.ada-hero {
  padding: var(--g-s-3) var(--g-s-4);
}

.ada-hero__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.ada-hero__ticker {
  font-size: 12px;
  color: var(--g-text-3);
  margin-left: 8px;
}

.ada-hero__pricing {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.ada-hero__price {
  font-size: 20px;
  font-weight: 600;
  color: var(--g-text-1);
}

.ada-hero__delta {
  font-size: 13px;
}

.ada-hero__chart-wrap {
  position: relative;
  min-height: 0;
  margin-top: var(--g-s-2);
}

.ada-hero__chart {
  position: absolute;
  inset: 0;
}

.ada-hero__no-data {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ada-hero__tooltip {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  pointer-events: none;
  padding: 6px 10px;
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  white-space: nowrap;
}

.ada-hero__tooltip-date {
  font-size: 10px;
  color: var(--g-text-3);
}

.ada-hero__tooltip-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-1);
}

.ada-hero__ranges {
  display: flex;
  gap: var(--g-s-1);
  margin-top: var(--g-s-2);
}

.ada-hero__range {
  appearance: none;
  background: none;
  border: none;
  font-family: var(--g-font-mono);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--g-r-chip);
  color: var(--g-text-3);
  cursor: pointer;
  transition: color var(--g-dur-fast) var(--g-ease), background var(--g-dur-fast) var(--g-ease);
}

.ada-hero__range:hover { color: var(--g-text-1); }

.ada-hero__range--active {
  color: var(--g-accent);
  background: color-mix(in srgb, var(--g-accent) 12%, transparent);
}
</style>
