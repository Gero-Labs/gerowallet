<template>
  <v-card flat class="liquid-glass-compact stat-bar mb-2" v-if="hottest.length && gainers.length && losers.length">
    <div class="stat-grid">
      <!-- Hottest column -->
      <div class="stat-col">
        <div class="stat-header" @click="expanded = !expanded">
          <v-icon x-small color="orange" class="mr-1">mdi-fire</v-icon>
          <span class="stat-label">{{ $t('market.hottest') }}</span>
          <span class="stat-ticker stat-ticker--link ml-1" @click.stop="$emit('token-click', hottest[0].unit)">{{ hottest[0].ticker }}</span>
          <span class="stat-value ml-1">${{ formatCompact(hottest[0].volume24h) }}</span>
        </div>
        <template v-if="expanded">
          <div
            v-for="(tok, i) in hottest.slice(1)"
            :key="'hot-' + tok.unit"
            class="stat-expand-row"
            @click="$emit('token-click', tok.unit)"
          >
            <span class="rank">{{ i + 2 }}</span>
            <span class="ticker">{{ tok.ticker }}</span>
            <span class="val ml-auto">${{ formatCompact(tok.volume24h) }}</span>
          </div>
        </template>
      </div>

      <span class="stat-divider" />

      <!-- Top Gainer column -->
      <div class="stat-col">
        <div class="stat-header" @click="expanded = !expanded">
          <v-icon x-small color="success" class="mr-1">mdi-trending-up</v-icon>
          <span class="stat-label">{{ $t('market.topGainer') }}</span>
          <span class="stat-ticker stat-ticker--link ml-1" @click.stop="$emit('token-click', gainers[0].unit)">{{ gainers[0].ticker }}</span>
          <span class="stat-value ml-1 g-num delta-up">{{ formatSignedChange(gainers[0].change24h) }}</span>
        </div>
        <template v-if="expanded">
          <div
            v-for="(tok, i) in gainers.slice(1)"
            :key="'gain-' + tok.unit"
            class="stat-expand-row"
            @click="$emit('token-click', tok.unit)"
          >
            <span class="rank">{{ i + 2 }}</span>
            <span class="ticker">{{ tok.ticker }}</span>
            <span class="val ml-auto g-num delta-up">{{ formatSignedChange(tok.change24h) }}</span>
          </div>
        </template>
      </div>

      <span class="stat-divider" />

      <!-- Top Loser column -->
      <div class="stat-col">
        <div class="stat-header" @click="expanded = !expanded">
          <v-icon x-small color="error" class="mr-1">mdi-trending-down</v-icon>
          <span class="stat-label">{{ $t('market.topLoser') }}</span>
          <span class="stat-ticker stat-ticker--link ml-1" @click.stop="$emit('token-click', losers[0].unit)">{{ losers[0].ticker }}</span>
          <span class="stat-value ml-1 g-num delta-down">{{ formatSignedChange(losers[0].change24h) }}</span>
        </div>
        <template v-if="expanded">
          <div
            v-for="(tok, i) in losers.slice(1)"
            :key="'lose-' + tok.unit"
            class="stat-expand-row"
            @click="$emit('token-click', tok.unit)"
          >
            <span class="rank">{{ i + 2 }}</span>
            <span class="ticker">{{ tok.ticker }}</span>
            <span class="val ml-auto g-num delta-down">{{ formatSignedChange(tok.change24h) }}</span>
          </div>
        </template>
      </div>

      <span class="stat-divider" />

      <!-- Total Volume -->
      <div class="stat-col stat-col--fixed">
        <div class="stat-header" @click="expanded = !expanded">
          <v-icon x-small color="primary" class="mr-1">mdi-chart-bar</v-icon>
          <span class="stat-label">{{ $t('market.totalVolume') }}</span>
          <span class="stat-value ml-1">${{ formatCompact(totalVolume) }}</span>
        </div>
      </div>

      <!-- Expand toggle -->
      <v-btn icon x-small @click="expanded = !expanded" class="expand-btn">
        <v-icon x-small>{{ expanded ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
      </v-btn>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { MarketToken } from '@/modules/market/composables/useMarketData';

const props = defineProps<{
  tokens: MarketToken[];
}>();

defineEmits<{
  (e: 'token-click', unit: string): void;
}>();

const expanded = ref(false);

const hottest = computed(() => {
  return [...props.tokens].sort((a, b) => b.volume24h - a.volume24h).slice(0, 5);
});

const gainers = computed(() => {
  return [...props.tokens].sort((a, b) => b.change24h - a.change24h).slice(0, 5);
});

const losers = computed(() => {
  return [...props.tokens].sort((a, b) => a.change24h - b.change24h).slice(0, 5);
});

const totalVolume = computed(() => {
  return props.tokens.reduce((sum, t) => sum + t.volume24h, 0);
});

import { formatCompact, formatSignedChange } from '@/modules/market/utils/formatters';
</script>

<style scoped>
.stat-bar {
  border-radius: 8px;
}

.stat-grid {
  display: flex;
  align-items: flex-start;
  padding: 0 12px;
  min-height: 40px;
}

.stat-col {
  flex: 1;
  min-width: 0;
  padding: 0 4px;
}

.stat-col--fixed {
  flex: 0 0 auto;
}

.stat-header {
  display: flex;
  align-items: center;
  white-space: nowrap;
  cursor: pointer;
  height: 40px;
}

.stat-label {
  font-size: 11px;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-ticker {
  font-size: 12px;
  font-weight: 600;
}

.stat-ticker--link {
  cursor: pointer;
  border-bottom: 1px dotted rgba(255, 255, 255, 0.25);
}

.stat-ticker--link:hover {
  color: #90caf9;
  border-bottom-color: #90caf9;
}

.stat-value {
  font-size: 12px;
  font-weight: 500;
}

.stat-divider {
  width: 1px;
  align-self: stretch;
  background: rgba(255, 255, 255, 0.08);
  margin: 8px 8px;
  flex-shrink: 0;
}

.stat-expand-row {
  display: flex;
  align-items: center;
  padding: 2px 4px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
}

.stat-expand-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.stat-expand-row:last-child {
  margin-bottom: 8px;
}

.stat-expand-row .rank {
  width: 14px;
  font-size: 10px;
  opacity: 0.35;
  flex-shrink: 0;
}

.stat-expand-row .ticker {
  font-weight: 600;
  margin-left: 2px;
}

.stat-expand-row .val {
  font-size: 12px;
  font-weight: 500;
}

.expand-btn {
  opacity: 0.4;
  flex-shrink: 0;
  align-self: center;
  margin-top: 8px;
}

.expand-btn:hover {
  opacity: 1;
}
</style>
