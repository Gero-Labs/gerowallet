<template>
  <div class="market-page">
    <!-- Search -->
    <div class="search-bar">
      <v-text-field
        v-model="searchQuery"
        :placeholder="$t('miniGero.marketSearch')"
        prepend-inner-icon="mdi-magnify"
        outlined
        dense
        dark
        hide-details
        clearable
        class="search-input"
      />
    </div>

    <!-- Filter chips (drag-scrollable) -->
    <div
      class="filter-chips"
      ref="chipsRef"
      @pointerdown="onChipPointerDown"
      @pointermove="onChipPointerMove"
      @pointerup="onChipPointerUp"
      @pointercancel="onChipPointerUp"
    >
      <button
        v-for="filter in filters"
        :key="filter.id"
        class="chip"
        :class="{ active: activeFilter === filter.id }"
        @click="!chipDragged && (activeFilter = filter.id)"
      >
        {{ filter.label }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading && displayTokens.length === 0" class="loading-state">
      <v-progress-circular indeterminate color="#00c7f3" size="32" />
    </div>

    <!-- Token list -->
    <div v-else-if="displayTokens.length > 0" class="token-list">
      <div
        v-for="token in displayTokens"
        :key="token.unit"
        class="token-row"
        @click="selectToken(token)"
      >
        <div class="token-left">
          <v-avatar size="36" class="token-avatar">
            <img
              v-if="token.img"
              :src="token.img"
              :alt="token.ticker"
              @error="onImgError($event)"
            />
            <v-icon v-else size="20" color="#888">mdi-circle-outline</v-icon>
          </v-avatar>
          <div class="token-info">
            <div class="token-name text-body-2 white--text">
              {{ token.ticker || token.name }}
              <v-icon
                v-if="token.verified"
                x-small
                color="primary"
                class="ml-1"
                style="margin-top: -2px"
              >mdi-check-decagram</v-icon>
            </div>
            <div class="token-sub text-caption grey--text">
              {{ formatCompact(token.volume24h) }} {{ $t('miniGero.vol') }}
            </div>
          </div>
        </div>
        <div class="token-right">
          <div class="token-price text-body-2 white--text">
            {{ formatPrice(token.price) }}
          </div>
          <div
            class="token-change text-caption"
            :class="token.change24h >= 0 ? 'green-text' : 'red-text'"
          >
            {{ token.change24h >= 0 ? '+' : '' }}{{ token.change24h.toFixed(2) }}%
          </div>
        </div>
      </div>
    </div>

    <!-- Empty -->
    <div v-else class="empty-state">
      <v-icon size="40" color="#333">mdi-chart-line</v-icon>
      <div class="text-body-2 grey--text mt-2">{{ $t('miniGero.noMarketData') }}</div>
    </div>

    <!-- Token Detail Bottom Sheet -->
    <BottomSheet
      :value="showDetail"
      @input="showDetail = $event"
      :title="selectedToken?.ticker || selectedToken?.name || ''"
      height="70%"
    >
      <div v-if="selectedToken" class="token-detail">
        <div class="detail-header">
          <v-avatar size="48" class="mb-3">
            <img
              v-if="selectedToken.img"
              :src="selectedToken.img"
              :alt="selectedToken.ticker"
            />
            <v-icon v-else size="28" color="#888">mdi-circle-outline</v-icon>
          </v-avatar>
          <div class="text-h6 white--text font-weight-bold">
            {{ selectedToken.ticker || selectedToken.name }}
          </div>
          <div class="text-body-2 grey--text">
            {{ formatPrice(selectedToken.price) }}
            <span
              :class="selectedToken.change24h >= 0 ? 'green-text' : 'red-text'"
              class="ml-1"
            >
              {{ selectedToken.change24h >= 0 ? '+' : '' }}{{ selectedToken.change24h.toFixed(2) }}%
            </span>
          </div>
        </div>

        <v-divider dark class="my-4" />

        <!-- Market data rows -->
        <div class="detail-row" v-if="selectedToken.mcap">
          <span class="text-caption grey--text">{{ $t('miniGero.marketCap') }}</span>
          <span class="text-body-2 white--text">{{ formatCompact(selectedToken.mcap) }}</span>
        </div>
        <div class="detail-row" v-if="selectedToken.volume24h">
          <span class="text-caption grey--text">{{ $t('miniGero.volume24h') }}</span>
          <span class="text-body-2 white--text">{{ formatCompact(selectedToken.volume24h) }}</span>
        </div>
        <div class="detail-row" v-if="selectedToken.tvl">
          <span class="text-caption grey--text">{{ $t('miniGero.tvl') }}</span>
          <span class="text-body-2 white--text">{{ formatCompact(selectedToken.tvl) }}</span>
        </div>
        <div class="detail-row" v-if="selectedToken.liquidity">
          <span class="text-caption grey--text">{{ $t('miniGero.liquidity') }}</span>
          <span class="text-body-2 white--text">{{ formatCompact(selectedToken.liquidity) }}</span>
        </div>
        <div class="detail-row" v-if="selectedToken.holders">
          <span class="text-caption grey--text">{{ $t('miniGero.holders') }}</span>
          <span class="text-body-2 white--text">{{ selectedToken.holders.toLocaleString('en-US') }}</span>
        </div>
        <div class="detail-row" v-if="!selectedToken.isNative">
          <span class="text-caption grey--text">{{ $t('miniGero.priceInAda') }}</span>
          <span class="text-body-2 white--text">{{ formatAdaPrice(selectedToken.priceAda) }}</span>
        </div>

        <!-- Change timeframes -->
        <v-divider dark class="my-3" />
        <div class="change-row">
          <div class="change-item" v-if="selectedToken.change1h">
            <span class="text-caption grey--text">1h</span>
            <span
              class="text-caption font-weight-medium"
              :class="selectedToken.change1h >= 0 ? 'green-text' : 'red-text'"
            >
              {{ selectedToken.change1h >= 0 ? '+' : '' }}{{ selectedToken.change1h.toFixed(2) }}%
            </span>
          </div>
          <div class="change-item">
            <span class="text-caption grey--text">24h</span>
            <span
              class="text-caption font-weight-medium"
              :class="selectedToken.change24h >= 0 ? 'green-text' : 'red-text'"
            >
              {{ selectedToken.change24h >= 0 ? '+' : '' }}{{ selectedToken.change24h.toFixed(2) }}%
            </span>
          </div>
          <div class="change-item" v-if="selectedToken.change7d">
            <span class="text-caption grey--text">7d</span>
            <span
              class="text-caption font-weight-medium"
              :class="selectedToken.change7d >= 0 ? 'green-text' : 'red-text'"
            >
              {{ selectedToken.change7d >= 0 ? '+' : '' }}{{ selectedToken.change7d.toFixed(2) }}%
            </span>
          </div>
        </div>

        <!-- Holdings (if user owns this token) -->
        <template v-if="selectedTokenBalance">
          <v-divider dark class="my-3" />
          <div class="detail-row">
            <span class="text-caption grey--text">{{ $t('miniGero.yourBalance') }}</span>
            <span class="text-body-2 white--text">{{ selectedTokenBalance }}</span>
          </div>
        </template>
      </div>
    </BottomSheet>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useMarketData, type MarketToken } from '@/modules/market/composables/useMarketData';
