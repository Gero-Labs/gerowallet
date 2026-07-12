<template>
  <div class="col-center">
    <!-- OB / Trades toggle -->
    <div class="ob-header">
      <span
        class="ob-tab"
        :class="{ 'ob-tab--active': obView === 'book' }"
        @click="obView = 'book'"
      >
        {{ $t('perpetuals.orderBook') }}
      </span>
      <span
        class="ob-tab"
        :class="{ 'ob-tab--active': obView === 'trades' }"
        @click="obView = 'trades'"
      >
        {{ $t('perpetuals.trades') }}
      </span>
    </div>

    <!-- Order Book view -->
    <div v-if="obView === 'book'" ref="obContainerRef" class="ob-content">
      <!-- Filter icons + tick size -->
      <div class="ob-filter-row">
        <div class="ob-filter-icons">
          <span
            class="ob-filter-icon"
            :class="{ 'ob-filter-icon--active': obFilter === 'both' }"
            @click="obFilter = 'both'"
          >
            <span class="ob-filter-bar ob-filter-bar--red" />
            <span class="ob-filter-bar ob-filter-bar--green" />
          </span>
          <span
            class="ob-filter-icon"
            :class="{ 'ob-filter-icon--active': obFilter === 'bids' }"
            @click="obFilter = 'bids'"
          >
            <span class="ob-filter-bar ob-filter-bar--green ob-filter-bar--big" />
          </span>
          <span
            class="ob-filter-icon"
            :class="{ 'ob-filter-icon--active': obFilter === 'asks' }"
            @click="obFilter = 'asks'"
          >
            <span class="ob-filter-bar ob-filter-bar--red ob-filter-bar--big" />
          </span>
        </div>
        <v-menu offset-y left :attach="true" content-class="ob-tick-menu">
          <template #activator="{ on, attrs }">
            <span class="ob-tick-trigger" v-bind="attrs" v-on="on">
              {{ obTickSize }}
              <v-icon size="12" class="ml-1">mdi-chevron-down</v-icon>
            </span>
          </template>
          <v-list dense dark class="ob-tick-list">
            <v-list-item
              v-for="ts in tickSizeOptions"
              :key="ts"
              @click="obTickSize = ts"
              :class="{ 'ob-tick-list__item--active': obTickSize === ts }"
            >
              <v-list-item-title>{{ ts }}</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>

      <div class="ob-col-headers">
        <span>{{ $t('perpetuals.price') }}(USD)</span>
        <span>{{ $t('perpetuals.size') }}({{ baseAsset }})</span>
        <span>{{ $t('perpetuals.total') }}({{ baseAsset }})</span>
      </div>

      <!-- Asks (red, reversed so lowest ask is at bottom) -->
      <div v-if="obFilter !== 'bids'" class="ob-asks">
        <div
          v-for="(ask, i) in displayAsks"
          :key="'a' + i"
          class="ob-row ob-row--ask"
        >
          <div
            class="ob-row-bg ob-row-bg--ask"
            :style="{ width: ask.pct + '%' }"
          />
          <span class="ob-cell ob-price clr-red ob-cell--left">{{ ask.price }}</span>
          <span class="ob-cell ob-cell--center">{{ formatOBSize(ask.size) }}</span>
          <span class="ob-cell ob-cell--right">{{ formatOBSize(ask.total) }}</span>
        </div>
      </div>

      <!-- Spread / mid-price -->
      <div class="ob-spread">
        <span class="ob-spread__price" :class="lastTradeClass">
          {{ formatPrice(liveMarkPrice ?? currentTicker?.lastPrice) }}
          <v-icon size="11" :color="lastTradeClass === 'clr-green' ? 'success' : 'error'">
            {{ lastTradeClass === 'clr-green' ? 'mdi-arrow-up-bold' : 'mdi-arrow-down-bold' }}
          </v-icon>
        </span>
        <span class="ob-spread__info">
          Spread: {{ spreadValue }}/{{ spreadPercent }}
        </span>
      </div>

      <!-- Bids (green) -->
      <div v-if="obFilter !== 'asks'" class="ob-bids">
        <div
          v-for="(bid, i) in displayBids"
          :key="'b' + i"
          class="ob-row ob-row--bid"
        >
          <div
            class="ob-row-bg ob-row-bg--bid"
            :style="{ width: bid.pct + '%' }"
          />
          <span class="ob-cell ob-price clr-green ob-cell--left">{{ bid.price }}</span>
          <span class="ob-cell ob-cell--center">{{ formatOBSize(bid.size) }}</span>
          <span class="ob-cell ob-cell--right">{{ formatOBSize(bid.total) }}</span>
        </div>
      </div>

      <!-- Buy / Sell ratio bar -->
      <div class="ob-ratio">
        <div class="ob-ratio__bar">
          <div class="ob-ratio__buy" :style="{ width: buyRatioPct + '%' }" />
          <div class="ob-ratio__sell" :style="{ width: (100 - buyRatioPct) + '%' }" />
        </div>
        <div class="ob-ratio__labels">
          <span class="clr-green">B {{ buyRatioPct.toFixed(2) }}%</span>
          <span class="clr-red">{{ (100 - buyRatioPct).toFixed(2) }}% S</span>
        </div>
      </div>
    </div>

    <!-- Recent Trades view -->
    <div v-else class="ob-content">
      <div class="ob-col-headers">
        <span>Price</span>
        <span>Size ({{ baseAsset }})</span>
        <span>Time</span>
      </div>
      <div class="ob-trades-list">
        <div
          v-for="(trade, i) in recentTrades"
          :key="'t' + i"
          class="ob-row"
        >
          <span class="ob-cell ob-price" :class="trade.isBuyerMaker ? 'clr-red' : 'clr-green'">
            {{ trade.price }}
          </span>
          <span class="ob-cell ob-cell--center">{{ formatOBSize(trade.qty) }}</span>
          <span class="ob-cell ob-cell--right ob-time">{{ formatTradeTime(trade.time) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { toRef } from 'vue';
import { useOrderBook, usePerpsFormatters } from '@/modules/market/composables/perps';
import type { Ticker24hrResponse } from '@/api/strike-v2.types';

const props = defineProps<{
  selectedSymbol: string;
  baseAsset: string;
  liveMarkPrice: string | null;
  currentTicker: Ticker24hrResponse;
  lastTradeClass: string;
}>();

const selectedSymbolRef = toRef(props, 'selectedSymbol');

const {
  formatPrice, formatOBSize, formatTradeTime,
} = usePerpsFormatters();

const {
  obView, obFilter, obTickSize, tickSizeOptions,
  obContainerRef,
  displayAsks, displayBids, spreadValue, spreadPercent, buyRatioPct,
  recentTrades,
} = useOrderBook(selectedSymbolRef);
</script>

<style scoped>
.col-center {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--g-hairline-2);
  min-width: 210px;
  overflow: hidden;
}

.ob-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--g-hairline-2);
  flex-shrink: 0;
  height: 31.5px;
}

