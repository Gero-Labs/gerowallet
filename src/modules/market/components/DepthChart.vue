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
      {{ $t('market.na') }}
    </div>
    <div v-else ref="chartEl" class="depth-area" style="height: 180px"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { createChart, AreaSeries, type IChartApi, type SolidColor } from 'lightweight-charts';
import marketApi, { type OrderBook } from '@/api/market-api';

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
    if (!pools.length) { orderBook.value = null; return; }

    const topPool = pools.sort((a, b) => (b.tvlAda || 0) - (a.tvlAda || 0))[0];

    const fetcher = depthSource.value === 'real'
      ? marketApi.getOrderBook
      : marketApi.getSimulatedOrderBook;
    orderBook.value = await fetcher(topPool.poolId, 20);

    await nextTick();
    renderChart();
  } catch {
    orderBook.value = null;
  } finally {
    loading.value = false;
  }
}

function renderChart() {
  if (!chartEl.value || !orderBook.value) return;
  if (chart) { try { chart.remove(); } catch { /* */ } chart = null; }

  const ob = orderBook.value;
  chart = createChart(chartEl.value, {
    width: chartEl.value.clientWidth,
    height: 180,
    layout: { attributionLogo: false, background: { type: 'solid', color: 'transparent' } as SolidColor, textColor: '#D1D4DC' },
    grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(197,203,206,0.07)' } },
    rightPriceScale: { borderColor: 'rgba(197,203,206,0.2)' },
    timeScale: { visible: false },
    crosshair: { mode: 0 },
  });

  const bidSeries = chart.addSeries(AreaSeries, {
    lineColor: '#26FAB0',
    topColor: 'rgba(38,250,176,0.3)',
    bottomColor: 'rgba(38,250,176,0.02)',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  const askSeries = chart.addSeries(AreaSeries, {
    lineColor: '#FF5252',
    topColor: 'rgba(255,82,82,0.3)',
    bottomColor: 'rgba(255,82,82,0.02)',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  const bids = [...ob.bids].sort((a, b) => b.price - a.price);
  const asks = [...ob.asks].sort((a, b) => a.price - b.price);

  let cumBid = 0;
  const bidData = bids.map((b, i) => { cumBid += b.size; return { time: i as any, value: cumBid }; });

  let cumAsk = 0;
  const askData = asks.map((a, i) => { cumAsk += a.size; return { time: (bids.length + i) as any, value: cumAsk }; });

  bidSeries.setData(bidData);
  askSeries.setData(askData);
}

watch([() => props.policyId, () => props.assetName], () => loadOrderBook());
watch(depthSource, () => loadOrderBook());

onMounted(() => loadOrderBook());
onBeforeUnmount(() => { if (chart) { try { chart.remove(); } catch { /* */ } } });
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
