<template>
  <div class="buy-sell-volume">
    <!-- Header -->
    <div class="d-flex align-center mb-2">
      <v-tooltip bottom :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span class="text-caption text--secondary font-weight-medium" v-bind="attrs" v-on="on">
            {{ $t('market.buySellVolume') }}
          </span>
        </template>
        <span>{{ $t('market.latestTooltip') }}</span>
      </v-tooltip>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="d-flex justify-center py-3">
      <v-progress-circular indeterminate size="18" color="primary" />
    </div>

    <!-- No data -->
    <div v-else-if="totalVolume === 0" class="text-center py-3 text--secondary text-caption">
      {{ $t('market.na') }}
    </div>

    <template v-else>
      <!-- Stacked bar -->
      <div class="volume-bar-container">
        <div class="volume-bar">
          <div class="buy-bar" :style="{ width: buyPercent + '%' }"></div>
          <div class="sell-bar" :style="{ width: sellPercent + '%' }"></div>
        </div>
        <div class="bar-labels">
          <span class="buy-label">{{ buyPercent.toFixed(0) }}%</span>
          <span class="sell-label">{{ sellPercent.toFixed(0) }}%</span>
        </div>
      </div>

      <!-- Volume numbers -->
      <div class="volume-stats">
        <div class="stat-item">
          <span class="stat-dot buy-dot"></span>
          <span class="stat-label">{{ $t('market.buy') }}</span>
          <span class="stat-value">{{ formatCompact(buyVolume) }} {{ currencySymbol }}</span>
          <span class="stat-count">({{ buyCount }})</span>
        </div>
        <div class="stat-item">
          <span class="stat-dot sell-dot"></span>
          <span class="stat-label">{{ $t('market.sell') }}</span>
          <span class="stat-value">{{ formatCompact(sellVolume) }} {{ currencySymbol }}</span>
          <span class="stat-count">({{ sellCount }})</span>
        </div>
      </div>

    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import marketApi, { type SwapHistory } from '@/api/market-api';
import { useNativeCurrency } from '@/modules/market/composables/useNativeCurrency';
import { summarizeBuySell } from '@/modules/market/utils/tradeSide';

const { currencySymbol } = useNativeCurrency();

const props = defineProps<{
  policyId: string;
  assetName: string;
}>();

const API_MAX_LIMIT = 100;

const allTrades = ref<SwapHistory[]>([]);
const loading = ref(false);
let refreshTimer: ReturnType<typeof setInterval> | null = null;

async function loadTrades() {
  if (!props.policyId || !props.assetName) { allTrades.value = []; return; }
  loading.value = true;
  try {
    const result = await marketApi.getTokenSwaps(props.policyId, props.assetName, API_MAX_LIMIT);
    allTrades.value = result;
  } catch (err) {
    console.warn('BuySellVolume: failed to load', err);
    allTrades.value = [];
  } finally {
    loading.value = false;
  }
}

// Backend `type` is token-perspective (BUY = user bought the token); render as-is.
// Aggregation + the "do not invert" rationale live in tradeSide.ts.
const summary = computed(() => summarizeBuySell(allTrades.value));
const buyVolume = computed(() => summary.value.buyVolume);
const sellVolume = computed(() => summary.value.sellVolume);
const buyCount = computed(() => summary.value.buyCount);
const sellCount = computed(() => summary.value.sellCount);
const totalVolume = computed(() => buyVolume.value + sellVolume.value);

const buyPercent = computed(() => totalVolume.value > 0 ? (buyVolume.value / totalVolume.value) * 100 : 50);
const sellPercent = computed(() => totalVolume.value > 0 ? (sellVolume.value / totalVolume.value) * 100 : 50);

function formatCompact(value: number): string {
  if (value >= 1e6) return (value / 1e6).toFixed(1) + 'M';
  if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
  if (value >= 1) return value.toFixed(0);
  return value.toFixed(1);
}

function startRefresh() {
  stopRefresh();
  refreshTimer = setInterval(() => loadTrades(), 30_000);
}

function stopRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

watch([() => props.policyId, () => props.assetName], () => { loadTrades(); startRefresh(); });
onMounted(() => { loadTrades(); startRefresh(); });
onBeforeUnmount(() => stopRefresh());
</script>

<style scoped>
.buy-sell-volume {
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 12px;
}

/* Stacked bar */
.volume-bar-container { margin-bottom: 8px; }

.volume-bar {
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--g-hairline-1);
}
.buy-bar {
  background: var(--g-success);
  transition: width 0.4s ease;
  min-width: 2px;
}
.sell-bar {
  background: var(--g-error);
  transition: width 0.4s ease;
  min-width: 2px;
}

.bar-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--g-font-mono);
}
.buy-label { color: var(--g-success); }
.sell-label { color: var(--g-error); }

/* Volume stats */
.volume-stats {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}
.stat-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.buy-dot { background: var(--g-success); }
.sell-dot { background: var(--g-error); }
.stat-label {
  color: var(--g-text-3);
  font-size: 11px;
  text-transform: uppercase;
}
.stat-value {
  color: var(--g-text-1);
  font-family: var(--g-font-mono);
  font-weight: 500;
}
.stat-count {
  color: var(--g-text-3);
  font-size: 11px;
}

</style>
