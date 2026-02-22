<template>
  <v-card flat class="token-detail-panel">
    <!-- Header -->
    <div class="d-flex align-center pa-4 pb-2">
      <v-avatar size="36" class="mr-3">
        <img v-if="token.img" :src="token.img" :alt="token.ticker" />
        <v-icon v-else>mdi-circle-outline</v-icon>
      </v-avatar>
      <div class="flex-grow-1">
        <div class="d-flex align-center">
          <span class="text-h6 font-weight-bold mr-2">{{ token.ticker }}</span>
          <v-icon v-if="token.verified" small color="primary" class="mr-1">mdi-check-decagram</v-icon>
          <TokenRiskBadge v-if="token.riskRating" :rating="token.riskRating" size="small" />
        </div>
        <span class="text--secondary text-caption">{{ token.name }}</span>
      </div>
      <v-btn icon small @click="toggleWatch(token.unit)" class="mr-1">
        <v-icon :color="isWatched(token.unit) ? 'amber' : ''">
          {{ isWatched(token.unit) ? 'mdi-star' : 'mdi-star-outline' }}
        </v-icon>
      </v-btn>
      <v-btn icon small @click="$emit('close')">
        <v-icon>mdi-close</v-icon>
      </v-btn>
    </div>

    <!-- Scrollable content -->
    <div class="panel-scroll">
      <!-- Price -->
      <div class="px-4 pb-3">
        <span class="text-h5 font-weight-bold">{{ formatPrice(token.price) }}</span>
        <v-chip
          x-small
          :color="token.change24h >= 0 ? '#1b5e20' : '#b71c1c'"
          :text-color="token.change24h >= 0 ? '#47CD89' : '#F97066'"
          class="ml-2"
        >
          {{ token.change24h >= 0 ? '+' : '' }}{{ token.change24h.toFixed(2) }}%
        </v-chip>
        <div class="text--secondary text-caption mt-1">{{ token.priceAda.toFixed(token.priceAda < 1 ? 6 : 2) }} ₳</div>
      </div>

      <!-- Chart Section -->
      <div class="px-4 pb-2">
        <!-- Timeframe + Indicators bar (above chart) -->
        <div class="d-flex align-center mb-1" style="gap: 6px">
          <div class="timeframe-bar">
            <span
              v-for="tf in timeframeOptions"
              :key="tf.value"
              class="tf-btn"
              :class="{ active: selectedTimeframe === tf.value }"
              @click="selectedTimeframe = tf.value"
            >{{ tf.label }}</span>
          </div>

          <v-spacer />

          <!-- TA Indicator toggles -->
          <div class="d-flex align-center" style="gap: 2px">
            <v-tooltip bottom :open-delay="300" content-class="custom-tooltip" v-for="ind in indicatorOptions" :key="ind.value">
              <template v-slot:activator="{ on, attrs }">
                <span
                  v-bind="attrs"
                  v-on="on"
                  class="ind-btn"
                  :class="{ active: activeIndicators.includes(ind.value) }"
                  @click="toggleIndicator(ind.value)"
                >{{ ind.label }}</span>
              </template>
              <span>{{ $t(ind.tooltipKey) }}</span>
            </v-tooltip>
          </div>
        </div>

        <TechnicalAnalysisChart
          :candles="candles"
          :height="chartHeight"
          :indicators="activeIndicators"
        />
      </div>

      <!-- Stats Section -->
      <div class="px-4 pb-2">
        <v-simple-table dense class="transparent stats-table">
          <tbody>
            <tr v-for="stat in stats" :key="stat.label">
              <td class="text--secondary" style="width: 40%; font-size: 12px; padding: 4px 8px">
                <v-tooltip bottom :open-delay="300" content-class="custom-tooltip">
                  <template v-slot:activator="{ on, attrs }">
                    <span v-bind="attrs" v-on="on">{{ stat.label }}</span>
                  </template>
                  <span>{{ stat.tooltip }}</span>
                </v-tooltip>
              </td>
              <td class="text-right" style="font-size: 12px; padding: 4px 8px">
                <component :is="stat.component" v-if="stat.component" v-bind="stat.componentProps" />
                <span v-else>{{ stat.value }}</span>
              </td>
            </tr>
          </tbody>
        </v-simple-table>
      </div>

      <!-- Actions -->
      <div class="px-4 pb-4 pt-2">
        <v-btn
          color="primary"
          block
          @click="$emit('swap', token)"
          class="mb-2"
        >
          <v-icon small class="mr-2">mdi-swap-horizontal</v-icon>
          {{ $t('market.swap') }}
        </v-btn>
        <v-btn
          text
          small
          block
          @click="openExplorer"
        >
          <v-icon x-small class="mr-1">mdi-open-in-new</v-icon>
          {{ $t('market.viewOnExplorer') }}
        </v-btn>
      </div>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, watch, markRaw } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useWatchlist } from '@/modules/market/composables/useWatchlist';
import { useMarketData, type MarketToken } from '@/modules/market/composables/useMarketData';
import TechnicalAnalysisChart from './TechnicalAnalysisChart.vue';
import TokenRiskBadge from './TokenRiskBadge.vue';

const props = defineProps<{
  token: MarketToken;
}>();

defineEmits<{
  (e: 'close'): void;
  (e: 'swap', token: MarketToken): void;
}>();

const { t } = useTranslation();
const { isWatched, toggleWatchlist } = useWatchlist();
const { getTokenCandles } = useMarketData();