.ob-filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  flex-shrink: 0;
}

.ob-filter-icons {
  display: flex;
  gap: 6px;
}

.ob-filter-icon {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 3px 4px;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.5;
}

.ob-filter-icon--active {
  opacity: 1;
  background: var(--g-hairline-1);
}

.ob-filter-bar {
  display: block;
  width: 14px;
  height: 3px;
  border-radius: 4px;
}

.ob-filter-bar--green { background: var(--g-success); }
.ob-filter-bar--red { background: var(--g-error); }
.ob-filter-bar--big { height: 8px; }

.ob-tick-trigger {
  display: flex;
  align-items: center;
  font-size: 11px;
  font-weight: 500;
  color: var(--g-text-1);
  font-family: var(--g-font-mono);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}

.ob-tick-trigger:hover {
  background: var(--g-hairline-1);
}

.ob-tick-trigger .v-icon {
  color: var(--g-text-3) !important;
}

.ob-tick-menu {
  min-width: 100px !important;
}

.ob-tick-list {
  background: var(--g-overlay) !important;
  padding: 4px 0 !important;
}

.ob-tick-list .v-list-item {
  min-height: 28px !important;
}

.ob-tick-list .v-list-item__title {
  font-size: 11px !important;
  font-weight: 500;
  color: var(--g-text-1);
  font-family: var(--g-font-mono);
}

.ob-tick-list__item--active .v-list-item__title {
  color: var(--g-success);
  font-weight: 600;
}

.ob-tab {
  font-size: 11px;
  color: var(--g-text-3);
  padding: 2px 8px;
  cursor: pointer;
  border-radius: 4px;
  font-weight: 600;
}
.ob-tab:hover { background: var(--g-hairline-1); }
.ob-tab--active { color: var(--g-text-1); background: var(--g-hairline-1); }

.ob-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: var(--g-font-mono);
  font-size: 11px;
}

.ob-col-headers {
  display: flex;
  justify-content: space-between;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--g-text-3);
  border-bottom: 1px solid var(--g-hairline-1);
}

.ob-asks, .ob-bids {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ob-trades-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.ob-asks {
  justify-content: flex-end;
}

.ob-row {
  display: flex;
  justify-content: space-between;
  padding: 1px 8px;
  position: relative;
  line-height: 18px;
  transition: background-color 0.15s ease-out;
}

.ob-row:hover {
  background: var(--g-hairline-1);
}

.ob-row-bg {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  pointer-events: none;
  transition: width 0.2s ease-out;
}

.ob-row-bg--ask {
  background: linear-gradient(to left, var(--g-error-line), transparent);
}

.ob-row-bg--bid {
  background: linear-gradient(to left, var(--g-success-line), transparent);
}

@media (prefers-reduced-motion: reduce) {
  .ob-row-bg {
    transition: none;
  }
}

.ob-cell {
  position: relative;
  z-index: 1;
  color: var(--g-text-1);
  min-width: 0;
  flex: 1;
  text-align: right;
}
.ob-cell:first-child { text-align: left; }
.ob-cell.ob-cell--left { text-align: left; }
.ob-cell.ob-cell--center { text-align: center; }
.ob-cell.ob-cell--right { text-align: right; }

.ob-price { font-weight: 600; }

.ob-time {
  font-size: 11px;
  color: var(--g-text-3);
}

.ob-spread {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-top: 1px solid var(--g-hairline-2);
  border-bottom: 1px solid var(--g-hairline-2);
  background: var(--g-hairline-1);
}

.ob-spread__price {
  font-size: 13px;
  font-weight: 700;
  font-family: var(--g-font-mono);
}

.ob-spread__info {
  font-size: 11px;
  color: var(--g-text-3);
}

.ob-ratio {
  padding: 6px 8px;
  flex-shrink: 0;
}

.ob-ratio__bar {
  display: flex;
  height: 4px;
  border-radius: 4px;
  overflow: hidden;
}

.ob-ratio__buy { background: var(--g-success); }
.ob-ratio__sell { background: var(--g-error); }

.ob-ratio__labels {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  margin-top: 2px;
}
</style>
