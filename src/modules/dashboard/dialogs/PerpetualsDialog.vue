<template>
  <v-dialog v-model="dialogVisible" fullscreen transition="dialog-bottom-transition">
    <v-card dark class="perps-terminal">

      <!-- ═══════════════════════════════════════════════════════════════════
           ROW 1 — Symbol Tabs (scrollable)
           ═══════════════════════════════════════════════════════════════════ -->
      <div class="symbol-tabs-bar">
        <v-card-title class="px-1">{{ $t('navigation.perpetuals') }}</v-card-title>

        <div class="symbol-tabs-scroll">
          <div
            v-for="name in symbolNames"
            :key="name"
            class="symbol-tab"
            :class="{ 'symbol-tab--active': name === selectedSymbol }"
            @click="selectedSymbol = name"
          >
            <v-icon
              x-small
              class="mr-1 star-icon"
              :color="isFavorite(name) ? '#F0B90B' : '#848e9c'"
              @click.stop="toggleFavorite(name)"
            >
              {{ isFavorite(name) ? 'mdi-star' : 'mdi-star-outline' }}
            </v-icon>
            <span class="symbol-tab__name">{{ name }}</span>
            <span
              class="symbol-tab__change ml-1"
              :class="getTickerChangeClass(name)"
            >
              {{ formatChange(tickers[name]?.priceChangePercent) }}%
            </span>
          </div>
        </div>

        <v-spacer />

        <v-btn icon small class="mr-1" @click="close">
          <v-icon size="18">mdi-close</v-icon>
        </v-btn>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════════
           ROW 2 — Price Info Bar
           ═══════════════════════════════════════════════════════════════════ -->
      <div class="price-info-bar">
        <div class="symbol-pair">
          <img src="@/assets/svg/cardano-blue.svg" alt="" class="symbol-pair__icon" />
          <span class="symbol-pair__name">{{ selectedSymbol }}</span>
        </div>

        <template v-if="currentTicker">
          <div class="price-info-item">
            <v-tooltip bottom content-class="custom-tooltip" max-width="260">
              <template #activator="{ on, attrs }">
                <span class="price-info-label price-info-label--dashed" v-bind="attrs" v-on="on">{{ $t('perpetuals.markPrice') }}</span>
              </template>
              <span>{{ $t('perpetuals.markPriceTooltip') }}</span>
            </v-tooltip>
            <span
              class="price-info-value"
              :class="{
                'price-flash-up': markPriceFlash === 'up',
                'price-flash-down': markPriceFlash === 'down',
              }"
            >{{ formatPrice(liveMarkPrice ?? currentFunding?.markPrice) }}</span>
          </div>
          <div class="price-info-item">
            <v-tooltip bottom content-class="custom-tooltip" max-width="260">
              <template #activator="{ on, attrs }">
                <span class="price-info-label price-info-label--dashed" v-bind="attrs" v-on="on">{{ $t('perpetuals.indexPrice') }}</span>
              </template>
              <span>{{ $t('perpetuals.indexPriceTooltip') }}</span>
            </v-tooltip>
            <span class="price-info-value">{{ formatPrice(liveIndexPrice ?? currentFunding?.indexPrice) }}</span>
          </div>
          <div class="price-info-item">
            <v-tooltip bottom content-class="custom-tooltip" max-width="280">
              <template #activator="{ on, attrs }">
                <span class="price-info-label price-info-label--dashed" v-bind="attrs" v-on="on">{{ $t('perpetuals.fundingCountdown') }}</span>
              </template>
              <span>{{ $t('perpetuals.fundingCountdownTooltip') }}</span>
            </v-tooltip>
            <div class="funding-value-row">
              <span class="price-info-value" :class="fundingClass">
                {{ formatFundingRate(liveFundingRate ?? currentFunding?.lastFundingRate) }}
              </span>
              <span class="price-info-countdown">/ {{ fundingCountdown }}</span>
            </div>
          </div>
          <div class="price-info-item">
            <span class="price-info-label">{{ $t('perpetuals.24hChange') }}</span>
            <span class="price-info-value" :class="tickerChangeClass">
              {{ formatChange(currentTicker.priceChangePercent) }}%
            </span>
          </div>
          <div class="price-info-item">
            <span class="price-info-label">{{ $t('perpetuals.24hHigh') }}</span>
            <span class="price-info-value">{{ formatPrice(currentTicker.highPrice) }}</span>
          </div>
          <div class="price-info-item">
            <span class="price-info-label">{{ $t('perpetuals.24hLow') }}</span>
            <span class="price-info-value">{{ formatPrice(currentTicker.lowPrice) }}</span>
          </div>
          <div class="price-info-item">
            <span class="price-info-label">24h Vol({{ baseCurrency }})</span>
            <span class="price-info-value">{{ formatFullNumber(currentTicker.volume) }} {{ baseCurrency }}</span>
          </div>
          <div class="price-info-item">
            <span class="price-info-label">{{ $t('perpetuals.24hVolQuote') }}</span>
            <span class="price-info-value">${{ formatFullNumber(currentTicker.quoteVolume) }}</span>
          </div>
          <div class="price-info-item">
            <v-tooltip bottom content-class="custom-tooltip" max-width="260">
              <template #activator="{ on, attrs }">
                <span class="price-info-label price-info-label--dashed" v-bind="attrs" v-on="on">{{ $t('perpetuals.openInterest') }}</span>
              </template>
              <span>{{ $t('perpetuals.openInterestTooltip') }}</span>
            </v-tooltip>
            <span class="price-info-value">${{ formatFullNumber(openInterest) }}</span>
          </div>
        </template>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════════
           MAIN 3-COLUMN LAYOUT
           ═══════════════════════════════════════════════════════════════════ -->
      <div class="terminal-body">

            <div class="col-left">
          <!-- Chart area -->
          <div class="chart-area">
            <div class="chart-subtabs">
              <span
                v-for="tab in chartSubTabs"
                :key="tab.id"
                class="chart-subtab"
                :class="{ 'chart-subtab--active': activeChartSubTab === tab.id }"
                @click="activeChartSubTab = tab.id"
              >
                {{ $t(tab.label) }}
              </span>
            </div>
            <!-- Chart toolbar (timeframes + price type) -->
            <div class="chart-toolbar">
              <span
                v-for="tf in ['5m', '1h', '1d']"
                :key="tf"
                class="chart-toolbar__tf"
                :class="{ 'chart-toolbar__tf--active': chartTimeframe === tf }"
                @click="chartTimeframe = tf"
              >
                {{ tf }}
              </span>
              <v-menu offset-y :attach="true" content-class="chart-price-menu">
                <template #activator="{ on, attrs }">
                  <span class="chart-toolbar__price-trigger" v-bind="attrs" v-on="on">
                    {{ priceTypeOptions.find(o => o.value === chartPriceType)?.label }}
                    <v-icon size="14" class="ml-1">mdi-chevron-down</v-icon>
                  </span>
                </template>
                <v-list dense dark class="chart-price-list">
                  <v-list-item
                    v-for="opt in priceTypeOptions"
                    :key="opt.value"
                    @click="chartPriceType = opt.value"
                    :class="{ 'chart-price-list__item--active': chartPriceType === opt.value }"
                  >
                    <v-list-item-title>{{ opt.label }}</v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
            </div>
            <TradingViewChart
              :symbol="'ADA/USD'"
              :data="chartData"
              :enable-realtime="true"
              :realtime-data="strikeRealtimeData"
              :candle-interval="candleIntervalSeconds"
              width="100%"
              height="100%"
              theme="dark"
              :price-precision="symbolPrecision"
              :price-min-move="symbolMinMove"
              @chartReady="onChartReady"
            />
          </div>
        </div>

        <!-- CENTER COLUMN — Order Book (component) -->
        <PerpsOrderBook
          :selected-symbol="selectedSymbol"
          :base-asset="baseAsset"
          :live-mark-price="liveMarkPrice"
          :current-ticker="currentTicker"
          :last-trade-class="lastTradeClass"
        />
        <!-- RIGHT COLUMN — Order Form (component) -->
        <!-- Gate the trade form behind a Strike connection; chart + order book
             (public) remain visible. The deposit/withdraw sheets inside
             PerpsAccountSection are gated independently (they reuse the same
             connect-aware DepositSheet/WithdrawSheet). -->
        <div v-if="!isConnected" class="col-right connect-col">
          <StrikeOnboarding @connected="onConnected" />
        </div>
        <PerpsOrderForm
          v-else
          :symbol="selectedSymbol"
          :base-asset="baseAsset"
          :account="account"
          :positions="openPositions"
          :market-config="currentMarketConfig"
          :live-price="strikeRealtimeData?.lastPrice ?? 0"
          :wallet-ada-balance="walletAdaBalance"
          :ob-asks="obAsks"
          :ob-bids="obBids"
          @order-placed="refreshPositionsAndOrders"
          @leverage-changed="loadAccount()"
          @margin-mode-changed="loadAccount()"
        />
        <!-- Positions area (component) -->
        <PerpsPositionsPanel
          ref="positionsPanelRef"
          :symbol="selectedSymbol"
          :positions="openPositions"
          :open-orders="openOrders"
          :account="account"
          :live-price="strikeRealtimeData?.lastPrice ?? 0"
          @refresh="refreshPositionsAndOrders"
        />

        <!-- Account section (component) -->
        <PerpsAccountSection
          :account="account"
          :wallet-ada-balance="walletAdaBalance"
          :live-price="strikeRealtimeData?.lastPrice ?? 0"
          :margin-ratio-display="marginRatioDisplay"
        />

      </div>
      <!-- end terminal-body -->

      <!-- Footer -->
      <div class="terminal-footer">
        <span class="powered-by">{{ $t('common.poweredBy') }}</span>
        <img
          src="https://app.strikefinance.org/logo.svg"
          alt="Strike Finance"
          class="strike-logo"
          @error="onLogoError"
        />
        <span class="footer-spacer" />
        <a href="https://docs.strikefinance.org/" target="_blank" rel="noopener" class="footer-link">Docs</a>
        <a href="mailto:shan@strikefinance.org" class="footer-link">Support</a>
      </div>

    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useStrikeMarket } from '@/modules/market/composables/useStrikeMarket';
