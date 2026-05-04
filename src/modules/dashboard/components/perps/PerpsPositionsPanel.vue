<template>
  <div class="positions-area">
    <v-tabs
      v-model="activeTab"
      background-color="transparent"
      color="#26FAB0"
      slider-color="#26FAB0"
      height="32"
      @change="onTabChange"
    >
      <v-tab class="tab-item">
        <span class="tab-text">{{ $t('perpetuals.positions') }}</span>
        <span v-if="positions.length > 0" class="tab-count ml-1">{{ positions.length }}</span>
      </v-tab>
      <v-tab class="tab-item">
        <span class="tab-text">{{ $t('perpetuals.openOrders') }}</span>
        <span v-if="openOrders.length > 0" class="tab-count ml-1">{{ openOrders.length }}</span>
      </v-tab>
      <v-tab class="tab-item">
        <span class="tab-text">{{ $t('perpetuals.orderHistory') }}</span>
      </v-tab>
      <v-tab class="tab-item">
        <span class="tab-text">{{ $t('perpetuals.fillHistory') }}</span>
      </v-tab>
      <v-tab class="tab-item">
        <span class="tab-text">{{ $t('perpetuals.funding') }}</span>
      </v-tab>
    </v-tabs>

    <v-tabs-items v-model="activeTab" class="transparent positions-tabs-items">
      <!-- Positions -->
      <v-tab-item>
        <div v-if="tabLoading[0]" class="tab-loading">
          <v-progress-circular indeterminate color="#26FAB0" size="24" />
        </div>
        <div v-else-if="positions.length === 0" class="empty-state">
          <v-icon size="32" color="#2b2f36">mdi-chart-line</v-icon>
          <p class="mt-1">{{ $t('perpetuals.noOpenPositions') }}</p>
        </div>
        <v-data-table
          v-else
          dense
          :headers="positionHeaders"
          :items="positions"
          class="transparent perps-table"
          hide-default-footer
          :items-per-page="-1"
        >
          <template v-slot:[`item.Side`]="{ item }">
            <span :class="item.Side === 'long' ? 'clr-green' : 'clr-red'" class="fw-600 text-uppercase font-mono">
              {{ item.Side }}
            </span>
          </template>
          <template v-slot:[`item.EntryPrice`]="{ item }">
            <span class="font-mono">{{ formatPrice(item.EntryPrice) }}</span>
          </template>
          <template v-slot:[`item.mark_price`]="{ item }">
            <span class="font-mono">{{ formatPrice(item.mark_price) }}</span>
          </template>
          <template v-slot:[`item.liquidation_price`]="{ item }">
            <span class="font-mono clr-yellow">{{ formatPrice(item.liquidation_price) }}</span>
          </template>
          <template v-slot:[`item.upnl`]="{ item }">
            <span :class="parseFloat(item.upnl) >= 0 ? 'clr-green' : 'clr-red'" class="font-mono fw-600">
              {{ parseFloat(item.upnl) >= 0 ? '+' : '' }}{{ parseFloat(item.upnl).toFixed(2) }}
              <span class="roe-pct">
                ({{ calcROE(item) }})
              </span>
            </span>
          </template>
          <template v-slot:[`item.actions`]="{ item }">
            <v-btn
              x-small text color="#F6465D"
              :loading="closingPosition === item.PositionID"
              @click="closePosition(item)"
              class="action-btn"
            >
              {{ $t('perpetuals.close') }}
            </v-btn>
          </template>
        </v-data-table>
      </v-tab-item>

      <!-- Open Orders -->
      <v-tab-item>
        <div class="d-flex justify-end pa-1" v-if="openOrders.length > 0">
          <v-btn x-small text color="#F6465D" :loading="cancellingAll" @click="cancelAllOrdersAction()">
            {{ $t('perpetuals.cancelAll') }}
          </v-btn>
        </div>
        <div v-if="tabLoading[1]" class="tab-loading">
          <v-progress-circular indeterminate color="#26FAB0" size="24" />
        </div>
        <div v-else-if="openOrders.length === 0" class="empty-state">
          <v-icon size="32" color="#2b2f36">mdi-format-list-bulleted</v-icon>
          <p class="mt-1">{{ $t('perpetuals.noOpenOrders') }}</p>
        </div>
        <v-data-table
          v-else
          dense
          :headers="openOrderHeaders"
          :items="openOrders"
          class="transparent perps-table"
          hide-default-footer
          :items-per-page="-1"
        >
          <template v-slot:[`item.Side`]="{ item }">
            <span :class="item.Side === 'buy' ? 'clr-green' : 'clr-red'" class="fw-600 text-uppercase font-mono">
              {{ item.Side }}
            </span>
          </template>
          <template v-slot:[`item.actions`]="{ item }">
            <v-btn x-small text color="#F6465D" :loading="cancellingOrder === item.ID" @click="cancelOrderAction(item)" class="action-btn">
              {{ $t('perpetuals.cancel') }}
            </v-btn>
          </template>
        </v-data-table>
      </v-tab-item>

      <!-- Order History -->
      <v-tab-item>
        <div v-if="tabLoading[2]" class="tab-loading">
          <v-progress-circular indeterminate color="#26FAB0" size="24" />
        </div>
        <div v-else-if="orderHistory.length === 0" class="empty-state">
          <v-icon size="32" color="#2b2f36">mdi-history</v-icon>
          <p class="mt-1">{{ $t('perpetuals.noOrderHistory') }}</p>
        </div>
        <v-data-table
          v-else dense
          :headers="orderHistoryHeaders"
          :items="orderHistory"
          class="transparent perps-table"
          :items-per-page="20"
          :footer-props="{ itemsPerPageOptions: [10, 20, 50] }"
        >
          <template v-slot:[`item.side`]="{ item }">
            <span :class="item.side === 'buy' ? 'clr-green' : 'clr-red'" class="fw-600 text-uppercase font-mono">{{ item.side }}</span>
          </template>
          <template v-slot:[`item.created_at`]="{ item }">{{ formatTime(item.created_at) }}</template>
        </v-data-table>
      </v-tab-item>

      <!-- Fill History -->
      <v-tab-item>
        <div v-if="tabLoading[3]" class="tab-loading">
          <v-progress-circular indeterminate color="#26FAB0" size="24" />
        </div>
        <div v-else-if="fillHistory.length === 0" class="empty-state">
          <v-icon size="32" color="#2b2f36">mdi-swap-horizontal</v-icon>
          <p class="mt-1">{{ $t('perpetuals.noFillHistory') }}</p>
        </div>
        <v-data-table
          v-else dense
          :headers="fillHistoryHeaders"
          :items="fillHistory"
          class="transparent perps-table"
          :items-per-page="20"
          :footer-props="{ itemsPerPageOptions: [10, 20, 50] }"
        >
          <template v-slot:[`item.side`]="{ item }">
            <span :class="item.side === 'buy' ? 'clr-green' : 'clr-red'" class="fw-600 text-uppercase font-mono">{{ item.side }}</span>
          </template>
          <template v-slot:[`item.realized_pnl`]="{ item }">
            <span :class="parseFloat(item.realized_pnl) >= 0 ? 'clr-green' : 'clr-red'" class="font-mono">
              {{ parseFloat(item.realized_pnl) >= 0 ? '+' : '' }}{{ parseFloat(item.realized_pnl).toFixed(4) }}
            </span>
          </template>
          <template v-slot:[`item.time`]="{ item }">{{ formatTime(item.time) }}</template>
        </v-data-table>
      </v-tab-item>

      <!-- Funding History -->
      <v-tab-item>
        <div v-if="tabLoading[4]" class="tab-loading">
          <v-progress-circular indeterminate color="#26FAB0" size="24" />
        </div>
        <div v-else-if="fundingHistory.length === 0" class="empty-state">
          <v-icon size="32" color="#2b2f36">mdi-percent</v-icon>
          <p class="mt-1">{{ $t('perpetuals.noFundingHistory') }}</p>
        </div>
        <v-data-table
          v-else dense
          :headers="fundingHistoryHeaders"
          :items="fundingHistory"
          class="transparent perps-table"
          :items-per-page="20"
          :footer-props="{ itemsPerPageOptions: [10, 20, 50] }"
        >
          <template v-slot:[`item.income`]="{ item }">
            <span :class="parseFloat(item.income) >= 0 ? 'clr-green' : 'clr-red'" class="font-mono">
              {{ parseFloat(item.income) >= 0 ? '+' : '' }}{{ parseFloat(item.income).toFixed(6) }} {{ item.asset }}
            </span>
          </template>
          <template v-slot:[`item.time`]="{ item }">{{ formatTime(item.time) }}</template>
        </v-data-table>
      </v-tab-item>
    </v-tabs-items>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { usePerpsFormatters } from '@/modules/market/composables/perps';
