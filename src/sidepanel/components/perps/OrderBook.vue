<template>
  <div class="order-book">
    <!-- Header -->
    <div class="ob-header">
      <span class="ob-title">{{ $t('perpetuals.orderBook') }}</span>
      <div class="ob-spread-badge">
        <span class="spread-label">{{ $t('perpetuals.spread') }}</span>
        <span class="spread-value">{{ spread }}</span>
      </div>
    </div>

    <!-- Column Labels -->
    <div class="ob-col-labels">
      <span>{{ $t('perpetuals.price') }}</span>
      <span>{{ $t('perpetuals.size') }}</span>
      <span>Total</span>
    </div>

    <!-- Asks (top, high→low, red) -->
    <div class="ob-asks" ref="asksContainer">
      <div
        v-for="(level, i) in displayAsks"
        :key="'ask-' + i"
        class="ob-row ob-row--ask"
        @click="$emit('price-click', level.price)"
      >
        <div
          class="ob-row-fill ob-row-fill--ask"
          :style="{ width: cumulativePct(level.cumQty, maxCumQty) + '%' }"
        />
        <span class="ob-price ob-price--ask">{{ level.price }}</span>
        <span class="ob-qty">{{ level.qty }}</span>
        <span class="ob-total">{{ level.cumQty }}</span>
      </div>
    </div>

    <!-- Mid Price / Spread Row -->
    <div class="ob-mid-row">
      <div class="ob-mid-price" :class="midPriceClass">
        <v-icon size="11" class="mid-icon">{{ midPriceArrow }}</v-icon>
        <span>{{ midPrice }}</span>
      </div>
      <div class="ob-spread-inline">
        {{ spreadRaw }} <span class="spread-pct">({{ spreadPct }}%)</span>
      </div>
    </div>

    <!-- Bids (bottom, high→low, green) -->
    <div class="ob-bids">
      <div
        v-for="(level, i) in displayBids"
        :key="'bid-' + i"
        class="ob-row ob-row--bid"
        @click="$emit('price-click', level.price)"
      >
        <div
          class="ob-row-fill ob-row-fill--bid"
          :style="{ width: cumulativePct(level.cumQty, maxCumQty) + '%' }"
        />
        <span class="ob-price ob-price--bid">{{ level.price }}</span>
        <span class="ob-qty">{{ level.qty }}</span>
        <span class="ob-total">{{ level.cumQty }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { strikeMarketApi } from '@/api/strike-v2.market';
import { useStrikeMarketWs } from '@/modules/market/composables/useStrikeMarketWs';

// ── Props & Emits ────────────────────────────────────────────────────────────
const props = withDefaults(defineProps<{
  symbol: string;
  depth?: number;
}>(), {
  depth: 10,
});

const emit = defineEmits<{
  (e: 'price-click', price: string): void;
}>();

// ── State ────────────────────────────────────────────────────────────────────
interface OrderBookSide {
  bids: [string, string][];
  asks: [string, string][];
}

const orderBook = ref<OrderBookSide>({ bids: [], asks: [] });
const prevMidPrice = ref<number | null>(null);
const currentMidPrice = ref<number | null>(null);
let unsubscribe: (() => void) | null = null;

// ── Composable ───────────────────────────────────────────────────────────────
const { subscribeOrderBook } = useStrikeMarketWs();

// ── Computed ─────────────────────────────────────────────────────────────────

/** Asks sorted descending (highest first) — top N */
const displayAsks = computed(() => {
  const sorted = [...orderBook.value.asks]
    .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))
    .slice(0, props.depth);
  return buildLevels(sorted, true);
});

/** Bids sorted descending (highest first) */
const displayBids = computed(() => {
  const sorted = [...orderBook.value.bids]
    .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))
    .slice(0, props.depth);
  return buildLevels(sorted, false);
});

const bestAsk = computed<number | null>(() => {
  const asks = [...orderBook.value.asks].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
  return asks.length ? parseFloat(asks[0][0]) : null;
});

const bestBid = computed<number | null>(() => {
  const bids = [...orderBook.value.bids].sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]));
  return bids.length ? parseFloat(bids[0][0]) : null;
});

const midPrice = computed<string>(() => {
  if (bestAsk.value === null || bestBid.value === null) return '—';
  return ((bestAsk.value + bestBid.value) / 2).toFixed(2);
});

const midPriceClass = computed(() => {
  if (currentMidPrice.value === null || prevMidPrice.value === null) return '';
  if (currentMidPrice.value > prevMidPrice.value) return 'mid-up';
  if (currentMidPrice.value < prevMidPrice.value) return 'mid-down';
  return '';
});

const midPriceArrow = computed(() => {
  if (currentMidPrice.value === null || prevMidPrice.value === null) return 'mdi-minus';
  if (currentMidPrice.value > prevMidPrice.value) return 'mdi-trending-up';
  if (currentMidPrice.value < prevMidPrice.value) return 'mdi-trending-down';
  return 'mdi-minus';
});

const spreadRaw = computed<string>(() => {
  if (bestAsk.value === null || bestBid.value === null) return '—';
  return (bestAsk.value - bestBid.value).toFixed(2);
});

const spreadPct = computed<string>(() => {
  if (bestAsk.value === null || bestBid.value === null) return '—';
  const mid = (bestAsk.value + bestBid.value) / 2;
  if (mid === 0) return '—';
  return ((bestAsk.value - bestBid.value) / mid * 100).toFixed(3);
});

const spread = computed<string>(() => {
  if (spreadRaw.value === '—') return '—';
  return `${spreadRaw.value} (${spreadPct.value}%)`;
});

