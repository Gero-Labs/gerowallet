<!-- src/sidepanel/components/agent/ChartCard.vue -->
<template>
  <div class="agent-chart-card">
    <div class="agent-chart-card__header">
      <span class="agent-chart-card__symbol">{{ symbol }}</span>
      <span v-if="error" class="agent-chart-card__error">{{ error }}</span>
    </div>
    <div v-if="loading" class="agent-chart-card__loading">{{ $t('copilot.chart.loading') }}</div>
    <TradingViewChart v-else-if="candles.length" :data="(candles as any)" height="180px" />
    <div v-else-if="!error" class="agent-chart-card__empty">{{ $t('copilot.chart.noData') }}</div>
  </div>
</template>

<script lang="ts">
import { defineComponent, onMounted, ref } from 'vue';
import TradingViewChart from '@/shared/components/TradingViewChart.vue';
import marketApi, { type CandleResponse } from '@/api/market-api';

export default defineComponent({
  name: 'ChartCard',
  components: { TradingViewChart },
  props: {
    symbol: { type: String, required: true },
    assetId: { type: String, default: null },
  },
  setup(props) {
    const candles = ref<CandleResponse[]>([]);
    const loading = ref(true);
    const error = ref('');

    onMounted(async () => {
      if (!props.assetId) {
        error.value = 'Token not found';
        loading.value = false;
        return;
      }
      try {
        candles.value = await marketApi.getCandles(props.assetId, '1h');
      } catch {
        error.value = 'Could not load chart';
      } finally {
        loading.value = false;
      }
    });

    return { candles, loading, error };
  },
});
</script>

<style scoped>
.agent-chart-card {
  border-radius: 12px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.04);
}

.agent-chart-card__header {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 4px;
}

.agent-chart-card__symbol {
  font-weight: 600;
}

.agent-chart-card__error,
.agent-chart-card__empty,
.agent-chart-card__loading {
  opacity: 0.7;
  font-size: 12px;
}
</style>