import { useStrikeTrading } from '@/modules/market/composables/useStrikeTrading';
import { useStrikeOnboarding } from '@/modules/market/composables/useStrikeOnboarding';
import { usePerpsFormatters, usePerpsChart, useOrderBook } from '@/modules/market/composables/perps';
import { walletStore } from '@/stores/walletStore';
import { strikeMarketApi } from '@/api/strike-v2.market';
import type {
  Position,
  StrikeMarketConfig,
} from '@/api/strike-v2.types';
import TradingViewChart from '@/shared/components/TradingViewChart.vue';
import PerpsOrderBook from '@/modules/dashboard/components/perps/PerpsOrderBook.vue';
import PerpsAccountSection from '@/modules/dashboard/components/perps/PerpsAccountSection.vue';
import PerpsPositionsPanel from '@/modules/dashboard/components/perps/PerpsPositionsPanel.vue';
import PerpsOrderForm from '@/modules/dashboard/components/perps/PerpsOrderForm.vue';
import StrikeOnboarding from '@/sidepanel/components/perps/StrikeOnboarding.vue';

const {
  formatPrice, formatFullNumber, formatChange, formatFundingRate,
} = usePerpsFormatters();

// ---------------------------------------------------------------------------
// Props / emits
// ---------------------------------------------------------------------------

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
}>();

