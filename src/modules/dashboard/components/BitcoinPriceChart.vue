<template>
  <!-- The Bitcoin dashboard's price hero: the same card as Cardano's ADA hero,
       with Kraken's BTC/USD candles and the 24h range under the price. -->
  <PriceHeroCard
    :name="$t('assets.bitcoin')"
    ticker="BTC"
    :price="ticker?.lastPrice ?? null"
    :change="ticker ? ticker.priceChangePercentage : null"
    :load-points="loadPoints"
    :format-value="formatUsd"
    :price-precision="0"
    chart-min-height="160px"
  >
    <template #stats>
      <dl v-if="ticker" class="btc-stats">
        <div class="btc-stats__item">
          <dt class="t-label">{{ $t('bitcoin.twentyFourHourHigh') }}</dt>
          <dd class="g-num">{{ formatUsd(ticker.high24h) }}</dd>
        </div>
        <div class="btc-stats__item">
          <dt class="t-label">{{ $t('bitcoin.twentyFourHourLow') }}</dt>
          <dd class="g-num">{{ formatUsd(ticker.low24h) }}</dd>
        </div>
        <div class="btc-stats__item">
          <dt class="t-label">{{ $t('bitcoin.twentyFourHourVolume') }}</dt>
          <!-- Kraken reports 24h volume in BTC, not dollars -->
          <dd class="g-num">{{ formatCompact(ticker.volume24h) }} BTC</dd>
        </div>
      </dl>
    </template>
  </PriceHeroCard>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import krakenApi from '@/api/kraken-api';
import { priceStore } from '@/stores/priceStore';
import { formatCompact, formatUsd } from '@/shared/utils/format';
import PriceHeroCard from '@/modules/portfolio/components/PriceHeroCard.vue';
import type { PricePointsLoader, PriceRangeKey } from '@/modules/portfolio/components/priceHero';

const ticker = computed(() => priceStore.btcUsd);

// Kraken OHLC: candle interval in minutes, and how many of the latest candles cover the range
const CANDLES: Record<PriceRangeKey, { interval: number; count: number }> = {
  '24h': { interval: 15, count: 96 },
  '7d': { interval: 60, count: 168 },
  '30d': { interval: 240, count: 180 },
  '1y': { interval: 1440, count: 365 },
};

const loadPoints: PricePointsLoader = (range) =>
  krakenApi.fetchBtcOhlc(CANDLES[range.key].interval, CANDLES[range.key].count);

let refreshInterval: ReturnType<typeof setInterval> | null = null;
let firstFetch: ReturnType<typeof setTimeout> | null = null;

// The 24h figures come from Kraken's ticker. The live last price arrives from
// the price feed, so a snapshot only fills it in until that feed has one.
async function fetchTicker(): Promise<void> {
  try {
    const snapshot = await krakenApi.fetchBtcTicker();
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
    console.warn('BitcoinPriceChart: failed to fetch the BTC ticker', error);
  }
}

let mounted = false;

onMounted(() => {
  mounted = true;
  firstFetch = setTimeout(async () => {
    await fetchTicker();
    if (mounted) refreshInterval = setInterval(fetchTicker, 60_000);
  }, 500);
});

onUnmounted(() => {
  mounted = false;
  if (firstFetch) clearTimeout(firstFetch);
  if (refreshInterval) clearInterval(refreshInterval);
});
</script>

<style scoped>
.btc-stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-5);
  margin: var(--g-s-2) 0 0;
}

.btc-stats__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.btc-stats__item dd {
  margin: 0;
  color: var(--g-text-1);
  font-size: 13px;
}
</style>
