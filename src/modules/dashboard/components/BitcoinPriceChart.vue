<template>
  <div class="btc-price-card">
    <!-- Price Header -->
    <div class="price-header">
      <!-- Left: Logo + Price + Change -->
      <div class="price-left">
        <div class="btc-symbol-ring">
          <img :src="bitcoinLogo" class="btc-logo" alt="BTC" />
        </div>
        <div class="price-stack">
          <div class="ticker-label">BTC / USD</div>

          <div class="price-main-row">
            <span class="price-value" :class="priceDirection">
              {{ ticker ? formatPrice(ticker.lastPrice) : '——' }}
            </span>
            <div
              v-if="ticker"
              class="change-badge"
              :class="ticker.priceChangePercentage >= 0 ? 'change-badge--up' : 'change-badge--down'"
            >
              <svg
                :style="{ transform: ticker.priceChangePercentage >= 0 ? 'none' : 'rotate(180deg)' }"
                viewBox="0 0 10 10" fill="currentColor" width="9" height="9"
              >
                <polygon points="5,0 10,8 0,8"/>
              </svg>
              <span>{{ formatPercent(ticker.priceChangePercentage) }}</span>
            </div>
          </div>
          <div class="price-label-row">
            <div class="live-indicator">
              <span class="live-dot-price" />
              <span>LIVE</span>
            </div>
            <span class="separator">·</span>
            <span>{{ $t('bitcoin.twentyFourHourChange') }}</span>
          </div>
        </div>
      </div>

      <!-- Right: 24h stats grid -->
      <div class="stats-grid">
        <div class="stat-cell">
          <div class="stat-cell-label">24H HIGH</div>
          <div class="stat-cell-value stat-cell-value--high">
            {{ ticker ? formatPrice(ticker.high24h) : '—' }}
          </div>
        </div>
        <div class="stat-divider" />
        <div class="stat-cell">
          <div class="stat-cell-label">24H LOW</div>
          <div class="stat-cell-value stat-cell-value--low">
            {{ ticker ? formatPrice(ticker.low24h) : '—' }}
          </div>
        </div>
        <div class="stat-divider" />
        <div class="stat-cell">
          <div class="stat-cell-label">VOLUME</div>
          <div class="stat-cell-value">
            {{ ticker ? formatVolume(ticker.volume24h) : '—' }}
          </div>
        </div>
      </div>
    </div>

    <!-- Chart -->
    <div class="chart-wrapper">
      <TradingViewChart
        symbol="BTC/USD"
        :data="chartData"
        height="200px"
        :enable-realtime="true"
        :realtime-data="realtimeData"
        :price-precision="2"
        :price-min-move="0.01"
        @chartReady="onChartReady"
      />
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { IChartApi } from 'lightweight-charts';
import TradingViewChart from '@/shared/components/TradingViewChart.vue';
import krakenApi, { type CandlestickDataPoint } from '@/api/kraken-api';
import { priceStore } from '@/stores/priceStore';
import bitcoinLogo from '@/assets/bitcoin-logo.svg';

const chartData = ref<CandlestickDataPoint[]>([]);
const chart = ref<IChartApi | null>(null);
let refreshInterval: ReturnType<typeof setInterval> | null = null;

const ticker = computed(() => priceStore.btcUsd);
const realtimeData = computed(() =>
  ticker.value ? { lastPrice: ticker.value.lastPrice } : undefined
);

// Track price direction for flash animation
const priceDirection = ref('');
let lastPrice = 0;

const _ = computed(() => {
  if (!ticker.value) return;
  const current = ticker.value.lastPrice;
  if (lastPrice && current !== lastPrice) {
    priceDirection.value = current > lastPrice ? 'flash-up' : 'flash-down';
    setTimeout(() => { priceDirection.value = ''; }, 600);
  }
  lastPrice = current;
  return current;
});