const dialogVisible = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v),
});

function close() {
  dialogVisible.value = false;
}

// ---------------------------------------------------------------------------
// Market data (singleton)
// ---------------------------------------------------------------------------

const { symbolNames, tickers, fundingRates } = useStrikeMarket();

// Market configuration from /v2/markets (fetched once on dialog open)
const marketsConfig = ref<Record<string, StrikeMarketConfig>>({});
const currentMarketConfig = computed<StrikeMarketConfig | undefined>(() => marketsConfig.value[selectedSymbol.value]);

async function loadMarketConfig() {
  try {
    const res = await strikeMarketApi.getMarkets();
    marketsConfig.value = res.markets;
  } catch (e) {
    console.warn('[Perps] Failed to load market config:', e);
  }
}

// For Cardano wallets, default to ADA-USD. BTC-USD is for future Bitcoin wallet support.
const selectedSymbol = ref<string>('ADA-USD');
const baseCurrency = computed(() => selectedSymbol.value.split('-')[0]);

// ── Order book + WS subscriptions (composable) ───────────────────────────
const {
  strikeRealtimeData, liveMarkPrice, liveIndexPrice, liveFundingRate, liveNextFundingTime,
  markPriceFlash, lastTradeClass,
  // Raw bid/ask ladders forwarded to PerpsOrderForm for VWAP entry estimation.
  obAsks, obBids,
} = useOrderBook(selectedSymbol);