import { strikeUserApi } from '@/api/strike-v2.user';
import { strikeTradeApi } from '@/api/strike-v2.trade';
import type {
  AccountResponse,
  FillHistoryResult,
  FundingHistoryResult,
  Order,
  OrderHistoryResult,
  Position,
} from '@/api/strike-v2.types';
import snackbar from '@/plugins/snackbar';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t: $t } = useTranslation();
const { formatPrice, formatTime } = usePerpsFormatters();

// ---------------------------------------------------------------------------
// Props / Emits
// ---------------------------------------------------------------------------

const props = defineProps<{
  symbol: string;
  positions: Position[];
  openOrders: Order[];
  account: AccountResponse;
  livePrice: number;
}>();

const emit = defineEmits<{
  (e: 'close-position', position: Position): void;
  (e: 'cancel-order', order: Order): void;
  (e: 'cancel-all-orders'): void;
  (e: 'tab-change', tab: number): void;
  (e: 'refresh'): void;
}>();

// ---------------------------------------------------------------------------
// Tabs & History (lazy-loaded)
// ---------------------------------------------------------------------------

const activeTab = ref(0);
const tabLoading = ref<Record<number, boolean>>({ 0: false, 1: false, 2: false, 3: false, 4: false });
const tabLoaded = ref<Record<number, boolean>>({ 0: false, 1: false, 2: false, 3: false, 4: false });

