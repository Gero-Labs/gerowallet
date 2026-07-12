<template>
  <!-- Same `.portfolio-split-root` shape as Cardano's PortfolioChart so the
       hero row reads identically across chains. -->
  <div class="portfolio-split-root">
    <!-- Left Panel: Portfolio Metrics (30%) — mirror of Cardano's metrics panel -->
    <div class="portfolio-metrics-panel">
      <div class="metrics-inner">
        <div class="metrics-header-row">
          <div class="portfolio-label t-label">{{ $t('dashboard.portfolio') }}</div>
          <v-spacer />
          <v-btn icon x-small @click="$emit('refresh')">
            <v-icon small>mdi-refresh</v-icon>
          </v-btn>
        </div>

        <div class="portfolio-amount">
          <span v-if="hideBalances" class="portfolio-amount-masked">••••••</span>
          <v-skeleton-loader v-else-if="midnightLoading" type="heading" width="150" />
          <span v-else class="portfolio-amount-visible">
            {{ formatNight(totalNight) }} <span class="currency-symbol">{{ nightCurrency }}</span>
          </span>
        </div>

        <div class="address-section" v-if="shortenedAddress">
          <CopyButton
            :title="shortenedAddress"
            :value="unshieldedAddress"
            x-small
          />
        </div>

        <v-divider class="my-1" style="opacity: 0.15" />

        <!-- Breakdown stats: NIGHT subtypes + DUST. -->
        <div class="pnl-column">
          <div class="pnl-item">
            <span class="pnl-label">{{ $t('midnight.unshielded') }}</span>
            <v-skeleton-loader v-if="midnightLoading && !hideBalances" type="text" width="90" />
            <span v-else class="pnl-value" :style="{ color: 'var(--g-success)' }">
              {{ hideBalances ? '••••' : formatNight(balances.nightUnshielded ?? 0n) + ' ' + nightCurrency }}
            </span>
          </div>
          <div class="pnl-item">
            <span class="pnl-label">{{ $t('midnight.shielded') }}</span>
            <v-skeleton-loader v-if="midnightLoading && !hideBalances" type="text" width="90" />
            <span v-else class="pnl-value" :style="{ color: 'var(--g-text-1)' }">
              {{ hideBalances ? '••••' : formatNight(balances.nightShielded ?? 0n) + ' ' + nightCurrency }}
            </span>
          </div>
          <div class="pnl-item">
            <span class="pnl-label">{{ $t('midnight.registered') }}</span>
            <v-skeleton-loader v-if="midnightLoading && !hideBalances" type="text" width="90" />
            <span v-else class="pnl-value" :style="{ color: registrationColor }">
              {{ hideBalances ? '••••' : formatNight(balances.nightRegistered ?? 0n) + ' ' + nightCurrency }}
            </span>
          </div>
          <!-- tDUST intentionally not listed here — the dedicated DUST battery
               panel below the hero row owns the live DUST display. -->
        </div>
      </div>
    </div>

    <!-- Right Panel: Chart (70%). Real `lightweight-charts` AreaSeries fed by
         the running NIGHT balance derived from tx history. Same chart engine
         and visual styling as Cardano's PortfolioChart. -->
    <div class="portfolio-chart-panel">
      <div class="chart-controls-bar">
        <div class="timeframe-pills">
          <button
            v-for="tf in timeframes"
            :key="tf"
            class="timeframe-pill"
            :class="{ active: selectedTimeframe === tf }"
            @click="selectedTimeframe = tf"
          >
            {{ tf }}
          </button>
        </div>
      </div>

      <div class="chart-area">
        <div ref="chartContainerRef" v-show="hasChartData" class="lw-chart-container"></div>
        <div v-if="!hasChartData" class="empty-state text-center">
          <v-icon size="20" color="grey">mdi-chart-line</v-icon>
          <span class="ml-2" style="color: var(--g-text-3); font-size: 12px;">
            {{ $t('midnight.chartNoData') }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, toRefs, watch, nextTick } from 'vue';
import { createChart, AreaSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, AreaData, UTCTimestamp, SolidColor } from 'lightweight-charts';
import CopyButton from '@/shared/components/CopyButton.vue';
import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import type { MidnightTransaction } from '@/chains/midnight/midnightTypes';
import { useMidnightLoading } from '@/shared/composables/useMidnightLoading';