// ── Chart + open interest (composable) ────────────────────────────────────
const {
  chartData, chartTimeframe, chartPriceType, priceTypeOptions,
  candleIntervalSeconds, symbolPrecision, symbolMinMove,
  openInterest, onChartReady, loadChartData, loadOpenInterest,
} = usePerpsChart(selectedSymbol, currentMarketConfig, {
  strikeRealtimeData, liveMarkPrice, liveIndexPrice, liveFundingRate, liveNextFundingTime, markPriceFlash,
});

watch(symbolNames, (names) => {
  if (names.length > 0 && !names.includes(selectedSymbol.value)) {
    selectedSymbol.value = names[0];
  }
}, { immediate: true });

const currentTicker = computed(() => tickers.value[selectedSymbol.value]);
const currentFunding = computed(() => fundingRates.value[selectedSymbol.value]);

const baseAsset = computed(() => {
  const sym = selectedSymbol.value;
  const idx = sym.indexOf('-');
  return idx > 0 ? sym.substring(0, idx) : sym;
});

const tickerChangeClass = computed(() => {
  const pct = parseFloat(currentTicker.value?.priceChangePercent ?? '0');
  return pct >= 0 ? 'clr-green' : 'clr-red';
});

const fundingClass = computed(() => {
  const rate = parseFloat(liveFundingRate.value ?? currentFunding.value?.lastFundingRate ?? '0');
  return rate >= 0 ? 'clr-green' : 'clr-red';
});

function getTickerChangeClass(name: string): string {
  const pct = parseFloat(tickers.value[name]?.priceChangePercent ?? '0');
  return pct >= 0 ? 'clr-green' : 'clr-red';
}

// Funding countdown
const fundingCountdown = ref('--:--:--');
let countdownInterval: ReturnType<typeof setInterval> | null = null;

