<template>
  <div class="perps-page">
    <!-- Sticky Header -->
    <div class="perps-header pa-3">
      <div class="d-flex align-center" style="gap: 8px;">
        <v-btn icon small @click="$router.push('/')">
          <v-icon color="var(--g-text-1)">mdi-arrow-left</v-icon>
        </v-btn>
        <SymbolSelector :value="selectedSymbol" @input="selectedSymbol = $event" />
        <span class="text-caption grey--text ml-auto">{{ $t('miniGero.perpsTitle') }}</span>
      </div>
    </div>

    <!-- Price Ticker -->
    <div class="px-3 mb-2">
      <PriceTicker :symbol="selectedSymbol" />
    </div>

    <!-- Not supported -->
    <div v-if="!perpetualsSupported" class="empty-state">
      <v-icon size="48" color="var(--g-text-3)">mdi-chart-line</v-icon>
      <div class="text-body-2 grey--text mt-3 text-center">
        {{ $t('miniGero.perpsNotSupported') }}
      </div>
    </div>

    <template v-else>
      <!-- Segment toggle -->
      <div class="segment-toggle mx-3 mb-3">
        <button
          v-for="seg in segments"
          :key="seg.id"
          class="segment-btn"
          :class="{ 'segment-btn--active': activeSegment === seg.id }"
          @click="activeSegment = seg.id"
        >
          {{ seg.label }}
          <span v-if="seg.count > 0" class="segment-count">{{ seg.count }}</span>
        </button>
      </div>

      <!-- Trade segment -->
      <div v-if="activeSegment === 'trade'" class="segment-content px-3">
        <!-- Authenticated action (place order) is gated behind connect; the
             public order book stays visible regardless. -->
        <StrikeOnboarding v-if="!isConnected" @connected="onConnected" />
        <OrderForm
          v-else
          :symbol="selectedSymbol"
          @order-placed="onOrderPlaced"
        />
        <div class="mt-3">
          <OrderBook
            :symbol="selectedSymbol"
            @price-click="onPriceClick"
          />
        </div>
      </div>

      <!-- Positions segment -->
      <div v-if="activeSegment === 'positions'" class="segment-content px-3">
        <StrikeOnboarding v-if="!isConnected" @connected="onConnected" />
        <template v-else>
        <div v-if="trading.loading.value && positions.length === 0" class="text-center py-6">
          <v-progress-circular indeterminate color="success" size="32" width="3" />
          <div class="grey--text text-caption mt-2">{{ $t('perpetuals.loadingPositions') }}</div>
        </div>
        <div v-else-if="positions.length === 0" class="empty-state-small">
          <v-icon size="36" color="var(--g-text-3)">mdi-chart-line</v-icon>
          <div class="text-body-2 grey--text mt-2">{{ $t('perpetuals.noOpenPositions') }}</div>
          <div class="text-caption grey--text mt-1">{{ $t('perpetuals.yourPerpetualPositions') }}</div>
        </div>
        <div v-else class="position-cards">
          <div v-for="pos in positions" :key="pos.PositionID" class="position-card">
            <div class="position-card-header">
              <div class="d-flex align-center" style="gap: 6px;">
                <span class="position-ticker">{{ pos.symbol }}</span>
                <span class="position-leverage">{{ pos.Leverage }}x</span>
                <span
                  class="position-type-badge"
                  :class="pos.Side === 'long' ? 'badge-long' : 'badge-short'"
                >{{ pos.Side.toUpperCase() }}</span>
              </div>
              <v-btn
                icon
                x-small
                color="error"
                :loading="closingPositions[pos.PositionID]"
                :disabled="closingPositions[pos.PositionID]"
                @click="handleClosePosition(pos)"
              >
                <v-icon small>mdi-close</v-icon>
              </v-btn>
            </div>
            <div class="position-card-body">
              <div class="position-stat">
                <span class="stat-label">{{ $t('perpetuals.entryPrice') }}</span>
                <span class="stat-value">${{ fmtPrice(pos.EntryPrice) }}</span>
              </div>
              <div class="position-stat">
                <span class="stat-label">{{ $t('perpetuals.size') }}</span>
                <span class="stat-value">{{ fmtSize(pos.Size) }}</span>
              </div>
              <div class="position-stat">
                <span class="stat-label">{{ $t('perpetuals.pnlLabel') }}</span>
                <span class="stat-value" :class="pnlClass(pos.upnl)">{{ fmtPnl(pos.upnl) }}</span>
              </div>
              <div class="position-stat">
                <span class="stat-label">{{ $t('perpetuals.markPrice') }}</span>
                <span class="stat-value">${{ fmtPrice(getTicker(pos.symbol)?.lastPrice) }}</span>
              </div>
              <div class="position-stat">
                <span class="stat-label">{{ $t('perpetuals.liquidationPrice') }}</span>
                <span class="stat-value">${{ fmtPrice(pos.liquidation_price) }}</span>
              </div>
            </div>
          </div>
        </div>
        </template>
      </div>

      <!-- Orders segment -->
      <div v-if="activeSegment === 'orders'" class="segment-content px-3">
        <StrikeOnboarding v-if="!isConnected" @connected="onConnected" />
        <template v-else>
        <div v-if="trading.loading.value && openOrders.length === 0" class="text-center py-6">
          <v-progress-circular indeterminate color="success" size="32" width="3" />
          <div class="grey--text text-caption mt-2">{{ $t('perpetuals.loadingLimitOrders') }}</div>
        </div>
        <div v-else-if="openOrders.length === 0" class="empty-state-small">
          <v-icon size="36" color="var(--g-text-3)">mdi-target</v-icon>
          <div class="text-body-2 grey--text mt-2">{{ $t('perpetuals.noLimitOrders') }}</div>
          <div class="text-caption grey--text mt-1">{{ $t('perpetuals.yourPendingLimitOrders') }}</div>
        </div>
        <template v-else>
          <div class="d-flex justify-end mb-2">
            <v-btn
              x-small
              text
              color="error"
              :loading="cancellingAll"
              @click="handleCancelAll"
            >
              {{ $t('perpetuals.cancelAll') }}
            </v-btn>
          </div>
          <div class="position-cards">
            <div v-for="order in openOrders" :key="order.ID" class="position-card">
              <div class="position-card-header">
                <div class="d-flex align-center" style="gap: 6px;">
                  <span class="position-ticker">{{ order.Symbol }}</span>
                  <span class="position-type-badge" :class="order.Side === 'buy' ? 'badge-long' : 'badge-short'">
                    {{ order.Side.toUpperCase() }}
                  </span>
                  <span class="order-type-label">{{ order.Type }}</span>
                </div>
                <v-btn
                  icon
                  x-small
                  color="error"
                  :loading="cancellingOrders[order.ID]"
                  :disabled="cancellingOrders[order.ID]"
                  @click="handleCancelOrder(order)"
                >
                  <v-icon small>mdi-close</v-icon>
                </v-btn>
              </div>
              <div class="position-card-body">
                <div class="position-stat">
                  <span class="stat-label">{{ $t('perpetuals.limitPrice') }}</span>
                  <span class="stat-value">${{ fmtPrice(order.Price) }}</span>
                </div>
                <div class="position-stat">
                  <span class="stat-label">{{ $t('perpetuals.size') }}</span>
                  <span class="stat-value">{{ fmtSize(order.Size) }}</span>
                </div>
                <div class="position-stat">
                  <span class="stat-label">{{ $t('perpetuals.filled') }}</span>
                  <span class="stat-value">{{ fmtSize(order.Filled) }}</span>
                </div>
                <div class="position-stat">
                  <span class="stat-label">{{ $t('perpetuals.status') }}</span>
                  <span class="stat-value text-capitalize">{{ order.Status }}</span>
                </div>
              </div>
            </div>
          </div>
        </template>
        </template>
      </div>

      <!-- History segment -->
      <div v-if="activeSegment === 'history'" class="segment-content px-3">
        <StrikeOnboarding v-if="!isConnected" @connected="onConnected" />
        <template v-else>
        <!-- History tabs -->
        <div class="segment-toggle mb-3" style="margin-left:0; margin-right:0;">
          <button
            class="segment-btn"
            :class="{ 'segment-btn--active': historyTab === 'closed' }"
            @click="switchHistoryTab('closed')"
          >{{ $t('perpetuals.closedPositions') }}</button>
          <button
            class="segment-btn"
            :class="{ 'segment-btn--active': historyTab === 'fills' }"
            @click="switchHistoryTab('fills')"
          >{{ $t('perpetuals.fillHistory') }}</button>
        </div>

        <div v-if="loadingHistory" class="text-center py-6">
          <v-progress-circular indeterminate color="success" size="32" width="3" />
          <div class="grey--text text-caption mt-2">{{ $t('perpetuals.loadingHistory') }}</div>
        </div>

        <!-- Closed Positions list -->
        <template v-if="historyTab === 'closed' && !loadingHistory">
          <div v-if="closedPositions.length === 0" class="empty-state-small">
            <v-icon size="36" color="var(--g-text-3)">mdi-format-list-bulleted</v-icon>
            <div class="text-body-2 grey--text mt-2">{{ $t('perpetuals.noHistory') }}</div>
          </div>
          <div v-else class="position-cards">
            <div v-for="cp in closedPositions" :key="cp.position_id" class="position-card">
              <div class="position-card-header">
                <div class="d-flex align-center" style="gap: 6px;">
                  <span class="position-ticker">{{ cp.symbol }}</span>
                  <span class="position-type-badge" :class="cp.side === 'long' ? 'badge-long' : 'badge-short'">
                    {{ cp.side.toUpperCase() }}
                  </span>
                </div>
                <span class="text-caption grey--text">{{ formatDate(cp.closed_at) }}</span>
              </div>
              <div class="position-card-body">
                <div class="position-stat">
                  <span class="stat-label">{{ $t('perpetuals.entryPrice') }}</span>
                  <span class="stat-value">${{ fmtPrice(cp.entry_price) }}</span>
                </div>
                <div class="position-stat">
                  <span class="stat-label">{{ $t('perpetuals.exitPrice') }}</span>
                  <span class="stat-value">${{ fmtPrice(cp.exit_price) }}</span>
                </div>
                <div class="position-stat">
                  <span class="stat-label">{{ $t('perpetuals.pnlLabel') }}</span>
                  <span class="stat-value" :class="pnlClass(cp.realized_pnl)">{{ fmtPnl(cp.realized_pnl) }}</span>
                </div>
                <div class="position-stat">
                  <span class="stat-label">{{ $t('perpetuals.leverage') }}</span>
                  <span class="stat-value">{{ cp.leverage }}x</span>
                </div>
              </div>
            </div>
          </div>
          <div v-if="hasMoreClosed" class="text-center mt-3">
            <v-btn x-small text color="success" :loading="loadingHistory" @click="loadMoreClosed">
              {{ $t('common.loadMore') }}
            </v-btn>
          </div>
        </template>

        <!-- Fill History list -->
        <template v-if="historyTab === 'fills' && !loadingHistory">
          <div v-if="fillHistory.length === 0" class="empty-state-small">
            <v-icon size="36" color="var(--g-text-3)">mdi-format-list-bulleted</v-icon>
            <div class="text-body-2 grey--text mt-2">{{ $t('perpetuals.noHistory') }}</div>
          </div>
          <div v-else class="position-cards">
            <div v-for="fill in fillHistory" :key="fill.id" class="position-card">
              <div class="position-card-header">
                <div class="d-flex align-center" style="gap: 6px;">
                  <span class="position-ticker">{{ fill.symbol }}</span>
                  <span class="position-type-badge" :class="fill.side === 'buy' ? 'badge-long' : 'badge-short'">
                    {{ fill.side.toUpperCase() }}
                  </span>
                </div>
                <span class="text-caption grey--text">{{ formatDate(fill.time) }}</span>
              </div>
              <div class="position-card-body">
                <div class="position-stat">
                  <span class="stat-label">{{ $t('perpetuals.fillPrice') }}</span>
                  <span class="stat-value">${{ fmtPrice(fill.price) }}</span>
                </div>
                <div class="position-stat">
                  <span class="stat-label">{{ $t('perpetuals.qty') }}</span>
                  <span class="stat-value">{{ fmtSize(fill.qty) }}</span>
                </div>
                <div class="position-stat">
                  <span class="stat-label">{{ $t('perpetuals.pnlLabel') }}</span>
                  <span class="stat-value" :class="pnlClass(fill.realized_pnl)">{{ fmtPnl(fill.realized_pnl) }}</span>
                </div>
                <div class="position-stat">
                  <span class="stat-label">{{ $t('perpetuals.fee') }}</span>
                  <span class="stat-value grey--text">{{ fmtSize(fill.commission) }} {{ fill.commission_asset }}</span>
                </div>
              </div>
            </div>
          </div>
          <div v-if="hasMoreFills" class="text-center mt-3">
            <v-btn x-small text color="success" :loading="loadingHistory" @click="loadMoreFills">
              {{ $t('common.loadMore') }}
            </v-btn>
          </div>
        </template>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { walletStore } from '@/stores/walletStore';