import { walletStore } from '@/stores/walletStore';
import { getBalance } from '@/chrome/serialization';
import BottomSheet from '../components/BottomSheet.vue';

const { t } = useTranslation();
const {
  allTokens,
  trendingTokens,
  topGainers,
  topLosers,
  loading,
  searchTokens,
} = useMarketData();

const searchQuery = ref('');
const activeFilter = ref('all');
const showDetail = ref(false);
const selectedToken = ref<MarketToken | null>(null);
const chipsRef = ref<HTMLElement | null>(null);

// Drag scroll for filter chips
let chipDragStartX = 0;
let chipScrollLeft = 0;
let chipDragging = false;
let chipDragged = false;

function onChipPointerDown(e: PointerEvent) {
  const el = chipsRef.value;
  if (!el) return;
  chipDragging = true;
  chipDragged = false;
  chipDragStartX = e.clientX;
  chipScrollLeft = el.scrollLeft;
  el.setPointerCapture(e.pointerId);
}

function onChipPointerMove(e: PointerEvent) {
  if (!chipDragging) return;
  const dx = e.clientX - chipDragStartX;
  if (Math.abs(dx) > 5) chipDragged = true;
  const el = chipsRef.value;
  if (el) el.scrollLeft = chipScrollLeft - dx;
}

function onChipPointerUp(e: PointerEvent) {
  if (!chipDragging) return;
  chipDragging = false;
  chipsRef.value?.releasePointerCapture(e.pointerId);
}