function formatPrice(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatVolume(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${(value / 1_000).toFixed(1)}K`;
}

function onChartReady(chartInstance: IChartApi): void {
  chart.value = chartInstance;
}

async function fetchOhlc(): Promise<void> {
  try {
    const [candles, snapshot] = await Promise.all([
      krakenApi.fetchBtcOhlc(60, 168),
      krakenApi.fetchBtcTicker(),
    ]);
    chartData.value = candles;
    priceStore.btcUsd = {
      lastPrice: priceStore.btcUsd?.lastPrice ?? snapshot.lastPrice,
      open24h: snapshot.open24h,
      high24h: snapshot.high24h,
      low24h: snapshot.low24h,
      volume24h: snapshot.volume24h,
      priceChange: snapshot.priceChange,
      priceChangePercentage: snapshot.priceChangePercentage,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.warn('⛓ BitcoinPriceChart: Failed to fetch BTC data', error);
  }
}

onMounted(() => {
  setTimeout(async () => {
    await fetchOhlc();
    refreshInterval = setInterval(fetchOhlc, 60_000);
  }, 500);
});

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval);
});
</script>

<style scoped>
/* ─── Liquid Glass Card ─────────────────────────────────────── */
.btc-price-card {
  position: relative;
  background: rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 22px;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif;
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.18),
    0 16px 48px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    inset 0 -1px 0 rgba(0, 0, 0, 0.06);
  transition: box-shadow 0.3s ease;
}

.btc-price-card:hover {
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.22),
    0 24px 60px rgba(0, 0, 0, 0.36),
    0 0 0 1px rgba(247, 147, 26, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    inset 0 -1px 0 rgba(0, 0, 0, 0.08);
}

/* ─── Price Header ─────────────────────────────────────────── */
.price-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 14px;
  padding: 18px 20px 14px;
}

.price-left {
  display: flex;
  align-items: flex-start;
  gap: 13px;
}

.btc-symbol-ring {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(247, 147, 26, 0.28);
  background: rgba(247, 147, 26, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 18px rgba(247, 147, 26, 0.16), inset 0 1px 0 rgba(255,255,255,0.12);
  flex-shrink: 0;
}

.btc-logo {
  width: 25px;
  height: 25px;
}

.price-stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ticker-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.62);
}

.price-main-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.price-value {
  font-size: 28px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.95);
  letter-spacing: -0.025em;
  line-height: 1;
  transition: color 0.4s ease;
}

.price-value.flash-up {
  color: #30D158;
  text-shadow: 0 0 20px rgba(48, 209, 88, 0.4);
}

.price-value.flash-down {
  color: #FF453A;
  text-shadow: 0 0 20px rgba(255, 69, 58, 0.4);
}

/* ─── Change Badge (iOS capsule) ────────────────────────────── */
.change-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
}

.change-badge--up {
  background: rgba(48, 209, 88, 0.16);
  color: #30D158;
  border: 1px solid rgba(48, 209, 88, 0.22);
}

.change-badge--down {
  background: rgba(255, 69, 58, 0.16);
  color: #FF453A;
  border: 1px solid rgba(255, 69, 58, 0.22);
}

/* ─── Price Label Row ──────────────────────────────────────── */
.price-label-row {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.58);
}

.live-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #30D158;
  font-weight: 600;
}

.live-dot-price {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #30D158;
  animation: dot-blink 2s ease-in-out infinite;
}

@keyframes dot-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.2; }
}

.separator { opacity: 0.3; }

/* ─── Stats Grid ────────────────────────────────────────────── */
.stats-grid {
  display: flex;
  align-items: center;
  gap: 0;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 14px;
  overflow: hidden;
}

.stat-cell {
  padding: 9px 16px;
  text-align: center;
}

.stat-divider {
  width: 1px;
  height: 30px;
  background: rgba(255, 255, 255, 0.08);
}

.stat-cell-label {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.03em;
  color: rgba(255, 255, 255, 0.58);
  margin-bottom: 4px;
}

.stat-cell-value {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: -0.01em;
}

.stat-cell-value--high { color: #30D158; }
.stat-cell-value--low  { color: #FF453A; }

/* ─── Chart ────────────────────────────────────────────────── */
.chart-wrapper {
  border-radius: 0 0 21px 21px;
  overflow: hidden;
  position: relative;
}
</style>