import networks from '@/utils/networks';
import { strikeUserApi } from '@/api/strike-v2.user';
import { useStrikeTrading } from '@/modules/market/composables/useStrikeTrading';
import { useStrikeMarket } from '@/modules/market/composables/useStrikeMarket';
import { useStrikeOnboarding } from '@/modules/market/composables/useStrikeOnboarding';
import type { Position, Order, ClosedPosition, FillHistoryResult } from '@/api/strike-v2.types';
import SymbolSelector from '../components/perps/SymbolSelector.vue';
import PriceTicker from '../components/perps/PriceTicker.vue';
import OrderForm from '../components/perps/OrderForm.vue';
import OrderBook from '../components/perps/OrderBook.vue';
import StrikeOnboarding from '../components/perps/StrikeOnboarding.vue';

// ── Store / composables ──

const trading = useStrikeTrading();
const { getTicker } = useStrikeMarket();
const { isConnected } = useStrikeOnboarding();

const perpetualsSupported = computed(() => {
  const w = walletStore.loggedWallet;
  if (!w) return false;
  return networks.resolvePerpetualsSupport(w.chain, w.network);
});

// ── Symbol ──

const selectedSymbol = ref('BTC-USD');

// ── Segments ──

type Segment = 'trade' | 'positions' | 'orders' | 'history';
const activeSegment = ref<Segment>('trade');