const filters = computed(() => [
  { id: 'all', label: t('miniGero.all') },
  { id: 'trending', label: t('miniGero.trending') },
  { id: 'gainers', label: t('miniGero.gainers') },
  { id: 'losers', label: t('miniGero.losers') },
]);

const displayTokens = computed(() => {
  // Search takes priority
  if (searchQuery.value && searchQuery.value.trim()) {
    return searchTokens(searchQuery.value);
  }

  switch (activeFilter.value) {
    case 'trending':
      return trendingTokens.value;
    case 'gainers':
      return topGainers.value;
    case 'losers':
      return topLosers.value;
    default:
      return allTokens.value;
  }
});

const selectedTokenBalance = computed(() => {
  if (!selectedToken.value) return '';
  const token = selectedToken.value;

  if (token.isNative || token.unit === 'lovelace') {
    // ADA balance
    const utxos = walletStore.utxos;
    if (!utxos || utxos.length === 0) return '';
    try {
      const balance = getBalance(utxos, walletStore.collateral);
      const ada = Number(balance.coin().toString()) / 1_000_000;
      return ada.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ADA';
    } catch {
      return '';
    }
  }

  // Non-ADA token
  const walletToken = walletStore.tokens?.[token.unit];
  if (!walletToken) return '';
  const decimals = token.decimals || 0;
  let amount = Number(walletToken.quantity || 0);
  if (decimals > 0) amount = amount / Math.pow(10, decimals);
  if (amount === 0) return '';
  return amount.toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' ' + (token.ticker || '');
});

function selectToken(token: MarketToken) {
  selectedToken.value = token;
  showDetail.value = true;
}

function formatPrice(price: number): string {
  if (!price) return '--';
  if (price < 0.001) return '<$0.001';
  return '$' + price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: price < 1 ? 6 : 2,
  });
}

function formatAdaPrice(price: number): string {
  if (!price) return '--';
  return '₳' + price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: price < 1 ? 8 : 4,
  });
}

function formatCompact(value: number): string {
  if (!value) return '--';
  if (value >= 1_000_000_000) return '$' + (value / 1_000_000_000).toFixed(2) + 'B';
  if (value >= 1_000_000) return '$' + (value / 1_000_000).toFixed(2) + 'M';
  if (value >= 1_000) return '$' + (value / 1_000).toFixed(2) + 'K';
  return '$' + value.toFixed(2);
}

function onImgError(event: Event) {
  const img = event.target as HTMLImageElement;
  img.style.display = 'none';
}
</script>

<style scoped>
.market-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px 0;
}

.search-bar {
  padding: 0 14px 8px;
}

.search-input >>> .v-input__slot {
  background: rgba(255, 255, 255, 0.04) !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
  border-radius: 10px !important;
  min-height: 38px !important;
}

.filter-chips {
  display: flex;
  gap: 8px;
  padding: 0 14px 12px;
  overflow-x: auto;
  scrollbar-width: none;
  cursor: grab;
  touch-action: pan-x;
}

.filter-chips:active {
  cursor: grabbing;
}

.filter-chips::-webkit-scrollbar {
  display: none;
}

.chip {
  flex-shrink: 0;
  padding: 5px 14px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: #888;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.chip.active {
  background: rgba(0, 199, 243, 0.12);
  border-color: rgba(0, 199, 243, 0.3);
  color: #00c7f3;
}

.chip:hover:not(.active) {
  background: rgba(255, 255, 255, 0.08);
}

/* Token list */
.token-list {
  display: flex;
  flex-direction: column;
}

.token-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.15s ease;
  border-radius: 10px;
  margin: 1px 8px;
}

.token-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.token-row:active {
  background: rgba(255, 255, 255, 0.08);
}

.token-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.token-avatar {
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.06);
}

.token-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.token-name {
  font-size: 13px !important;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}

.token-sub {
  font-size: 11px !important;
}

.token-right {
  text-align: right;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
}

.token-price {
  font-size: 13px !important;
  font-weight: 500;
}

.token-change {
  font-size: 11px !important;
}

.green-text {
  color: #47CD89 !important;
}

.red-text {
  color: #F97066 !important;
}

/* Loading & empty */
.loading-state {
  display: flex;
  justify-content: center;
  padding: 48px 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 16px;
}

/* Token detail */
.token-detail {
  display: flex;
  flex-direction: column;
}

.detail-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #2a2a2a;
}

.detail-row:last-child {
  border-bottom: none;
}

.change-row {
  display: flex;
  justify-content: space-around;
}

.change-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
</style>