const selectedTimeframe = ref('1h');
const activeIndicators = ref<string[]>(['vol']);

const timeframeOptions = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W' },
];

function toggleIndicator(value: string) {
  const idx = activeIndicators.value.indexOf(value);
  if (idx >= 0) {
    activeIndicators.value.splice(idx, 1);
  } else {
    activeIndicators.value.push(value);
  }
}

const indicatorOptions = computed(() => [
  { value: 'vol', label: t('market.volumeIndicator'), tooltipKey: 'market.volumeTooltip' },
  { value: 'sma', label: 'SMA', tooltipKey: 'market.smaTooltip' },
  { value: 'ema', label: 'EMA', tooltipKey: 'market.emaTooltip' },
  { value: 'rsi', label: 'RSI', tooltipKey: 'market.rsiTooltip' },
  { value: 'macd', label: 'MACD', tooltipKey: 'market.macdTooltip' },
  { value: 'bb', label: 'BB', tooltipKey: 'market.bbTooltip' },
]);

const chartHeight = computed(() => {
  let height = 200;
  if (activeIndicators.value.includes('rsi')) height += 60;
  if (activeIndicators.value.includes('macd')) height += 60;
  return height + 'px';
});

const candles = computed(() => {
  return getTokenCandles(props.token.unit, selectedTimeframe.value);
});

const stats = computed(() => {
  const tok = props.token;
  return [
    { label: t('market.marketCap'), value: '$' + formatCompact(tok.mcap), tooltip: t('market.mcapTooltip') },
    { label: t('market.volume24h'), value: '$' + formatCompact(tok.volume24h), tooltip: t('market.volumeTooltip') },
    { label: t('market.tvl'), value: tok.tvl ? '$' + formatCompact(tok.tvl) : t('market.na'), tooltip: t('market.tvlTooltip') },
    { label: t('market.liquidity'), value: '$' + formatCompact(tok.liquidity), tooltip: t('market.liquidityTooltip') },
    { label: t('market.holders'), value: tok.holders.toLocaleString(), tooltip: t('market.holdersTooltip') },
    {
      label: t('market.risk'),
      value: tok.riskRating || t('market.na'),
      tooltip: t('market.riskTooltip'),
      component: tok.riskRating ? markRaw(TokenRiskBadge) : undefined,
      componentProps: tok.riskRating ? { rating: tok.riskRating, size: 'small' } : undefined,
    },
    {
      label: t('market.policy'),
      value: tok.policyLocked ? '🔒 ' + t('market.locked') : '⚠️ ' + t('market.open'),
      tooltip: tok.policyLocked ? t('market.policyLocked') : t('market.policyOpen'),
    },
    {
      label: t('market.verified'),
      value: tok.verified ? '✓ ' + t('market.yes') : t('market.no'),
      tooltip: t('market.verifiedTooltip'),
    },
  ];
});

function toggleWatch(unit: string) {
  toggleWatchlist(unit);
}

function formatPrice(price: number): string {
  if (price >= 1) return '$' + price.toFixed(2);
  if (price >= 0.01) return '$' + price.toFixed(4);
  return '$' + price.toFixed(6);
}

function formatCompact(value: number): string {
  if (value >= 1e9) return (value / 1e9).toFixed(1) + 'B';
  if (value >= 1e6) return (value / 1e6).toFixed(1) + 'M';
  if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
  return value.toFixed(0);
}

function openExplorer() {
  const fingerprint = props.token.fingerprint;
  window.open(`https://cardanoscan.io/token/${fingerprint}`, '_blank', 'noopener,noreferrer');
}

// Reset timeframe when token changes
watch(() => props.token, () => {
  selectedTimeframe.value = '1h';
});
</script>

<style scoped>
.token-detail-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  /* 70% of content area (viewport minus 270px nav drawer) */
  width: calc(70 * (100vw - 270px) / 100);
  z-index: 10;
  background: rgba(12, 14, 18, 0.65) !important;
  backdrop-filter: blur(24px) saturate(1.6);
  -webkit-backdrop-filter: blur(24px) saturate(1.6);
  border-left: 1px solid rgba(255, 255, 255, 0.10) !important;
  border-radius: 0 12px 12px 0;
  overflow: hidden;
  box-shadow:
    inset 1px 0 0 rgba(255, 255, 255, 0.06),
    -8px 0 32px rgba(0, 0, 0, 0.5);
  animation: panelSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes panelSlideIn {
  from {
    transform: translateX(40px);
    opacity: 0.6;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.panel-scroll {
  overflow-y: auto;
  height: calc(100% - 72px);
}

.timeframe-bar {
  display: flex;
  align-items: center;
  gap: 1px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 4px;
  padding: 1px;
}

.tf-btn {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.45);
  user-select: none;
  transition: color 0.15s, background 0.15s;
}

.tf-btn:hover {
  color: rgba(255, 255, 255, 0.8);
}

.tf-btn.active {
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
}

.ind-btn {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 5px;
  border-radius: 3px;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.35);
  user-select: none;
  transition: color 0.15s, background 0.15s;
}

.ind-btn:hover {
  color: rgba(255, 255, 255, 0.7);
}

.ind-btn.active {
  color: #90caf9;
  background: rgba(144, 202, 249, 0.1);
}

.stats-table >>> td {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04) !important;
}

.stats-table >>> tr:last-child td {
  border-bottom: none !important;
}
</style>