function updateFundingCountdown() {
  const nextTime = liveNextFundingTime.value ?? currentFunding.value?.nextFundingTime;
  if (!nextTime) { fundingCountdown.value = '--:--:--'; return; }
  const diff = nextTime - Date.now();
  if (diff <= 0) { fundingCountdown.value = '00:00:00'; return; }
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  fundingCountdown.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

countdownInterval = setInterval(updateFundingCountdown, 1000);
onBeforeUnmount(() => { if (countdownInterval) clearInterval(countdownInterval); });

// Favorites (use plain object — Vue 2 doesn't support reactive Set)
const favorites = ref<Record<string, boolean>>({});

function toggleFavorite(name: string) {
  if (favorites.value[name]) {
    delete favorites.value[name];
    favorites.value = { ...favorites.value }; // trigger reactivity
  } else {
    favorites.value = { ...favorites.value, [name]: true };
  }
}

function isFavorite(name: string): boolean {
  return !!favorites.value[name];
}

// ---------------------------------------------------------------------------
// Trading state (shared singleton)
// ---------------------------------------------------------------------------

const {
  account,
  openOrders,
  positions,
  loadAccount,
  loadOpenOrders,
  loadPositions,
} = useStrikeTrading();

const { isConnected } = useStrikeOnboarding();

const openPositions = computed<Position[]>(() =>
  (positions.value ?? []).filter((p) => parseFloat(p.Size) !== 0),
);

// ---------------------------------------------------------------------------
// Chart sub-tabs
// ---------------------------------------------------------------------------

const chartSubTabs = [
  { id: 'chart', label: 'perpetuals.chart' },
  { id: 'data', label: 'perpetuals.data' },
  { id: 'depth', label: 'perpetuals.depth' },
  { id: 'liquidations', label: 'perpetuals.liquidations' },
  { id: 'details', label: 'perpetuals.details' },
];
const activeChartSubTab = ref('chart');

// Available ADA balance from wallet (controlled_amount is in lovelace)
const walletAdaBalance = computed(() => {
  const lovelace = parseFloat(walletStore.account?.controlled_amount ?? '0');
  return lovelace / 1_000_000;
});

const marginRatioDisplay = computed(() => {
  const margin = parseFloat(account.value?.total_margin ?? '0');
  const balance = parseFloat(account.value?.margin_balance ?? '0');
  if (!margin || !balance) return '0.00';
  return ((margin / balance) * 100).toFixed(2);
});


// Load data when dialog opens. Public market data loads unconditionally;
// account data only if Strike API keys are unlocked — otherwise the request
// goes out unauthenticated, returns 401, and the auth-failure handler nukes
// any stored keys (correct response to a real auth failure but noise when
// the user simply hasn't connected yet).
watch(dialogVisible, (visible) => {
  if (visible) {
    loadChartData();
    loadOpenInterest();
    loadMarketConfig();
    if (isConnected.value) loadAccount();
  }
});

// Also load account once a connect/unlock completes while the dialog is open.
watch(isConnected, (connected) => {
  if (connected && dialogVisible.value) {
    loadAccount();
    loadPositions(selectedSymbol.value);
    loadOpenOrders(selectedSymbol.value);
  }
});

const positionsPanelRef = ref<InstanceType<typeof PerpsPositionsPanel> | null>(null);

async function refreshPositionsAndOrders() {
  if (!isConnected.value) return;
  await Promise.all([loadAccount(), loadPositions(selectedSymbol.value), loadOpenOrders(selectedSymbol.value)]);
  positionsPanelRef.value?.resetTabs?.();
}

// Fired by the inline StrikeOnboarding card once connect/unlock succeeds. The
// isConnected watcher already loads account/positions/orders while the dialog
// is open; this is a no-op placeholder kept for an explicit template binding.
function onConnected() {
  if (isConnected.value && dialogVisible.value) {
    loadAccount();
    loadPositions(selectedSymbol.value);
    loadOpenOrders(selectedSymbol.value);
  }
}

function onLogoError(e: Event) {
  (e.target as HTMLImageElement).style.display = 'none';
}
</script>

<style scoped>
/* ═══════════════════════════════════════════════════════════════════════════
   TERMINAL LAYOUT
   ═══════════════════════════════════════════════════════════════════════════ */

.perps-terminal {
  background: #0b0e11 !important;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/* ── Symbol tabs bar ──────────────────────────────────────────────────── */

.symbol-tabs-bar {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 8px;
  border-bottom: 1px solid #2b2f36;
  flex-shrink: 0;
  background: #0b0e11;
}

.symbol-tabs-scroll {
  display: flex;
  overflow-x: auto;
  gap: 2px;
  flex: 1;
  scrollbar-width: none;
}
.symbol-tabs-scroll::-webkit-scrollbar { display: none; }

.symbol-tab {
  display: flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  font-size: 12px;
  color: #848e9c;
  transition: background 0.15s;
}
.symbol-tab:hover { background: rgba(255,255,255,0.04); }
.symbol-tab--active {
  background: rgba(255,255,255,0.06);
  color: #ffffff;
}

.symbol-tab__name { font-weight: 600; }
.symbol-tab__change { font-size: 11px; font-weight: 600; }

.star-icon { cursor: pointer; }

/* ── Price info bar ───────────────────────────────────────────────────── */

.price-info-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 4px 12px;
  border-bottom: 1px solid #2b2f36;
  flex-shrink: 0;
  background: #0b0e11;
  overflow-x: auto;
}

.symbol-pair {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 4px 0;
}

.symbol-pair__icon {
  width: 24px;
  height: 24px;
  border-radius: 50%;
}

.symbol-pair__name {
  font-size: 16px;
  font-weight: 700;
  color: #eaecef;
  letter-spacing: 0.3px;
}

.price-info-item {
  display: flex;
  flex-direction: column;
  white-space: nowrap;
}

.price-info-label {
  font-size: 10px;
  color: #848e9c;
  line-height: 1.2;
}

.price-info-label--dashed {
  text-decoration: underline dotted #848e9c;
  text-underline-offset: 2px;
  cursor: pointer;
}

.price-info-value {
  font-size: 12px;
  font-weight: 600;
  color: #eaecef;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  line-height: 1.3;
  transition: color 0.15s ease;
}

.price-flash-up {
  color: #0ecb81 !important;
}

.price-flash-down {
  color: #f6465d !important;
}

.funding-value-row {
  display: flex;
  align-items: baseline;
  gap: 2px;
}

.price-info-countdown {
  font-size: 11px;
  color: #eaecef;
  font-weight: 600;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  line-height: 1.3;
}

/* ── Main 3-column body ──────────────────────────────────────────────── */

.terminal-body {
  display: grid;
  grid-template-rows: 1fr auto;
  flex: 1;
  overflow: hidden;
}

/* Left column: chart */
.col-left {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #2b2f36;
  min-width: 0;
  overflow: hidden;
}

/* Connect gate slot — occupies the order-form column when disconnected */
.connect-col {
  grid-column: 3;
  grid-row: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: 280px;
  overflow-y: auto;
}

/* ── Chart area ───────────────────────────────────────────────────────── */

.chart-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 300px;
}

