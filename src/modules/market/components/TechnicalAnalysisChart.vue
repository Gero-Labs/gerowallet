<template>
  <div class="ta-chart-container" :style="{ height }">
    <div ref="chartContainer" class="chart-area" :style="{ width: '100%', height: '100%' }"></div>
    <div v-if="showFallback" class="chart-fallback d-flex align-center justify-center" style="position: absolute; inset: 0">
      <v-progress-circular indeterminate size="24" color="primary" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { IChartApi, ISeriesApi, Time, SolidColor } from 'lightweight-charts';
import { CandlestickSeries, LineSeries, HistogramSeries, createChart } from 'lightweight-charts';
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
} from '@/modules/market/composables/useTechnicalAnalysis';

export interface CandleData {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

const props = withDefaults(defineProps<{
  candles: CandleData[];
  height?: string;
  indicators?: string[];
}>(), {
  height: '250px',
  indicators: () => [],
});

const chartContainer = ref<HTMLElement>();
const showFallback = ref(true);

let chart: IChartApi | null = null;
let candleSeries: ISeriesApi<'Candlestick'> | null = null;
let volumeSeries: ISeriesApi<'Histogram'> | null = null;
let smaSeries: ISeriesApi<'Line'> | null = null;
let emaSeries: ISeriesApi<'Line'> | null = null;
let bbUpperSeries: ISeriesApi<'Line'> | null = null;
let bbLowerSeries: ISeriesApi<'Line'> | null = null;
let rsiSeries: ISeriesApi<'Line'> | null = null;
let rsiUpperLine: ISeriesApi<'Line'> | null = null;
let rsiLowerLine: ISeriesApi<'Line'> | null = null;
let macdLineSeries: ISeriesApi<'Line'> | null = null;
let macdSignalSeries: ISeriesApi<'Line'> | null = null;
let macdHistogramSeries: ISeriesApi<'Histogram'> | null = null;
let resizeObserver: ResizeObserver | null = null;
let initRetryCount = 0;
let initRafId: number | null = null;
const MAX_INIT_RETRIES = 10;

// ── Render-time candle conditioning ───────────────────────────────────────────
// Ported from the market-data website (cardano-market-data CandleChart.tsx) so
// the Gero chart matches it. The backend records OHLC from the AMM post-swap
// marginal spot, so transient single-bar spikes (e.g. NIGHT) draw long shadows
// that a robust per-bar price never shows. Display-only — the /candles API is
// unchanged. Also sorts ascending + dedupes by time (lightweight-charts requires
// strictly-increasing unique time) as cheap insurance for the fallback path.
const LOCAL_WINDOW = 20; // bars each side for the rolling reference
const BODY_BAND = 12;    // open/close may sit within 12x of the local median
const WICK_CAP = 0.004;  // max wick kept after smoothing, as a fraction of body

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function prepareCandles(raw: CandleData[]): CandleData[] {
  // 1. keep valid bars, sort ascending, dedupe by time (keep last per timestamp)
  const byTime = new Map<number, CandleData>();
  for (const c of raw) {
    const t = Number(c.time);
    if (!Number.isFinite(t) || t <= 0) continue;
    if (![c.open, c.high, c.low, c.close].every(v => Number.isFinite(v) && v > 0)) continue;
    byTime.set(t, c);
  }
  const base = Array.from(byTime.values()).sort((a, b) => Number(a.time) - Number(b.time));
  if (base.length < 5) return base;

  // 2. median-smooth closes + rebuild bars with a tight wick (website parity)
  const closes = base.map(c => c.close);
  const sClose = closes.map((_, i) =>
    median([closes[Math.max(0, i - 1)], closes[i], closes[Math.min(closes.length - 1, i + 1)]]),
  );
  const out: CandleData[] = [];
  for (let i = 0; i < base.length; i++) {
    const c = base[i];
    const lo = Math.max(0, i - LOCAL_WINDOW);
    const hi = Math.min(base.length, i + LOCAL_WINDOW + 1);
    const med = median(closes.slice(lo, hi));
    // Drop a bar whose body is absurd vs the local price (rare, unrecoverable).
    if (med > 0 && (c.open > med * BODY_BAND || c.open < med / BODY_BAND || c.close > med * BODY_BAND || c.close < med / BODY_BAND)) {
      continue;
    }
    const open = i > 0 ? sClose[i - 1] : sClose[i];
    const close = sClose[i];
    const bodyHi = Math.max(open, close);
    const bodyLo = Math.min(open, close);
    const high = Math.min(Math.max(c.high, bodyHi), bodyHi * (1 + WICK_CAP));
    const low = Math.max(Math.min(c.low, bodyLo), bodyLo * (1 - WICK_CAP));
    out.push({ ...c, open, high, low, close });
  }
  return out;
}

/** Magnitude-adaptive price precision (website parity): clamp(5−floor(log10),2,12). */
function pricePrecisionFor(lastClose: number): { precision: number; minMove: number } {
  const p = Math.min(12, Math.max(2, 5 - Math.floor(Math.log10(lastClose || 1))));
  return { precision: p, minMove: Math.pow(10, -p) };
}

function destroyChart() {
  if (initRafId != null) { cancelAnimationFrame(initRafId); initRafId = null; }
  initRetryCount = 0;
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (chart) {
    try { chart.remove(); } catch { /* silent */ }
    chart = null;
  }
  candleSeries = null;
  volumeSeries = null;
  smaSeries = null;
  emaSeries = null;
  bbUpperSeries = null;
  bbLowerSeries = null;
  rsiSeries = null;
  rsiUpperLine = null;
  rsiLowerLine = null;
  macdLineSeries = null;
  macdSignalSeries = null;
  macdHistogramSeries = null;
}

async function initChart() {
  if (!chartContainer.value) return;
  destroyChart();

  await nextTick();

  const containerWidth = chartContainer.value.clientWidth || chartContainer.value.offsetWidth;
  const containerHeight = chartContainer.value.clientHeight || chartContainer.value.offsetHeight;
  if (containerWidth === 0 || containerHeight === 0) {
    if (initRetryCount < MAX_INIT_RETRIES) {
      initRetryCount++;
      initRafId = requestAnimationFrame(() => initChart());
    } else {
      console.warn('TechnicalAnalysisChart: Container not laid out after max retries');
      showFallback.value = true;
    }
    return;
  }
  initRetryCount = 0;

  try {
    chart = createChart(chartContainer.value, {
      width: containerWidth,
      height: containerHeight,
      layout: {
        attributionLogo: false,
        background: { type: 'solid' as const, color: 'transparent' } as SolidColor,
        textColor: '#D1D4DC',
      },
      grid: {
        vertLines: { color: 'rgba(197, 203, 206, 0.07)' },
        horzLines: { color: 'rgba(197, 203, 206, 0.07)' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: {
        borderColor: 'rgba(197, 203, 206, 0.2)',
        visible: true,
      },
      timeScale: {
        borderColor: 'rgba(197, 203, 206, 0.2)',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    // Main pane (pane 0): Candlesticks
    candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26FAB0',
      downColor: '#FF5252',
      borderVisible: false,
      wickUpColor: '#26FAB0',
      wickDownColor: '#FF5252',
      priceFormat: { type: 'price' as const, precision: 6, minMove: 0.000001 },
    });

    setChartData();
    applyIndicators();

    // Resize handling
    const resizeChart = () => {
      if (chart && chartContainer.value) {
        const w = chartContainer.value.clientWidth || chartContainer.value.offsetWidth;
        const h = chartContainer.value.clientHeight || chartContainer.value.offsetHeight;
        if (w > 0 && h > 0) {
          chart.applyOptions({ width: w, height: h });
        }
      }
    };

    if ('ResizeObserver' in window && chartContainer.value) {
      resizeObserver = new ResizeObserver(() => resizeChart());
      resizeObserver.observe(chartContainer.value);
    }

    showFallback.value = false;
  } catch (error) {
    console.error('TechnicalAnalysisChart: Failed to init chart:', error);
    showFallback.value = true;
  }
}

function setChartData() {
  if (!candleSeries) return;

  const display = prepareCandles(props.candles);
  if (!display.length) return;

  // Magnitude-adaptive precision off the latest displayed close (website parity).
  const { precision, minMove } = pricePrecisionFor(display[display.length - 1].close);
  candleSeries.applyOptions({ priceFormat: { type: 'price' as const, precision, minMove } });

  candleSeries.setData(display);
  showFallback.value = false;
}

function applyIndicators() {
  if (!chart) return;

  // Indicators track the same sanitized series the chart renders (website parity).
  const display = prepareCandles(props.candles);
  if (!display.length) return;

  const closes = display.map(c => c.close);
  const times = display.map(c => c.time);
  const indicators = props.indicators;

  // Volume (always on main pane, semi-transparent)
  if (indicators.includes('vol')) {
    if (!volumeSeries) {
      volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' as const },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
    }
    const volData = display.map(c => ({
      time: c.time,
      value: c.volume || 0,
      color: c.close >= c.open ? 'rgba(38, 250, 176, 0.2)' : 'rgba(255, 82, 82, 0.2)',
    }));
    volumeSeries.setData(volData);
  } else if (volumeSeries) {
    chart.removeSeries(volumeSeries);
    volumeSeries = null;
  }

  // SMA (20-period, yellow line on main pane)
  if (indicators.includes('sma')) {
    if (!smaSeries) {
      smaSeries = chart.addSeries(LineSeries, {
        color: '#ffc107',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
    }
    const smaValues = calculateSMA(closes, 20);
    const smaData = smaValues
      .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
      .filter(Boolean) as { time: Time; value: number }[];
    smaSeries.setData(smaData);
  } else if (smaSeries) {
    chart.removeSeries(smaSeries);
    smaSeries = null;
  }

  // EMA (20-period, purple line on main pane)
  if (indicators.includes('ema')) {
    if (!emaSeries) {
      emaSeries = chart.addSeries(LineSeries, {
        color: '#ab47bc',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
    }
    const emaValues = calculateEMA(closes, 20);
    const emaData = emaValues
      .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
      .filter(Boolean) as { time: Time; value: number }[];
    emaSeries.setData(emaData);
  } else if (emaSeries) {
    chart.removeSeries(emaSeries);
    emaSeries = null;
  }

  // Bollinger Bands (20-period, light blue lines on main pane)
  if (indicators.includes('bb')) {
    if (!bbUpperSeries) {
      bbUpperSeries = chart.addSeries(LineSeries, {
        color: 'rgba(33, 150, 243, 0.5)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        lineStyle: 2, // Dashed
      });
    }
    if (!bbLowerSeries) {
      bbLowerSeries = chart.addSeries(LineSeries, {
        color: 'rgba(33, 150, 243, 0.5)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        lineStyle: 2,
      });
    }
    const bbValues = calculateBollingerBands(closes, 20, 2);
    const upperData = bbValues
      .map((v, i) => (v.upper !== null ? { time: times[i], value: v.upper } : null))
      .filter(Boolean) as { time: Time; value: number }[];
    const lowerData = bbValues
      .map((v, i) => (v.lower !== null ? { time: times[i], value: v.lower } : null))
      .filter(Boolean) as { time: Time; value: number }[];
    bbUpperSeries.setData(upperData);
    bbLowerSeries.setData(lowerData);
  } else {
    if (bbUpperSeries) { chart.removeSeries(bbUpperSeries); bbUpperSeries = null; }
    if (bbLowerSeries) { chart.removeSeries(bbLowerSeries); bbLowerSeries = null; }
  }

  // RSI (separate pane)
  if (indicators.includes('rsi')) {
    const rsiPane = 1;
    if (!rsiSeries) {
      rsiSeries = chart.addSeries(LineSeries, {
        color: '#e040fb',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
        priceFormat: { type: 'custom' as const, formatter: (v: number) => v.toFixed(0) },
      }, rsiPane);

      // Overbought/Oversold lines
      rsiUpperLine = chart.addSeries(LineSeries, {
        color: 'rgba(255, 255, 255, 0.15)',
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      }, rsiPane);

      rsiLowerLine = chart.addSeries(LineSeries, {
        color: 'rgba(255, 255, 255, 0.15)',
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      }, rsiPane);
    }

    const rsiValues = calculateRSI(closes, 14);
    const rsiData = rsiValues
      .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
      .filter(Boolean) as { time: Time; value: number }[];
    rsiSeries.setData(rsiData);

    // Static 70/30 lines
    if (rsiData.length > 0) {
      const refLines = rsiData.map(d => ({ time: d.time }));
      rsiUpperLine?.setData(refLines.map(d => ({ ...d, value: 70 })));
      rsiLowerLine?.setData(refLines.map(d => ({ ...d, value: 30 })));
    }
  } else {
    if (rsiSeries) { chart.removeSeries(rsiSeries); rsiSeries = null; }
    if (rsiUpperLine) { chart.removeSeries(rsiUpperLine); rsiUpperLine = null; }
    if (rsiLowerLine) { chart.removeSeries(rsiLowerLine); rsiLowerLine = null; }
  }

  // MACD (separate pane)
  if (indicators.includes('macd')) {
    const macdPane = indicators.includes('rsi') ? 2 : 1;
    if (!macdLineSeries) {
      macdLineSeries = chart.addSeries(LineSeries, {
        color: '#2196F3',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: { type: 'custom' as const, formatter: (v: number) => v.toFixed(6) },
      }, macdPane);

      macdSignalSeries = chart.addSeries(LineSeries, {
        color: '#ff9800',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      }, macdPane);

      macdHistogramSeries = chart.addSeries(HistogramSeries, {
        priceLineVisible: false,
        lastValueVisible: false,
      }, macdPane);
    }

    const macdValues = calculateMACD(closes);
    const macdData = macdValues
      .map((v, i) => (v.macd !== null ? { time: times[i], value: v.macd } : null))
      .filter(Boolean) as { time: Time; value: number }[];
    const signalData = macdValues
      .map((v, i) => (v.signal !== null ? { time: times[i], value: v.signal } : null))
      .filter(Boolean) as { time: Time; value: number }[];
    const histData = macdValues
      .map((v, i) => {
        if (v.histogram === null) return null;
        return {
          time: times[i],
          value: v.histogram,
          color: v.histogram >= 0 ? 'rgba(38, 250, 176, 0.5)' : 'rgba(255, 82, 82, 0.5)',
        };
      })
      .filter(Boolean) as { time: Time; value: number; color: string }[];

    macdLineSeries.setData(macdData);
    macdSignalSeries?.setData(signalData);
    macdHistogramSeries?.setData(histData);
  } else {
    if (macdLineSeries) { chart.removeSeries(macdLineSeries); macdLineSeries = null; }
    if (macdSignalSeries) { chart.removeSeries(macdSignalSeries); macdSignalSeries = null; }
    if (macdHistogramSeries) { chart.removeSeries(macdHistogramSeries); macdHistogramSeries = null; }
  }
}

// Watch for candle data changes — full rebuild needed for new data
watch(() => props.candles, () => {
  if (chart) {
    setChartData();
    applyIndicators();
  }
});

// Watch for indicator toggle — only reapply overlays, no full rebuild
watch(() => props.indicators, () => {
  if (chart) {
    applyIndicators();
  }
}, { deep: true });

onMounted(() => {
  nextTick(() => initChart());
});

onBeforeUnmount(() => {
  destroyChart();
});
</script>

<style scoped>
.ta-chart-container {
  width: 100%;
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.chart-area {
  border-radius: 8px;
  position: relative;
}

.chart-fallback {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
}
</style>