defineEmits<{ (e: 'refresh'): void }>();

const { addresses, balances, dustState, transactions } = toRefs(midnightStore);
const { loggedWallet } = toRefs(walletStore);
const hideBalances = computed(() => walletStore.config?.hideBalances || false);
const midnightLoading = useMidnightLoading();

const isMainnet = computed(() => loggedWallet.value?.network === Network.MAINNET);
const nightCurrency = computed(() => (isMainnet.value ? 'NIGHT' : 'tNIGHT'));

const NIGHT_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.NIGHT);

// ── Timeframe selection ──────────────────────────────────────────────────────
const timeframes = ['24H', '7D', '1M', '3M', '1Y'] as const;
type Timeframe = typeof timeframes[number];
const selectedTimeframe = ref<Timeframe>('1M');

const timeframeWindowMs: Record<Timeframe, number> = {
  '24H': 24 * 60 * 60 * 1000,
  '7D':  7 * 24 * 60 * 60 * 1000,
  '1M':  30 * 24 * 60 * 60 * 1000,
  '3M':  90 * 24 * 60 * 60 * 1000,
  '1Y':  365 * 24 * 60 * 60 * 1000,
};

// ── Computed values ──────────────────────────────────────────────────────────
// `nightRegistered` is a SUBSET of `nightUnshielded` (the portion already
// registered for DUST generation), not a separate pile. Summing all three
// double-counted the registered amount — total = unshielded + shielded.
const totalNight = computed<bigint>(() =>
  (balances.value.nightUnshielded ?? 0n) +
  (balances.value.nightShielded ?? 0n),
);

const unshieldedAddress = computed(() => addresses.value?.unshielded ?? loggedWallet.value?.baseAddress ?? '');
const shortenedAddress = computed(() => {
  const a = unshieldedAddress.value;
  if (!a) return '';
  if (a.length <= 16) return a;
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
});

const registrationColor = computed(() => {
  switch (dustState.value?.registrationStatus) {
    case 'Registered': return 'var(--g-success)';
    case 'Pending': return 'var(--g-warning)';
    case 'Invalid': return 'var(--g-error)';
    default: return 'var(--g-text-1)';
  }
});

// ── Chart data derivation ────────────────────────────────────────────────────
//
// Walk transactions BACKWARD from the current balance: latest data point = the
// store's current NIGHT total, then for each tx going back in time we reverse
// its delta to compute the prior balance. This guarantees the rightmost point
// always matches the live store value, with no drift from historical gaps.
//
// `register_dust`, `shield`, `unshield`, `contract_call` shift NIGHT between
// sub-balances (unshielded ↔ shielded ↔ registered) but don't change the total,
// so they get a delta of 0.
function txNightDelta(tx: MidnightTransaction): bigint {
  if (tx.token !== 'NIGHT') return 0n;
  if (tx.type === 'receive') return tx.amount;
  if (tx.type === 'send') return -tx.amount;
  return 0n;
}

