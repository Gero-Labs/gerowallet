<template>
  <!-- Empty-wallet hero: the asset the user is about to buy, in the exact slot
       the portfolio chart occupies once they own it. -->
  <PriceHeroCard
    :name="$t('assets.cardano')"
    ticker="ADA"
    :price="price"
    :change="change"
    :load-points="loadPoints"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useMarketData } from '@/modules/market/composables/useMarketData';
import PriceHeroCard from './PriceHeroCard.vue';
import type { PricePointsLoader, PriceRangeKey } from './priceHero';

const { adaData, getTokenCandles } = useMarketData();

const price = computed(() => adaData.value?.priceUsd ?? null);
const change = computed(() => (adaData.value ? adaData.value.priceChange24h ?? 0 : null));

// Candle timeframes reuse getTokenCandles' backend mapping ('15m'/'1h'/'1D');
// the fetch returns the full lookback window and the card slices it to the range.
const TIMEFRAMES: Record<PriceRangeKey, string> = { '24h': '15m', '7d': '1h', '30d': '1h', '1y': '1d' };

const loadPoints: PricePointsLoader = (range) => getTokenCandles('lovelace', TIMEFRAMES[range.key], 'usd');
</script>