// The composable may return PositionsResponse { positions, count } or Position[] depending on API shape
const positions = computed<Position[]>(() => {
  const raw = trading.positions.value as Position[] | { positions?: Position[] } | null;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : (raw.positions ?? []);
});
const openOrders = computed<Order[]>(() => {
  const raw = trading.openOrders.value as Order[] | { orders?: Order[] } | null;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : (raw.orders ?? []);
});

const segments = computed(() => [
  { id: 'trade' as Segment, label: 'Trade', count: 0 },
  { id: 'positions' as Segment, label: 'Positions', count: positions.value.length },
  { id: 'orders' as Segment, label: 'Orders', count: openOrders.value.length },
  { id: 'history' as Segment, label: 'History', count: 0 },
]);

// ── Close / Cancel state ──

const closingPositions = ref<Record<string, boolean>>({});
const cancellingOrders = ref<Record<string, boolean>>({});
const cancellingAll = ref(false);

// ── History ──

type HistoryTab = 'closed' | 'fills';
const historyTab = ref<HistoryTab>('closed');
const closedPositions = ref<ClosedPosition[]>([]);
const fillHistory = ref<FillHistoryResult[]>([]);
const loadingHistory = ref(false);
const closedPage = ref(0);
const fillsPage = ref(0);
const PAGE_SIZE = 20;
const hasMoreClosed = ref(false);
const hasMoreFills = ref(false);