const chartData = computed<AreaData<UTCTimestamp>[]>(() => {
  const txs = (transactions.value ?? [])
    .filter(t => t.token === 'NIGHT' && t.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (txs.length === 0) return [];

  const divisor = NIGHT_DIVISOR;
  // Convert BigInt base units to a JS Number suitable for charting. NIGHT has
  // 6 decimals, so values stay well within safe integer range for any
  // realistic balance.
  const toDisplay = (v: bigint): number => Number(v) / Number(divisor);

  // Reverse-walk: rightmost point is the current balance.
  const points: AreaData<UTCTimestamp>[] = [];
  const nowSec = Math.floor(Date.now() / 1000) as UTCTimestamp;
  let runningTotal = totalNight.value;

  // Push the current point first; subsequent reverse steps push earlier ones.
  points.push({ time: nowSec, value: toDisplay(runningTotal) });

  for (let i = txs.length - 1; i >= 0; i--) {
    const tx = txs[i];
    const delta = txNightDelta(tx);
    // Balance just BEFORE this tx = balance AFTER it (current running) − delta
    const beforeTx = runningTotal - delta;
    points.unshift({
      time: Math.max(1, Math.floor(tx.timestamp / 1000)) as UTCTimestamp,
      value: toDisplay(beforeTx),
    });
    runningTotal = beforeTx;
  }

  // Filter to the selected timeframe.
  const cutoffSec = Math.floor((Date.now() - timeframeWindowMs[selectedTimeframe.value]) / 1000);
  const inWindow = points.filter(p => (p.time as number) >= cutoffSec);

  // If the cutoff slices through the history, prepend a synthetic point at the
  // cutoff time using the balance we had just before the first in-window tx.
  if (inWindow.length > 0 && inWindow.length < points.length) {
    const firstInWindowIdx = points.indexOf(inWindow[0]);
    const priorPointValue = firstInWindowIdx > 0 ? points[firstInWindowIdx - 1].value : inWindow[0].value;
    inWindow.unshift({ time: cutoffSec as UTCTimestamp, value: priorPointValue });
  }

  // If the user has only one tx and we're inside the window, pad the left edge
  // with the balance-before-first-tx so the chart isn't a single point.
  if (inWindow.length === 1) {
    const lonePoint = inWindow[0];
    inWindow.unshift({ time: cutoffSec as UTCTimestamp, value: 0 });
    void lonePoint; // referenced for clarity
  }

  return inWindow;
});

const hasChartData = computed(() => chartData.value.length >= 2);

// ── Chart instance ───────────────────────────────────────────────────────────
const chartContainerRef = ref<HTMLElement | null>(null);
let chart: IChartApi | null = null;
let areaSeries: ISeriesApi<'Area'> | null = null;
let resizeObserver: ResizeObserver | null = null;

const priceFormatter = (price: number) => {
  if (hideBalances.value) return '••••••';
  if (price >= 1e6) return (price / 1e6).toFixed(2) + 'M';
  if (price >= 1e3) return (price / 1e3).toFixed(2) + 'K';
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
};

function initChart() {
  if (!chartContainerRef.value) return;
  if (chart) return;

  const w = chartContainerRef.value.clientWidth || chartContainerRef.value.offsetWidth || 300;
  const h = chartContainerRef.value.clientHeight || chartContainerRef.value.offsetHeight || 150;

  chart = createChart(chartContainerRef.value, {
    width: w,
    height: h,
    layout: {
      attributionLogo: false,
      background: { type: 'solid' as const, color: 'transparent' } as SolidColor,
      textColor: 'rgba(255, 255, 255, 0.5)',
      fontFamily: 'Quicksand, Inter, sans-serif',
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { visible: false },
    },
    rightPriceScale: {
      visible: true,
      borderVisible: false,
      scaleMargins: { top: 0.25, bottom: 0.25 },
      entireTextOnly: false,
      ticksVisible: true,
      textColor: 'rgba(255, 255, 255, 0.35)',
      minimumWidth: 60,
    },
    timeScale: {
      visible: true,
      borderVisible: false,
      fixLeftEdge: true,
      fixRightEdge: true,
    },
    crosshair: {
      mode: 1,
      vertLine: {
        color: 'rgba(255, 255, 255, 0.15)',
        width: 1,
        style: 2,
        labelVisible: false,
      },
      horzLine: {
        color: 'rgba(255, 255, 255, 0.15)',
        width: 1,
        style: 2,
        labelVisible: true,
        labelBackgroundColor: 'rgba(30, 34, 45, 0.9)',
      },
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
  });

  areaSeries = chart.addSeries(AreaSeries, {
    // Midnight accent (violet) — was Cardano cyan (#00c7f3) copied across.
    lineColor: '#A78BFA',
    lineWidth: 2,
    lineType: 2,
    topColor: 'rgba(167, 139, 250, 0.3)',
    bottomColor: 'rgba(167, 139, 250, 0)',
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 4,
    crosshairMarkerBorderColor: '#ffffff',
    crosshairMarkerBorderWidth: 2,
    crosshairMarkerBackgroundColor: '#A78BFA',
    priceLineVisible: false,
    lastValueVisible: false,
    priceFormat: {
      type: 'custom',
      formatter: priceFormatter,
      minMove: 0.01,
    },
  });

  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(entries => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (width > 0 && height > 0 && chart) {
          chart.applyOptions({ width, height });
        }
      }
    });
    resizeObserver.observe(chartContainerRef.value);
  }

  applyChartData();
}