.chart-subtabs {
  display: flex;
  gap: 2px;
  padding: 4px 8px;
  border-bottom: 1px solid #1b1d23;
}

.chart-subtab {
  font-size: 11px;
  color: #848e9c;
  padding: 3px 10px;
  cursor: pointer;
  border-radius: 3px;
}
.chart-subtab:hover { background: rgba(255,255,255,0.04); }
.chart-subtab--active {
  color: #26FAB0;
  background: rgba(38, 250, 176, 0.08);
}

/* ── Chart toolbar ────────────────────────────────────────────────────── */

.chart-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: transparent;
  flex-shrink: 0;
}

.chart-toolbar__tf {
  font-size: 12px;
  font-weight: 600;
  color: #848e9c;
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: color 0.15s;
}

.chart-toolbar__tf:hover {
  color: #eaecef;
}

.chart-toolbar__tf--active {
  color: #eaecef;
  background: rgba(255, 255, 255, 0.08);
}

.chart-toolbar__price-trigger {
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 500;
  color: #eaecef;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
  margin-left: 8px;
}

.chart-toolbar__price-trigger:hover {
  background: rgba(255, 255, 255, 0.06);
}

.chart-toolbar__price-trigger .v-icon {
  color: #848e9c !important;
}

.chart-price-menu {
  min-width: 160px !important;
}

.chart-price-list {
  background: #1b1d23 !important;
  padding: 4px 0 !important;
}

.chart-price-list .v-list-item {
  min-height: 32px !important;
}

.chart-price-list .v-list-item__title {
  font-size: 12px !important;
  font-weight: 500;
  color: #eaecef;
}

.chart-price-list__item--active .v-list-item__title {
  color: #26FAB0;
  font-weight: 600;
}

.chart-area >>> .trading-view-chart-container {
  flex: 1;
  min-height: 300px;
  background: transparent;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHARED STYLES
   ═══════════════════════════════════════════════════════════════════════════ */

/* Color utilities */
.clr-green { color: #26FAB0 !important; }
.clr-red { color: #F6465D !important; }

/* Footer */
.terminal-footer {
  display: flex;
  align-items: center;
  padding: 3px 12px;
  border-top: 1px solid #2b2f36;
  background: #0b0e11;
  flex-shrink: 0;
}

.powered-by {
  font-size: 10px;
  color: #5e6673;
  margin-right: 6px;
}

.strike-logo {
  height: 14px;
  opacity: 0.6;
}

.footer-spacer {
  flex: 1;
}

.footer-link {
  font-size: 11px;
  color: #848e9c;
  text-decoration: none;
  margin-left: 16px;
  cursor: pointer;
}

.footer-link:hover {
  color: #eaecef;
}
</style>