const orderHistory = ref<OrderHistoryResult[]>([]);
const fillHistory = ref<FillHistoryResult[]>([]);
const fundingHistory = ref<FundingHistoryResult[]>([]);

async function onTabChange(tab: number) {
  emit('tab-change', tab);
  if (tabLoaded.value[tab]) return;
  tabLoading.value[tab] = true;
  try {
    if (tab === 2) {
      const res = await strikeUserApi.getOrderHistory({ symbol: props.symbol, limit: 50 });
      orderHistory.value = res.orders;
    } else if (tab === 3) {
      const res = await strikeUserApi.getFillHistory({ symbol: props.symbol, limit: 50 });
      fillHistory.value = res.fills;
    } else if (tab === 4) {
      const res = await strikeUserApi.getFundingHistory({ symbol: props.symbol, limit: 50 });
      fundingHistory.value = res.funding;
    }
    tabLoaded.value[tab] = true;
  } catch (e) {
    snackbar.setError(e instanceof Error ? e.message : String(e));
  } finally {
    tabLoading.value[tab] = false;
  }
}

/** Reset cached tab data (call when symbol changes or after mutations). */
function resetTabs() {
  tabLoaded.value = { 0: false, 1: false, 2: false, 3: false, 4: false };
  onTabChange(activeTab.value);
}

defineExpose({ resetTabs });

// ---------------------------------------------------------------------------
// Close position
// ---------------------------------------------------------------------------

const closingPosition = ref<string | null>(null);

async function closePosition(position: Position) {
  closingPosition.value = position.PositionID;
  try {
    await strikeTradeApi.createOrder({
      symbol: position.symbol,
      side: position.Side === 'long' ? 'sell' : 'buy',
      type: 'market',
      size: position.Size,
      reduce_only: true,
      close_position: true,
    });
    snackbar.fireSuccess('Position closed');
    emit('close-position', position);
    emit('refresh');
  } catch (e) {
    snackbar.setError(e instanceof Error ? e.message : String(e));
  } finally {
    closingPosition.value = null;
  }
}

// ---------------------------------------------------------------------------
// Cancel order(s)
// ---------------------------------------------------------------------------

const cancellingOrder = ref<string | null>(null);
const cancellingAll = ref(false);

async function cancelOrderAction(order: Order) {
  cancellingOrder.value = order.ID;
  try {
    await strikeTradeApi.cancelOrder({ order_id: order.ID, symbol: order.Symbol });
    snackbar.fireSuccess('Order cancelled');
    emit('cancel-order', order);
    emit('refresh');
  } catch (e) {
    snackbar.setError(e instanceof Error ? e.message : String(e));
  } finally {
    cancellingOrder.value = null;
  }
}

async function cancelAllOrdersAction() {
  cancellingAll.value = true;
  try {
    await strikeTradeApi.cancelAllOrders({ symbol: props.symbol });
    snackbar.fireSuccess('All orders cancelled');
    emit('cancel-all-orders');
    emit('refresh');
  } catch (e) {
    snackbar.setError(e instanceof Error ? e.message : String(e));
  } finally {
    cancellingAll.value = false;
  }
}

// ---------------------------------------------------------------------------
// ROE% = (uPnL / currentMargin) * 100 — per Integrator Guide Section 8.2
// ---------------------------------------------------------------------------