function applyChartData() {
  if (!areaSeries || !chart) return;
  const data = chartData.value;
  areaSeries.setData(data);
  if (data.length > 0) chart.timeScale().fitContent();
}

function destroyChart() {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (chart) {
    chart.remove();
    chart = null;
    areaSeries = null;
  }
}

onMounted(async () => {
  await nextTick();
  if (hasChartData.value) initChart();
});

onBeforeUnmount(destroyChart);

// Re-init the chart when data appears for the first time (we don't render the
// container before then, so the ref is null until `hasChartData` flips true).
watch(hasChartData, async (now) => {
  if (now) {
    await nextTick();
    if (!chart) initChart();
    else applyChartData();
  } else {
    destroyChart();
  }
});

// Re-feed data when balances or timeframe change while the chart is alive.
watch([chartData, selectedTimeframe], () => {
  if (chart) applyChartData();
}, { deep: true });

function formatBigDecimal(value: bigint, divisor: bigint, fractionDigits: number): string {
  if (value < 0n) value = 0n;
  const whole = value / divisor;
  const remainder = value % divisor;
  if (fractionDigits === 0) return whole.toLocaleString('en-US');
  const remainderStr = remainder.toString().padStart(divisor.toString().length - 1, '0');
  const fraction = remainderStr.slice(0, fractionDigits).padEnd(fractionDigits, '0');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
}

function formatNight(value: bigint): string {
  return formatBigDecimal(value, NIGHT_DIVISOR, 2);
}

</script>

<style scoped>
/* Layout grammar copied verbatim from PortfolioChart.vue. */

.portfolio-split-root {
  display: flex;
  gap: 6px;
  height: 100%;
}

.portfolio-metrics-panel {
  flex: 0 0 30%;
  min-width: 0;
  /* Match Cardano's PortfolioChart hero panels: liquid glass over the chain
     background (was opaque var(--g-surface), which broke cross-chain parity). */
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(20px) saturate(1.8);
  -webkit-backdrop-filter: blur(20px) saturate(1.8);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: var(--g-r-card);
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.metrics-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.metrics-header-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 2px;
}

.portfolio-label {
  color: var(--g-text-3);
}

.portfolio-amount {
  font-size: 1.4rem;
  font-weight: 600;
  color: var(--g-text-1);
  display: inline-flex;
  align-items: baseline;
  gap: 0.1em;
  margin-bottom: 4px;
}

.portfolio-amount-masked {
  letter-spacing: 2px;
  opacity: 0.5;
}

.currency-symbol {
  font-weight: 600;
  margin-left: 0.2em;
  font-size: 0.9em;
  color: var(--g-text-2);
}

.address-section {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 2px;
}

.pnl-column {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pnl-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.pnl-label {
  font-size: 11px;
  color: var(--g-text-3);
  white-space: nowrap;
}

.pnl-value {
  font-family: var(--g-font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.portfolio-chart-panel {
  flex: 1 1 70%;
  min-width: 0;
  /* Match Cardano's PortfolioChart hero panels: liquid glass over the chain
     background (was opaque var(--g-surface), which broke cross-chain parity). */
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(20px) saturate(1.8);
  -webkit-backdrop-filter: blur(20px) saturate(1.8);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: var(--g-r-card);
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chart-controls-bar {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}

.timeframe-pills {
  display: flex;
  gap: 4px;
}

.timeframe-pill {
  border: none;
  background: transparent;
  color: var(--g-text-3);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 4px 10px;
  border-radius: var(--g-r-control);
  cursor: pointer;
  transition: color var(--g-dur-base) ease, background-color var(--g-dur-base) ease;
  outline: none;
}

.timeframe-pill:hover {
  color: var(--g-text-1);
  background: var(--g-hairline-1);
}

.timeframe-pill.active {
  color: var(--g-accent);
  background: color-mix(in srgb, var(--g-accent) 12%, transparent);
}

.chart-area {
  flex-grow: 1;
  position: relative;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  min-height: 0;
}

.lw-chart-container {
  width: 100%;
  height: 100%;
}

.empty-state {
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
</style>
