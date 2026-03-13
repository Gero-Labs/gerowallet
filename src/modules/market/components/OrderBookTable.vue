<template>
  <div class="order-book-container">
    <!-- Header: title + pool info + source toggle -->
    <div class="d-flex align-center justify-space-between mb-1">
      <span class="text-caption text--secondary">{{ $t('market.orderBook') }}</span>
      <v-btn-toggle v-model="source" dense mandatory class="ob-toggle">
        <v-btn x-small value="simulated">AMM</v-btn>
        <v-btn x-small value="real">Orders</v-btn>
      </v-btn-toggle>
    </div>

    <!-- Pool info bar -->
    <div v-if="poolInfo" class="ob-pool-info mb-2">
      <span class="pool-name">{{ formatDexName(poolInfo.dex) }}</span>
      <span class="pool-price">{{ formatOBPrice(poolInfo.currentPrice) }} {{ currencySymbol }}</span>
      <span class="pool-tvl">TVL: {{ formatCompact(poolInfo.tvlAda) }} {{ currencySymbol }}</span>
    </div>

    <div v-if="loading" class="d-flex justify-center py-4">
      <v-progress-circular indeterminate size="24" color="primary" />
    </div>
    <div v-else-if="errorMsg" class="text-center py-4 text-caption" style="color: #F97066">{{ errorMsg }}</div>
    <div v-else-if="!orderBook" class="text-center py-4 text--secondary text-caption">
      <v-icon small class="mb-1" style="opacity: 0.3">mdi-book-open-outline</v-icon>
      <div>{{ $t('market.noOrderBookData') }}</div>
    </div>

    <template v-else>
      <!-- Column headers -->
      <div class="ob-header">
        <span>{{ $t('market.price') }} ({{ currencySymbol }})</span>
        <span class="text-right">{{ $t('market.size') }} ({{ currencySymbol }})</span>
        <span class="text-right">{{ $t('market.total') }} ({{ currencySymbol }})</span>
      </div>

      <!-- Asks (sell side) — highest ask at top, lowest ask near spread -->
      <div class="ob-asks">
        <div
          v-for="(a, i) in displayAsks"
          :key="'a' + i"
          class="ob-row ask-row"
        >
          <div class="ob-depth-bar ask-depth" :style="{ width: a.barPercent + '%' }"></div>
          <span class="ob-cell ob-price ask-price">{{ formatOBPrice(a.price) }}</span>
          <span class="ob-cell ob-size text-right">{{ formatSize(a.sizeAda) }}</span>
          <span class="ob-cell ob-total text-right">{{ formatSize(a.cumulative) }}</span>
        </div>
      </div>

      <!-- Spread -->
      <div class="ob-spread">
        {{ $t('market.spread') }}&nbsp;&nbsp;{{ formatOBPrice(spread) }} {{ currencySymbol }}&nbsp;&nbsp;({{ spreadPercent }}%)
      </div>

      <!-- Bids (buy side) — highest bid near spread, lowest bid at bottom -->
      <div class="ob-bids">
        <div
          v-for="(b, i) in displayBids"
          :key="'b' + i"
          class="ob-row bid-row"
        >
          <div class="ob-depth-bar bid-depth" :style="{ width: b.barPercent + '%' }"></div>
          <span class="ob-cell ob-price bid-price">{{ formatOBPrice(b.price) }}</span>
          <span class="ob-cell ob-size text-right">{{ formatSize(b.sizeAda) }}</span>
          <span class="ob-cell ob-total text-right">{{ formatSize(b.cumulative) }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import marketApi, { type OrderBook } from '@/api/market-api';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useNativeCurrency } from '@/modules/market/composables/useNativeCurrency';

const { t } = useTranslation();
const { currencySymbol } = useNativeCurrency();

const LOVELACE = 1_000_000;
const MAX_ROWS = 15;

const props = defineProps<{
  policyId: string;
  assetName: string;
}>();

const source = ref('simulated');
const orderBook = ref<OrderBook | null>(null);
const loading = ref(false);
const errorMsg = ref('');

interface DisplayLevel {
  price: number;
  sizeAda: number;
  cumulative: number;
  barPercent: number;
}

interface PoolInfo {
  dex: string;
  currentPrice: number;
  tvlAda: number;
}

const poolInfo = ref<PoolInfo | null>(null);

async function loadOrderBook() {
  if (!props.policyId || !props.assetName) { orderBook.value = null; return; }
  loading.value = true;
  errorMsg.value = '';
  try {
    const pools = await marketApi.getPoolsByToken(props.policyId, props.assetName);
    if (!pools.length) { orderBook.value = null; poolInfo.value = null; return; }

    const topPool = pools.sort((a, b) => (b.tvlAda || 0) - (a.tvlAda || 0))[0];
    const fetcher = source.value === 'real'
      ? marketApi.getOrderBook
      : marketApi.getSimulatedOrderBook;
    const ob = await fetcher(topPool.poolId, MAX_ROWS);

    if (!ob.bids?.length && !ob.asks?.length) { orderBook.value = null; return; }

    poolInfo.value = { dex: ob.dex || topPool.dex, currentPrice: ob.currentPrice, tvlAda: ob.tvlAda || topPool.tvlAda };
    orderBook.value = ob;
  } catch (err: any) {
    console.warn('OrderBookTable: failed to load', err);
    errorMsg.value = t('market.failedToLoadOrderBook');
    orderBook.value = null;
  } finally {
    loading.value = false;
  }
}