// ── Formatters ──

function fmtPrice(val: string | undefined): string {
  const n = parseFloat(val ?? '0');
  if (!n) return '--';
  return n >= 1 ? n.toFixed(2) : n.toFixed(4);
}

function fmtSize(val: string | undefined): string {
  const n = parseFloat(val ?? '0');
  if (!n) return '0';
  return n.toFixed(4);
}

function fmtPnl(val: string | undefined): string {
  const n = parseFloat(val ?? '0');
  const abs = Math.abs(n).toFixed(2);
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

function pnlClass(val: string | undefined): string {
  const n = parseFloat(val ?? '0');
  return n >= 0 ? 'green-text' : 'red-text';
}

function formatDate(ts: string | number | undefined): string {
  if (!ts) return '--';
  const d = new Date(typeof ts === 'number' ? ts : ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Event handlers ──

function onOrderPlaced() {
  trading.loadPositions(selectedSymbol.value);
  trading.loadOpenOrders(selectedSymbol.value);
}

function onPriceClick(_price: string) {
  // Future: pass price to OrderForm via shared ref or event bus
}

// Fired by the inline StrikeOnboarding card once connect/unlock succeeds. The
// isConnected watcher already loads account/positions/orders; here we also
// refresh the History tab if the user connected from that segment.
function onConnected() {
  if (activeSegment.value === 'history') {
    if (historyTab.value === 'closed') loadClosedPositions();
    else loadFillHistory();
  }
}

// ── Close position ──

async function handleClosePosition(pos: Position) {
  closingPositions.value = { ...closingPositions.value, [pos.PositionID]: true };
  try {
    await trading.placeOrder({
      symbol: pos.symbol,
      side: pos.Side === 'long' ? 'sell' : 'buy',
      type: 'market',
      size: pos.Size,
      close_position: true,
    });
    await trading.loadPositions(selectedSymbol.value);
  } catch (e) {
    console.warn('[Perps] Close position failed:', e);
  } finally {
    const updated = { ...closingPositions.value };
    delete updated[pos.PositionID];
    closingPositions.value = updated;
  }
}

// ── Cancel order ──

async function handleCancelOrder(order: Order) {
  cancellingOrders.value = { ...cancellingOrders.value, [order.ID]: true };
  try {
    await trading.cancelOrder(order.ID, order.Symbol);
  } catch (e) {
    console.warn('[Perps] Cancel order failed:', e);
  } finally {
    const updated = { ...cancellingOrders.value };
    delete updated[order.ID];
    cancellingOrders.value = updated;
  }
}

async function handleCancelAll() {
  cancellingAll.value = true;
  try {
    await trading.cancelAllOrders(selectedSymbol.value);
  } catch (e) {
    console.warn('[Perps] Cancel all failed:', e);
  } finally {
    cancellingAll.value = false;
  }
}

// ── History loading ──

async function loadClosedPositions(reset = true) {
  if (reset) {
    closedPage.value = 0;
    closedPositions.value = [];
  }
  loadingHistory.value = true;
  try {
    const offset = closedPage.value * PAGE_SIZE;
    const res = await strikeUserApi.getClosedPositions({
      symbol: selectedSymbol.value,
      limit: PAGE_SIZE + 1,
    });
    const items = (res.positions ?? []).slice(offset);
    hasMoreClosed.value = items.length > PAGE_SIZE;
    closedPositions.value = reset
      ? items.slice(0, PAGE_SIZE)
      : [...closedPositions.value, ...items.slice(0, PAGE_SIZE)];
  } catch (e) {
    console.warn('[Perps] Load closed positions failed:', e);
  } finally {
    loadingHistory.value = false;
  }
}

async function loadFillHistory(reset = true) {
  if (reset) {
    fillsPage.value = 0;
    fillHistory.value = [];
  }
  loadingHistory.value = true;
  try {
    const offset = fillsPage.value * PAGE_SIZE;
    const res = await strikeUserApi.getFillHistory({
      symbol: selectedSymbol.value,
      limit: PAGE_SIZE + 1,
    });
    const items = (res.fills ?? []).slice(offset);
    hasMoreFills.value = items.length > PAGE_SIZE;
    fillHistory.value = reset
      ? items.slice(0, PAGE_SIZE)
      : [...fillHistory.value, ...items.slice(0, PAGE_SIZE)];
  } catch (e) {
    console.warn('[Perps] Load fill history failed:', e);
  } finally {
    loadingHistory.value = false;
  }
}

function switchHistoryTab(tab: HistoryTab) {
  historyTab.value = tab;
  if (tab === 'closed') loadClosedPositions();
  else loadFillHistory();
}

async function loadMoreClosed() {
  closedPage.value++;
  await loadClosedPositions(false);
}

async function loadMoreFills() {
  fillsPage.value++;
  await loadFillHistory(false);
}

// ── Watchers ──

watch(selectedSymbol, () => {
  trading.loadPositions(selectedSymbol.value);
  trading.loadOpenOrders(selectedSymbol.value);
  if (activeSegment.value === 'history') {
    if (historyTab.value === 'closed') loadClosedPositions();
    else loadFillHistory();
  }
});

watch(activeSegment, (seg) => {
  if (seg === 'history') {
    if (historyTab.value === 'closed') loadClosedPositions();
    else loadFillHistory();
  }
});

// ── Lifecycle ──

// Authenticated calls only fire once Strike API keys are unlocked. Without
// this gate, an opened-but-not-connected page issues unauthenticated /v2/*
// requests that 401 and trip the auth-failure handler.
function loadAccountData() {
  trading.loadAccount();
  trading.loadPositions(selectedSymbol.value);
  trading.loadOpenOrders(selectedSymbol.value);
}

onMounted(() => {
  if (perpetualsSupported.value && isConnected.value) {
    loadAccountData();
  }
});

watch(isConnected, (connected) => {
  if (connected && perpetualsSupported.value) loadAccountData();
});
</script>

<style scoped>
.perps-page {
  min-height: 100%;
  padding-bottom: 80px;
  overflow-y: auto;
}

.perps-header {
  position: sticky;
  top: 0;
  z-index: var(--g-z-sticky);
  background: var(--g-surface);
  border-bottom: 1px solid var(--g-hairline-1);
  padding-bottom: 8px !important;
}

.green-text { color: var(--g-success) !important; }
.red-text   { color: var(--g-error) !important; }

/* Segment toggle */
.segment-toggle {
  display: flex;
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 3px;
  gap: 2px;
}

.segment-btn {
  flex: 1;
  padding: 6px 8px;
  border: none;
  border-radius: var(--g-r-control);
  background: transparent;
  color: var(--g-text-3);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.segment-btn--active {
  background: var(--g-success-fill);
  color: var(--g-success);
  font-weight: 600;
}

.segment-count {
  background: var(--g-hairline-2);
  border-radius: var(--g-r-control);
  padding: 0 5px;
  font-size: 11px;
  min-width: 16px;
  text-align: center;
}

.segment-btn--active .segment-count {
  background: var(--g-success-fill);
}

/* Empty states */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 24px;
}

.empty-state-small {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
}

/* Position / order cards */
.position-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.position-card {
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  padding: 12px;
}

.position-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.position-ticker {
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 600;
}

.position-leverage {
  color: var(--g-text-3);
  font-size: 11px;
  background: var(--g-hairline-1);
  padding: 1px 5px;
  border-radius: var(--g-r-chip);
}

.position-type-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: var(--g-r-chip);
  letter-spacing: 0.5px;
}

.badge-long {
  background: var(--g-success-fill);
  color: var(--g-success);
  border: 1px solid var(--g-success-line);
}

.badge-short {
  background: var(--g-error-fill);
  color: var(--g-error);
  border: 1px solid var(--g-error-line);
}

.order-type-label {
  color: var(--g-text-3);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.position-card-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.position-stat {
  display: flex;
  flex-direction: column;
}

.stat-label {
  font-size: 11px;
  color: var(--g-text-3);
}

.stat-value {
  font-size: 13px;
  color: var(--g-text-1);
  font-weight: 500;
}

.segment-content {
  padding-bottom: 16px;
}
</style>
