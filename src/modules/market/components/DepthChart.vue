<template>
  <div class="depth-chart-container">
    <div class="d-flex align-center justify-space-between mb-2">
      <span class="text-caption text--secondary">{{ $t('market.depthChart') }}</span>
      <v-btn-toggle v-model="depthSource" dense mandatory class="depth-toggle">
        <v-btn x-small value="simulated">AMM</v-btn>
        <v-btn x-small value="real">Orders</v-btn>
      </v-btn-toggle>
    </div>
    <div v-if="loading" class="d-flex justify-center py-6">
      <v-progress-circular indeterminate size="24" color="primary" />
    </div>
    <div v-else-if="!orderBook" class="text-center py-6 text--secondary text-caption">
      <v-icon small class="mb-1" style="opacity: 0.3">mdi-chart-areaspline</v-icon>
      <div>{{ $t('market.noDepthData') }}</div>
    </div>
    <div v-else ref="chartEl" class="depth-area" style="height: 180px"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { createChart, AreaSeries, type IChartApi, type SolidColor } from 'lightweight-charts';
import marketApi, { type OrderBook } from '@/api/market-api';
import { useNativeCurrency } from '@/modules/market/composables/useNativeCurrency';

const { currencySymbol } = useNativeCurrency();

const LOVELACE = 1_000_000;

const props = defineProps<{
  policyId: string;
  assetName: string;
}>();

const depthSource = ref('simulated');
const orderBook = ref<OrderBook | null>(null);
const loading = ref(false);
const chartEl = ref<HTMLElement>();
let chart: IChartApi | null = null;

async function loadOrderBook() {
  loading.value = true;
  try {
    const pools = await marketApi.getPoolsByToken(props.policyId, props.assetName);
    if (!pools.length) { if (chart) { try { chart.remove(); } catch { /* */ } chart = null; } orderBook.value = null; return; }

    const topPool = pools.sort((a, b) => (b.tvlAda || 0) - (a.tvlAda || 0))[0];

    const fetcher = depthSource.value === 'real'
      ? marketApi.getOrderBook
      : marketApi.getSimulatedOrderBook;
    const ob = await fetcher(topPool.poolId, 20);

    // No data (e.g. real order book has empty bids/asks)
    if (!ob.bids?.length && !ob.asks?.length) { if (chart) { try { chart.remove(); } catch { /* */ } chart = null; } orderBook.value = null; return; }

    orderBook.value = ob;
    await nextTick();
    // Double-RAF ensures the DOM is fully laid out after v-if tab switch
    requestAnimationFrame(() => {
      requestAnimationFrame(() => renderChart());
    });
  } catch (err) {
    console.warn('DepthChart: failed to load order book', err);
    if (chart) { try { chart.remove(); } catch { /* */ } chart = null; }
    orderBook.value = null;
  } finally {
    loading.value = false;
  }
}

import { formatCompact } from '@/modules/market/utils/formatters';

function renderChart() {
  if (!chartEl.value || !orderBook.value) return;

  const width = chartEl.value.clientWidth;
  if (width <= 0) return;

  if (chart) { try { chart.remove(); } catch { /* */ } chart = null; }

  const ob = orderBook.value;

  // Bids: sort ascending by price (left = lowest bid, right = market price)
  // Cumulate from outside in: lowest price has the largest cumulative depth
  const bids = [...ob.bids].sort((a, b) => a.price - b.price);
  const asks = [...ob.asks].sort((a, b) => a.price - b.price);

  // lightweight-charts "time" axis needs unique integers.
  // Prices can be tiny (e.g. 0.003224 for GERO) — Math.round would collapse them all to 0.
  // Find scale factor that maps the smallest price difference to at least 1.
  const allPrices = [...bids.map(b => b.price), ...asks.map(a => a.price)].sort((a, b) => a - b);
  let minGap = Infinity;
  for (let i = 1; i < allPrices.length; i++) {
    const gap = allPrices[i] - allPrices[i - 1];
    if (gap > 0 && gap < minGap) minGap = gap;
  }
  // Scale so the smallest gap maps to 1; fallback for single-level books
  const priceScale = minGap > 0 && isFinite(minGap) ? Math.ceil(1 / minGap) : 1;

  // Build cumulative bid depth (from outside in)
  // At the lowest bid price, cumulative = total of all bids
  // At the highest bid price (near market), cumulative = just that level
  const totalBidSize = bids.reduce((s, b) => s + b.size, 0);
  let runningBid = totalBidSize;
  const bidData = bids.map(b => {
    const val = runningBid / LOVELACE; // Convert lovelace → ADA
    runningBid -= b.size;
    return { time: Math.round(b.price * priceScale) as any, value: val };
  });

  // Build cumulative ask depth (from inside out)
  // At the lowest ask price (near market), cumulative = just that level
  // At the highest ask price, cumulative = total of all asks
  let cumAsk = 0;
  const askData = asks.map(a => {
    cumAsk += a.size;
    return { time: Math.round(a.price * priceScale) as any, value: cumAsk / LOVELACE };
  });

  chart = createChart(chartEl.value, {
    width,
    height: 180,
    layout: {
      attributionLogo: false,
      background: { type: 'solid', color: 'transparent' } as SolidColor,
      textColor: '#D1D4DC',
    },
    grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(197,203,206,0.07)' } },
    rightPriceScale: {
      borderColor: 'rgba(197,203,206,0.2)',
    },
    timeScale: { visible: false },
    crosshair: { mode: 0 },
    localization: {
      priceFormatter: (price: number) => formatCompact(price) + ' ' + currencySymbol.value,
    },
  });

  const bidSeries = chart.addSeries(AreaSeries, {
    lineColor: '#26FAB0',
    topColor: 'rgba(38,250,176,0.3)',
    bottomColor: 'rgba(38,250,176,0.02)',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  const askSeries = chart.addSeries(AreaSeries, {
    lineColor: '#FF5252',
    topColor: 'rgba(255,82,82,0.3)',
    bottomColor: 'rgba(255,82,82,0.02)',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  if (bidData.length) bidSeries.setData(bidData);
  if (askData.length) askSeries.setData(askData);
  chart.timeScale().fitContent();
}

watch([() => props.policyId, () => props.assetName], () => loadOrderBook());
watch(depthSource, () => loadOrderBook());

// Re-render chart when container becomes visible / resizes (tab switch)
let resizeObserver: ResizeObserver | null = null;

watch(chartEl, (el) => {
  if (resizeObserver) resizeObserver.disconnect();
  if (el) {
    resizeObserver = new ResizeObserver(() => {
      if (el.clientWidth > 0 && orderBook.value && !chart) {
        renderChart();
      }
    });
    resizeObserver.observe(el);
  }
});

onMounted(() => loadOrderBook());
onBeforeUnmount(() => {
  if (chart) { try { chart.remove(); } catch { /* */ } }
  if (resizeObserver) resizeObserver.disconnect();
});
</script>

<style scoped>
.depth-chart-container {
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  padding: 12px;
}
.depth-area { border-radius: 6px; overflow: hidden; }
.depth-toggle { background: rgba(255,255,255,0.04) !important; }
.depth-toggle >>> .v-btn { font-size: 10px !important; text-transform: none !important; letter-spacing: 0; }
</style>