const maxCumQty = computed<number>(() => {
  const lastAsk = displayAsks.value[displayAsks.value.length - 1];
  const lastBid = displayBids.value[displayBids.value.length - 1];
  const askMax = lastAsk ? parseFloat(lastAsk.cumQty) : 0;
  const bidMax = lastBid ? parseFloat(lastBid.cumQty) : 0;
  return Math.max(askMax, bidMax);
});

// ── Helpers ──────────────────────────────────────────────────────────────────
interface Level {
  price: string;
  qty: string;
  cumQty: string;
}

function buildLevels(sorted: [string, string][], isAsk: boolean): Level[] {
  let cum = 0;
  // For asks displayed top→bottom (highest→lowest), cumulate from bottom up
  // We reverse, accumulate, then reverse back
  const levels = isAsk
    ? [...sorted].reverse().map(([p, q]) => {
        cum += parseFloat(q);
        return { price: p, qty: q, cumQty: cum.toFixed(4) };
      }).reverse()
    : sorted.map(([p, q]) => {
        cum += parseFloat(q);
        return { price: p, qty: q, cumQty: cum.toFixed(4) };
      });
  return levels;
}

function cumulativePct(cumQty: string, max: number): number {
  if (max <= 0) return 0;
  return Math.min((parseFloat(cumQty) / max) * 100, 100);
}

function applySnapshot(data: { bids?: [string, string][]; asks?: [string, string][] }) {
  if (data.bids) orderBook.value.bids = data.bids;
  if (data.asks) orderBook.value.asks = data.asks;
  updateMidPrice();
}

function applyDelta(data: unknown) {
  const d = data as { b?: [string, string][]; a?: [string, string][] };
  if (d.b) mergeDepth(orderBook.value.bids, d.b);
  if (d.a) mergeDepth(orderBook.value.asks, d.a);
  updateMidPrice();
}

function mergeDepth(side: [string, string][], updates: [string, string][]) {
  for (const [price, qty] of updates) {
    const idx = side.findIndex((e) => e[0] === price);
    if (parseFloat(qty) === 0) {
      if (idx !== -1) side.splice(idx, 1);
    } else {
      if (idx !== -1) side[idx] = [price, qty];
      else side.push([price, qty]);
    }
  }
}

function updateMidPrice() {
  if (bestAsk.value !== null && bestBid.value !== null) {
    prevMidPrice.value = currentMidPrice.value;
    currentMidPrice.value = (bestAsk.value + bestBid.value) / 2;
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
async function loadAndSubscribe(symbol: string) {
  // Unsubscribe previous
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  orderBook.value = { bids: [], asks: [] };

  // Fetch snapshot
  try {
    const snapshot = await strikeMarketApi.getOrderBook(symbol, props.depth * 2);
    applySnapshot(snapshot);
  } catch {
    // ignore — ws will fill in
  }

  // Subscribe to live updates
  unsubscribe = subscribeOrderBook(symbol, applyDelta);
}

onMounted(() => {
  loadAndSubscribe(props.symbol);
});

onUnmounted(() => {
  if (unsubscribe) unsubscribe();
});

watch(() => props.symbol, (sym) => {
  loadAndSubscribe(sym);
});
</script>

<style scoped>
.order-book {
  display: flex;
  flex-direction: column;
  font-family: 'JetBrains Mono', 'Fira Code', 'Roboto Mono', monospace;
  background: transparent;
  user-select: none;
}

/* ── Header ── */
.ob-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px 4px;
}

.ob-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
}

.ob-spread-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 9px;
}

.spread-label {
  color: rgba(255, 255, 255, 0.25);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.spread-value {
  color: rgba(255, 255, 255, 0.55);
  font-weight: 600;
}

/* ── Column Labels ── */
.ob-col-labels {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  padding: 2px 10px 3px;
  font-size: 8.5px;
  color: rgba(255, 255, 255, 0.2);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.ob-col-labels span:nth-child(2),
.ob-col-labels span:nth-child(3) {
  text-align: right;
}

/* ── Rows shared ── */
.ob-asks,
.ob-bids {
  display: flex;
  flex-direction: column;
}

.ob-row {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  align-items: center;
  height: 19px;
  padding: 0 10px;
  cursor: pointer;
  overflow: hidden;
  transition: background 0.1s;
}

.ob-row:hover {
  background: rgba(255, 255, 255, 0.04) !important;
}

/* Depth bar fills */
.ob-row-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  opacity: 0.12;
  pointer-events: none;
  transition: width 0.15s ease;
}

.ob-row-fill--ask {
  background: #F97066;
}

.ob-row-fill--bid {
  background: #26FAB0;
}

/* Price */
.ob-price {
  font-size: 11px;
  font-weight: 600;
  position: relative;
  z-index: 1;
}

.ob-price--ask {
  color: #F97066;
}

.ob-price--bid {
  color: #26FAB0;
}

/* Qty / Total */
.ob-qty,
.ob-total {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.55);
  text-align: right;
  position: relative;
  z-index: 1;
}

.ob-total {
  color: rgba(255, 255, 255, 0.3);
}

/* ── Mid Price Row ── */
.ob-mid-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  margin: 1px 0;
}

.ob-mid-price {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.75);
  transition: color 0.2s ease;
}

.ob-mid-price.mid-up {
  color: #26FAB0;
}

.ob-mid-price.mid-down {
  color: #F97066;
}

.mid-icon {
  transition: color 0.2s ease;
  color: inherit !important;
}

.ob-spread-inline {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.3);
}

.spread-pct {
  color: rgba(255, 255, 255, 0.18);
}
</style>