// Asks: sorted ascending, displayed with highest at top → lowest near spread
const displayAsks = computed<DisplayLevel[]>(() => {
  if (!orderBook.value?.asks?.length) return [];
  const sorted = [...orderBook.value.asks]
    .sort((a, b) => a.price - b.price)
    .slice(0, MAX_ROWS);

  // Build cumulative from inside out (lowest ask = smallest cumulative)
  let cum = 0;
  const levels = sorted.map(a => {
    cum += a.size;
    return { price: a.price, sizeAda: a.size / LOVELACE, cumulative: cum / LOVELACE };
  });

  const maxCum = levels.length ? levels[levels.length - 1].cumulative : 1;

  // Reverse so highest ask is at top, lowest (near spread) at bottom
  return levels.reverse().map(l => ({
    ...l,
    barPercent: Math.min((l.cumulative / maxCum) * 100, 100),
  }));
});

// Bids: sorted descending, highest bid (near spread) at top
const displayBids = computed<DisplayLevel[]>(() => {
  if (!orderBook.value?.bids?.length) return [];
  const sorted = [...orderBook.value.bids]
    .sort((a, b) => b.price - a.price)
    .slice(0, MAX_ROWS);

  // Build cumulative from inside out (highest bid = smallest cumulative)
  let cum = 0;
  const levels = sorted.map(b => {
    cum += b.size;
    return { price: b.price, sizeAda: b.size / LOVELACE, cumulative: cum / LOVELACE };
  });

  const maxCum = levels.length ? levels[levels.length - 1].cumulative : 1;

  return levels.map(l => ({
    ...l,
    barPercent: Math.min((l.cumulative / maxCum) * 100, 100),
  }));
});

const spread = computed(() => {
  if (!orderBook.value?.asks?.length || !orderBook.value?.bids?.length) return 0;
  const sortedAsks = [...orderBook.value.asks].sort((a, b) => a.price - b.price);
  const sortedBids = [...orderBook.value.bids].sort((a, b) => b.price - a.price);
  return Math.abs(sortedAsks[0].price - sortedBids[0].price);
});

const spreadPercent = computed(() => {
  if (!orderBook.value?.bids?.length) return '0.00';
  const sortedBids = [...orderBook.value.bids].sort((a, b) => b.price - a.price);
  if (sortedBids[0].price === 0) return '0.00';
  return ((spread.value / sortedBids[0].price) * 100).toFixed(2);
});

function formatOBPrice(price: number): string {
  if (price >= 1000) return price.toFixed(0);
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(4);
  return price.toFixed(6);
}

function formatSize(val: number): string {
  if (val >= 1e6) return (val / 1e6).toFixed(2) + 'M';
  if (val >= 1e3) return (val / 1e3).toFixed(2) + 'K';
  if (val >= 1) return val.toFixed(2);
  return val.toFixed(2);
}

import { formatCompact } from '@/modules/market/utils/formatters';

function formatDexName(dex: string): string {
  return dex.replace(/_/g, ' ').replace(/V(\d)/g, ' v$1').replace(/\b\w/g, l => l.toUpperCase());
}

// Auto-refresh every 30s while the component is mounted
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(() => loadOrderBook(), 30_000);
}

function stopAutoRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

watch([() => props.policyId, () => props.assetName], () => { loadOrderBook(); startAutoRefresh(); });
watch(source, () => { loadOrderBook(); startAutoRefresh(); });
onMounted(() => { loadOrderBook(); startAutoRefresh(); });
onBeforeUnmount(() => stopAutoRefresh());
</script>

<style scoped>
.order-book-container {
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  padding: 12px;
}

.ob-toggle { background: rgba(255,255,255,0.04) !important; }
.ob-toggle >>> .v-btn { font-size: 10px !important; text-transform: none !important; letter-spacing: 0; }

.ob-pool-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  padding: 4px 8px;
  background: rgba(255,255,255,0.03);
  border-radius: 4px;
}
.pool-name { color: rgba(255,255,255,0.7); font-weight: 500; }
.pool-price { color: #fff; font-weight: 600; font-family: 'Roboto Mono', monospace; }
.pool-tvl { color: rgba(255,255,255,0.4); margin-left: auto; font-size: 10px; }

/* Column headers */
.ob-header {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  padding: 4px 8px;
  font-size: 10px;
  color: rgba(255,255,255,0.35);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  margin-bottom: 1px;
}

/* Row layout */
.ob-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  padding: 0 8px;
  font-size: 11px;
  font-family: 'Roboto Mono', monospace;
  position: relative;
  line-height: 20px;
  cursor: default;
  transition: background 0.1s;
}
.ob-row:hover {
  background: rgba(255,255,255,0.04);
}

/* Depth bar — fills from right, behind size+total columns */
.ob-depth-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  pointer-events: none;
  transition: width 0.3s ease;
}
.ask-depth {
  background: linear-gradient(to left, rgba(255,82,82,0.18), rgba(255,82,82,0.04));
}
.bid-depth {
  background: linear-gradient(to left, rgba(38,250,176,0.18), rgba(38,250,176,0.04));
}

/* Cell text */
.ob-cell {
  position: relative;
  z-index: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ask-price { color: #FF5252; }
.bid-price { color: #26FAB0; }
.ob-size { color: rgba(255,255,255,0.75); }
.ob-total { color: rgba(255,255,255,0.45); }

/* Spread divider */
.ob-spread {
  text-align: center;
  padding: 4px 0;
  font-size: 11px;
  font-family: 'Roboto Mono', monospace;
  color: rgba(255,255,255,0.5);
  border-top: 1px solid rgba(255,255,255,0.08);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  margin: 2px 0;
  letter-spacing: 0.3px;
}

.ob-asks, .ob-bids {
  display: flex;
  flex-direction: column;
}
</style>