function calcROE(pos: Position): string {
  const upnl = parseFloat(pos.upnl);
  // Isolated: currentMargin = IsolatedMargin; Cross: notional / leverage
  const margin = pos.MarginMode === 'isolated'
    ? parseFloat(pos.IsolatedMargin)
    : (parseFloat(pos.Size) * (props.livePrice ?? 0)) / pos.Leverage;
  if (!margin || margin === 0) return '0.00%';
  const roe = (upnl / margin) * 100;
  return `${roe >= 0 ? '+' : ''}${roe.toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// Table headers
// ---------------------------------------------------------------------------

const positionHeaders = [
  { text: 'Symbol', value: 'symbol', sortable: true },
  { text: 'Side', value: 'Side', sortable: true },
  { text: 'Size', value: 'Size', sortable: true },
  { text: 'Entry Price', value: 'EntryPrice', sortable: true },
  { text: 'Mark Price', value: 'mark_price', sortable: false },
  { text: 'Liq. Price', value: 'liquidation_price', sortable: false },
  { text: 'Margin', value: 'IsolatedMargin', sortable: true },
  { text: 'PNL (ROE%)', value: 'upnl', sortable: true },
  { text: 'Funding', value: 'maintenance_margin', sortable: false },
  { text: 'TP/SL', value: 'tpsl', sortable: false },
  { text: '', value: 'actions', sortable: false, width: 70 },
];

const openOrderHeaders = [
  { text: 'Type', value: 'Type', sortable: true },
  { text: 'Side', value: 'Side', sortable: true },
  { text: 'Symbol', value: 'Symbol', sortable: true },
  { text: 'Price', value: 'Price', sortable: true },
  { text: 'Size', value: 'Size', sortable: true },
  { text: 'Filled', value: 'Filled', sortable: true },
  { text: 'Status', value: 'Status', sortable: true },
  { text: '', value: 'actions', sortable: false, width: 70 },
];

const orderHistoryHeaders = [
  { text: 'Type', value: 'type', sortable: true },
  { text: 'Side', value: 'side', sortable: true },
  { text: 'Symbol', value: 'symbol', sortable: true },
  { text: 'Price', value: 'price', sortable: true },
  { text: 'Size', value: 'size', sortable: true },
  { text: 'Filled', value: 'filled', sortable: true },
  { text: 'Status', value: 'status', sortable: true },
  { text: 'Time', value: 'created_at', sortable: true },
];

const fillHistoryHeaders = [
  { text: 'Symbol', value: 'symbol', sortable: true },
  { text: 'Side', value: 'side', sortable: true },
  { text: 'Price', value: 'price', sortable: true },
  { text: 'Qty', value: 'qty', sortable: true },
  { text: 'Fee', value: 'commission', sortable: true },
  { text: 'Realized PnL', value: 'realized_pnl', sortable: true },
  { text: 'Time', value: 'time', sortable: true },
];

const fundingHistoryHeaders = [
  { text: 'Symbol', value: 'symbol', sortable: true },
  { text: 'Income', value: 'income', sortable: true },
  { text: 'Time', value: 'time', sortable: true },
];
</script>

<style scoped>
/* ── Positions area ───────────────────────────────────────────────────── */

.positions-area {
  grid-column: 1 / 3;
  grid-row: 2;
  min-height: 180px;
  max-height: 300px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-top: 1px solid #2b2f36;
  border-right: 1px solid #2b2f36;
}

.positions-area >>> .v-tabs {
  flex: 0 0 auto;
}

.positions-tabs-items {
  overflow-y: auto;
  flex: 1;
}

/* Tabs */
.tab-item {
  min-width: auto !important;
  padding: 0 10px !important;
  font-size: 11px !important;
  font-weight: 500 !important;
  text-transform: none !important;
}

.tab-text { font-size: 11px; }

.tab-count {
  background: rgba(38, 250, 176, 0.15);
  color: #26FAB0;
  border-radius: 8px;
  padding: 0 4px;
  font-size: 9px;
  font-weight: 600;
}

/* Tables */
.perps-table { background: transparent !important; }

.perps-table >>> th {
  font-size: 10px !important;
  color: #5e6673 !important;
  white-space: nowrap;
  padding: 4px 8px !important;
  height: 28px !important;
}

.perps-table >>> td {
  font-size: 11px !important;
  white-space: nowrap;
  padding: 2px 8px !important;
  height: 28px !important;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: #eaecef;
}

/* Loading / empty states */
.tab-loading {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 24px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: #5e6673;
  font-size: 12px;
  flex: 1;
  min-height: 206px;
}

/* Action buttons */
.action-btn {
  font-size: 10px !important;
  text-transform: none !important;
  min-width: auto !important;
  height: 22px !important;
  padding: 0 6px !important;
}

/* Color utilities */
.clr-green { color: #26FAB0 !important; }
.clr-red { color: #F6465D !important; }
.clr-yellow { color: #F0B90B !important; }

.fw-600 { font-weight: 600; }

.font-mono { font-family: 'JetBrains Mono', 'Fira Code', monospace; }

.roe-pct {
  font-size: 10px;
  opacity: 0.8;
}

.form-value {
  font-size: 11px;
  font-weight: 600;
  color: #eaecef;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
</style>
