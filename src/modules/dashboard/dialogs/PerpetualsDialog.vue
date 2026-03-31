<template>
  <v-dialog v-model="dialogVisible" fullscreen transition="dialog-bottom-transition">
    <v-card dark class="perps-dialog">

      <!-- Toolbar -->
      <v-toolbar dark flat color="transparent" class="perps-toolbar">
        <v-btn icon @click="close">
          <v-icon>mdi-close</v-icon>
        </v-btn>

        <!-- Symbol selector -->
        <v-select
          v-model="selectedSymbol"
          :items="symbolNames"
          dense
          hide-details
          outlined
          class="symbol-select ml-2"
          style="max-width: 180px;"
          :attach="true"
          :loading="marketLoading"
        />

        <!-- Price ticker -->
        <div v-if="currentTicker" class="price-ticker ml-4 d-flex align-center">
          <span class="ticker-price">{{ formatPrice(currentTicker.lastPrice) }}</span>
          <span
            class="ticker-change ml-2"
            :class="tickerChangeClass"
          >
            {{ formatChange(currentTicker.priceChangePercent) }}%
          </span>
          <span class="ticker-meta ml-3 d-none d-md-inline">
            {{ $t('perpetuals.24hVol') }}: {{ formatPrice(currentTicker.volume) }}
          </span>
          <span class="ticker-meta ml-3 d-none d-md-inline">
            {{ $t('perpetuals.markPrice') }}: {{ formatPrice(currentTicker.markPrice) }}
          </span>
          <span class="ticker-meta ml-3 d-none d-lg-inline" :class="fundingClass">
            {{ $t('perpetuals.funding') }}: {{ formatFundingRate(currentFunding?.lastFundingRate) }}
          </span>
        </div>

        <v-spacer />

        <!-- Account summary -->
        <div v-if="account" class="account-summary mr-4 d-none d-md-flex align-center">
          <span class="account-label">{{ $t('perpetuals.availableBalance') }}:</span>
          <span class="account-value ml-1">{{ account.available_balance }} USD</span>
        </div>

        <v-btn icon :loading="tradingLoading" @click="refreshAll">
          <v-icon>mdi-reload</v-icon>
        </v-btn>
      </v-toolbar>

      <!-- Main content -->
      <v-card-text class="pa-0 perps-content">
        <v-row no-gutters style="height: 100%;">

          <!-- Left column: Order Form -->
          <v-col cols="12" md="4" class="pa-3 order-form-col">
            <!-- Order type toggle -->
            <v-btn-toggle v-model="orderType" mandatory class="mb-3 d-flex">
              <v-btn value="market" small class="flex-grow-1">{{ $t('perpetuals.market') }}</v-btn>
              <v-btn value="limit" small class="flex-grow-1">{{ $t('perpetuals.limit') }}</v-btn>
            </v-btn-toggle>

            <!-- Side toggle -->
            <v-btn-toggle v-model="orderSide" mandatory class="mb-3 d-flex">
              <v-btn value="buy" small color="success" class="flex-grow-1" style="color: #fff;">
                {{ $t('perpetuals.long') }}
              </v-btn>
              <v-btn value="sell" small color="error" class="flex-grow-1" style="color: #fff;">
                {{ $t('perpetuals.short') }}
              </v-btn>
            </v-btn-toggle>

            <!-- Price field (limit only) -->
            <v-text-field
              v-if="orderType === 'limit'"
              v-model="limitPrice"
              :label="$t('perpetuals.price')"
              type="number"
              outlined
              dense
              hide-details
              class="mb-3"
              prefix="$"
            />

            <!-- Size -->
            <v-text-field
              v-model="orderSize"
              :label="$t('perpetuals.size')"
              type="number"
              outlined
              dense
              hide-details
              class="mb-3"
            />

            <!-- Leverage -->
            <div class="mb-3">
              <div class="d-flex justify-space-between mb-1">
                <span class="form-label">{{ $t('perpetuals.leverage') }}</span>
                <span class="form-value">{{ leverage }}x</span>
              </div>
              <v-slider
                v-model="leverage"
                min="1"
                max="20"
                step="1"
                color="#26FAB0"
                track-color="rgba(255,255,255,0.2)"
                thumb-label
                hide-details
                dense
              />
              <div class="d-flex justify-space-between mt-1">
                <span class="slider-label">1x</span>
                <span class="slider-label">5x</span>
                <span class="slider-label">10x</span>
                <span class="slider-label">20x</span>
              </div>
            </div>

            <!-- TP/SL -->
            <v-expansion-panels flat class="mb-3">
              <v-expansion-panel>
                <v-expansion-panel-header class="pa-0 form-label">
                  {{ $t('perpetuals.tpSl') }} ({{ $t('common.optional') }})
                </v-expansion-panel-header>
                <v-expansion-panel-content>
                  <v-text-field
                    v-model="takeProfitPrice"
                    :label="$t('perpetuals.takeProfitPriceUsd')"
                    type="number"
                    outlined
                    dense
                    hide-details
                    class="mb-2 mt-2"
                    prefix="$"
                    prepend-inner-icon="mdi-target"
                  />
                  <v-text-field
                    v-model="stopLossPrice"
                    :label="$t('perpetuals.stopLossPriceUsd')"
                    type="number"
                    outlined
                    dense
                    hide-details
                    prefix="$"
                    prepend-inner-icon="mdi-stop-circle"
                  />
                </v-expansion-panel-content>
              </v-expansion-panel>
            </v-expansion-panels>

            <!-- Order summary -->
            <div class="order-summary mb-3">
              <div class="summary-row">
                <span>{{ $t('perpetuals.notionalValue') }}</span>
                <span class="summary-value">{{ notionalValue }}</span>
              </div>
            </div>

            <!-- Place order button -->
            <v-btn
              :color="orderSide === 'buy' ? 'success' : 'error'"
              block
              :loading="placingOrder"
              :disabled="!canPlaceOrder"
              @click="placeOrderAction()"
              class="place-order-btn"
            >
              <v-icon small class="mr-1">{{ orderType === 'market' ? 'mdi-flash' : 'mdi-target' }}</v-icon>
              {{ orderSide === 'buy' ? $t('perpetuals.buyLong') : $t('perpetuals.sellShort') }}
              {{ selectedSymbol }}
            </v-btn>

            <v-alert v-if="tradingError" type="error" dense class="mt-2" dismissible @input="tradingError = null">
              {{ tradingError }}
            </v-alert>

            <!-- Order book -->
            <div class="order-book mt-4">
              <div class="section-header mb-2">{{ $t('perpetuals.orderBook') }}</div>
              <div v-if="currentTicker" class="ob-mid-price text-center my-2">
                <span class="ob-price">{{ formatPrice(currentTicker.lastPrice) }}</span>
              </div>
              <div class="ob-placeholder text-center text--secondary caption">
                {{ $t('perpetuals.orderBookLive') }}
              </div>
            </div>
          </v-col>

          <!-- Right column: Tabs -->
          <v-col cols="12" md="8" class="pa-3">
            <v-tabs
              v-model="activeTab"
              background-color="transparent"
              color="#26FAB0"
              slider-color="#26FAB0"
              height="36"
              @change="onTabChange"
            >
              <v-tab class="tab-item">
                <span class="tab-text">{{ $t('perpetuals.positions') }}</span>
                <span v-if="openPositions.length > 0" class="tab-count ml-1">{{ openPositions.length }}</span>
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

            <v-divider class="mb-2" />

            <v-tabs-items v-model="activeTab" class="transparent">

              <!-- Tab 0: Positions -->
              <v-tab-item>
                <div v-if="tabLoading[0]" class="tab-loading">
                  <v-progress-circular indeterminate color="#26FAB0" size="32" />
                </div>
                <div v-else-if="openPositions.length === 0" class="empty-state">
                  <v-icon size="40" color="grey">mdi-chart-line</v-icon>
                  <p class="mt-2">{{ $t('perpetuals.noOpenPositions') }}</p>
                </div>
                <v-data-table
                  v-else
                  dense
                  :headers="positionHeaders"
                  :items="openPositions"
                  class="transparent perps-table"
                  hide-default-footer
                  :items-per-page="-1"
                >
                  <template v-slot:[`item.Side`]="{ item }">
                    <v-chip
                      x-small
                      label
                      :color="item.Side === 'long' ? 'success' : 'error'"
                      class="status-chip"
                    >
                      {{ item.Side.toUpperCase() }}
                    </v-chip>
                  </template>
                  <template v-slot:[`item.upnl`]="{ item }">
                    <span :class="parseFloat(item.upnl) >= 0 ? 'positive' : 'negative'">
                      {{ parseFloat(item.upnl) >= 0 ? '+' : '' }}{{ parseFloat(item.upnl).toFixed(2) }}
                    </span>
                  </template>
                  <template v-slot:[`item.liquidation_price`]="{ item }">
                    <span class="warning--text">{{ formatPrice(item.liquidation_price) }}</span>
                  </template>
                  <template v-slot:[`item.actions`]="{ item }">
                    <v-btn
                      x-small
                      color="error"
                      outlined
                      :loading="closingPosition === item.PositionID"
                      @click="closePosition(item)"
                      class="action-btn-compact"
                    >
                      {{ $t('perpetuals.close') }}
                    </v-btn>
                  </template>
                </v-data-table>
              </v-tab-item>

              <!-- Tab 1: Open Orders -->
              <v-tab-item>
                <div class="d-flex justify-end mb-2">
                  <v-btn
                    v-if="openOrders.length > 0"
                    x-small
                    outlined
                    color="error"
                    :loading="cancellingAll"
                    @click="cancelAllOrdersAction()"
                  >
                    {{ $t('perpetuals.cancelAll') }}
                  </v-btn>
                </div>
                <div v-if="tabLoading[1]" class="tab-loading">
                  <v-progress-circular indeterminate color="#26FAB0" size="32" />
                </div>
                <div v-else-if="openOrders.length === 0" class="empty-state">
                  <v-icon size="40" color="grey">mdi-format-list-bulleted</v-icon>
                  <p class="mt-2">{{ $t('perpetuals.noOpenOrders') }}</p>
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
                  <template v-slot:[`item.Type`]="{ item }">
                    <span class="text-uppercase">{{ item.Type }}</span>
                  </template>
                  <template v-slot:[`item.Side`]="{ item }">
                    <v-chip
                      x-small
                      label
                      :color="item.Side === 'buy' ? 'success' : 'error'"
                      class="status-chip"
                    >
                      {{ item.Side.toUpperCase() }}
                    </v-chip>
                  </template>
                  <template v-slot:[`item.Status`]="{ item }">
                    <v-chip x-small label :class="orderStatusClass(item.Status)" class="status-chip">
                      {{ item.Status }}
                    </v-chip>
                  </template>
                  <template v-slot:[`item.actions`]="{ item }">
                    <v-btn
                      x-small
                      outlined
                      color="error"
                      :loading="cancellingOrder === item.ID"
                      @click="cancelOrderAction(item)"
                      class="action-btn-compact"
                    >
                      {{ $t('perpetuals.cancel') }}
                    </v-btn>
                  </template>
                </v-data-table>
              </v-tab-item>

              <!-- Tab 2: Order History -->
              <v-tab-item>
                <div v-if="tabLoading[2]" class="tab-loading">
                  <v-progress-circular indeterminate color="#26FAB0" size="32" />
                </div>
                <div v-else-if="orderHistory.length === 0" class="empty-state">
                  <v-icon size="40" color="grey">mdi-history</v-icon>
                  <p class="mt-2">{{ $t('perpetuals.noOrderHistory') }}</p>
                </div>
                <v-data-table
                  v-else
                  dense
                  :headers="orderHistoryHeaders"
                  :items="orderHistory"
                  class="transparent perps-table"
                  :items-per-page="20"
                  :footer-props="{ itemsPerPageOptions: [10, 20, 50] }"
                >
                  <template v-slot:[`item.side`]="{ item }">
                    <v-chip
                      x-small
                      label
                      :color="item.side === 'buy' ? 'success' : 'error'"
                      class="status-chip"
                    >
                      {{ item.side.toUpperCase() }}
                    </v-chip>
                  </template>
                  <template v-slot:[`item.status`]="{ item }">
                    <v-chip x-small label :class="orderStatusClass(item.status)" class="status-chip">
                      {{ item.status }}
                    </v-chip>
                  </template>
                  <template v-slot:[`item.created_at`]="{ item }">
                    {{ formatTime(item.created_at) }}
                  </template>
                </v-data-table>
              </v-tab-item>

              <!-- Tab 3: Fill History -->
              <v-tab-item>
                <div v-if="tabLoading[3]" class="tab-loading">
                  <v-progress-circular indeterminate color="#26FAB0" size="32" />
                </div>
                <div v-else-if="fillHistory.length === 0" class="empty-state">
                  <v-icon size="40" color="grey">mdi-swap-horizontal</v-icon>
                  <p class="mt-2">{{ $t('perpetuals.noFillHistory') }}</p>
                </div>
                <v-data-table
                  v-else
                  dense
                  :headers="fillHistoryHeaders"
                  :items="fillHistory"
                  class="transparent perps-table"
                  :items-per-page="20"
                  :footer-props="{ itemsPerPageOptions: [10, 20, 50] }"
                >
                  <template v-slot:[`item.side`]="{ item }">
                    <v-chip
                      x-small
                      label
                      :color="item.side === 'buy' ? 'success' : 'error'"
                      class="status-chip"
                    >
                      {{ item.side.toUpperCase() }}
                    </v-chip>
                  </template>
                  <template v-slot:[`item.realized_pnl`]="{ item }">
                    <span :class="parseFloat(item.realized_pnl) >= 0 ? 'positive' : 'negative'">
                      {{ parseFloat(item.realized_pnl) >= 0 ? '+' : '' }}{{ parseFloat(item.realized_pnl).toFixed(4) }}
                    </span>
                  </template>
                  <template v-slot:[`item.auto_close_type`]="{ item }">
                    <v-chip
                      v-if="item.auto_close_type === 'LIQUIDATION'"
                      x-small
                      label
                      color="error"
                      class="status-chip"
                    >
                      {{ $t('perpetuals.liquidation') }}
                    </v-chip>
                  </template>
                  <template v-slot:[`item.time`]="{ item }">
                    {{ formatTime(item.time) }}
                  </template>
                </v-data-table>
              </v-tab-item>

              <!-- Tab 4: Funding History -->
              <v-tab-item>
                <div v-if="tabLoading[4]" class="tab-loading">
                  <v-progress-circular indeterminate color="#26FAB0" size="32" />
                </div>
                <div v-else-if="fundingHistory.length === 0" class="empty-state">
                  <v-icon size="40" color="grey">mdi-percent</v-icon>
                  <p class="mt-2">{{ $t('perpetuals.noFundingHistory') }}</p>
                </div>
                <v-data-table
                  v-else
                  dense
                  :headers="fundingHistoryHeaders"
                  :items="fundingHistory"
                  class="transparent perps-table"
                  :items-per-page="20"
                  :footer-props="{ itemsPerPageOptions: [10, 20, 50] }"
                >
                  <template v-slot:[`item.income`]="{ item }">
                    <span :class="parseFloat(item.income) >= 0 ? 'positive' : 'negative'">
                      {{ parseFloat(item.income) >= 0 ? '+' : '' }}{{ parseFloat(item.income).toFixed(6) }}
                      {{ item.asset }}
                    </span>
                  </template>
                  <template v-slot:[`item.time`]="{ item }">
                    {{ formatTime(item.time) }}
                  </template>
                </v-data-table>
              </v-tab-item>

            </v-tabs-items>
          </v-col>

        </v-row>
      </v-card-text>

      <!-- Footer -->
      <div class="d-flex align-center justify-center py-1 perps-footer">
        <span class="powered-by-text mr-2">{{ $t('common.poweredBy') }}</span>
        <img
          src="https://app.strikefinance.org/logo.svg"
          alt="Strike Finance"
          class="strike-logo"
          @error="onLogoError"
        />
      </div>

    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useStrikeMarket } from '@/modules/market/composables/useStrikeMarket';
import { useStrikeTrading } from '@/modules/market/composables/useStrikeTrading';
import { strikeUserApi } from '@/api/strike-v2.user';
import { strikeTradeApi } from '@/api/strike-v2.trade';
import type {
  Position,
  Order,
  OrderHistoryResult,
  FillHistoryResult,
  FundingHistoryResult,
  CreateOrderRequest,
} from '@/api/strike-v2.types';
import snackbar from '@/plugins/snackbar';

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
// Market data
// ---------------------------------------------------------------------------

const { symbols, symbolNames, tickers, fundingRates, loading: marketLoading } = useStrikeMarket();

const selectedSymbol = ref<string>('ADAUSDT');

watch(symbolNames, (names) => {
  if (names.length > 0 && !names.includes(selectedSymbol.value)) {
    selectedSymbol.value = names[0];
  }
}, { immediate: true });

const currentTicker = computed(() => tickers.value[selectedSymbol.value]);
const currentFunding = computed(() => fundingRates.value[selectedSymbol.value]);

const tickerChangeClass = computed(() => {
  const pct = parseFloat(currentTicker.value?.priceChangePercent ?? '0');
  return pct >= 0 ? 'positive' : 'negative';
});

const fundingClass = computed(() => {
  const rate = parseFloat(currentFunding.value?.lastFundingRate ?? '0');
  return rate >= 0 ? 'positive' : 'negative';
});

// ---------------------------------------------------------------------------
// Trading state (shared singleton)
// ---------------------------------------------------------------------------

const {
  account,
  openOrders,
  positions,
  loading: tradingLoading,
  error: tradingErrorRef,
  loadAccount,
  loadOpenOrders,
  loadPositions,
  cancelOrder,
  cancelAllOrders,
} = useStrikeTrading();

const tradingError = ref<string | null>(null);

// Only positions with non-zero size
const openPositions = computed<Position[]>(() =>
  (positions.value ?? []).filter((p) => parseFloat(p.Size) !== 0),
);

// ---------------------------------------------------------------------------
// Order form state
// ---------------------------------------------------------------------------

const orderType = ref<'market' | 'limit'>('market');
const orderSide = ref<'buy' | 'sell'>('buy');
const orderSize = ref<string>('');
const limitPrice = ref<string>('');
const leverage = ref<number>(5);
const takeProfitPrice = ref<string>('');
const stopLossPrice = ref<string>('');
const placingOrder = ref(false);

const notionalValue = computed(() => {
  const size = parseFloat(orderSize.value);
  const price = orderType.value === 'limit'
    ? parseFloat(limitPrice.value)
    : parseFloat(currentTicker.value?.lastPrice ?? '0');
  if (!size || !price) return '$0.00';
  return `$${(size * price).toFixed(2)}`;
});

const canPlaceOrder = computed(() => {
  const size = parseFloat(orderSize.value);
  if (!size || size <= 0) return false;
  if (orderType.value === 'limit') {
    const price = parseFloat(limitPrice.value);
    if (!price || price <= 0) return false;
  }
  return true;
});

async function placeOrderAction() {
  if (!canPlaceOrder.value) return;
  placingOrder.value = true;
  tradingError.value = null;
  try {
    const hasTPSL = !!takeProfitPrice.value || !!stopLossPrice.value;
    const params: CreateOrderRequest = {
      symbol: selectedSymbol.value,
      side: orderSide.value,
      type: orderType.value,
      size: orderSize.value,
    };
    if (orderType.value === 'limit' && limitPrice.value) {
      params.price = limitPrice.value;
    }

    let order: Order;
    if (hasTPSL) {
      const strategyParams: any = {
        ...params,
        strategy_id: crypto.randomUUID(),
      };
      if (takeProfitPrice.value) {
        strategyParams.tp_order = {
          type: 'take_profit',
          size: orderSize.value,
          stop_price: takeProfitPrice.value,
        };
      }
      if (stopLossPrice.value) {
        strategyParams.sl_order = {
          type: 'stop',
          size: orderSize.value,
          stop_price: stopLossPrice.value,
        };
      }
      order = await strikeTradeApi.createStrategyOrder(strategyParams);
    } else {
      order = await strikeTradeApi.createOrder(params);
    }

    snackbar.show({ message: `Order placed: ${order.ID ?? order.ClientOrderID}`, color: 'success' });
    orderSize.value = '';
    limitPrice.value = '';
    takeProfitPrice.value = '';
    stopLossPrice.value = '';
    await Promise.all([loadOpenOrders(selectedSymbol.value), loadAccount()]);
  } catch (e) {
    tradingError.value = e instanceof Error ? e.message : String(e);
  } finally {
    placingOrder.value = false;
  }
}

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
    snackbar.show({ message: 'Position closed', color: 'success' });
    await loadPositions(selectedSymbol.value);
  } catch (e) {
    snackbar.show({ message: e instanceof Error ? e.message : String(e), color: 'error' });
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
    await cancelOrder(order.ID, order.Symbol);
    snackbar.show({ message: 'Order cancelled', color: 'success' });
  } catch (e) {
    snackbar.show({ message: e instanceof Error ? e.message : String(e), color: 'error' });
  } finally {
    cancellingOrder.value = null;
  }
}

async function cancelAllOrdersAction() {
  cancellingAll.value = true;
  try {
    await cancelAllOrders(selectedSymbol.value);
    snackbar.show({ message: 'All orders cancelled', color: 'success' });
  } catch (e) {
    snackbar.show({ message: e instanceof Error ? e.message : String(e), color: 'error' });
  } finally {
    cancellingAll.value = false;
  }
}

// ---------------------------------------------------------------------------
// History — loaded lazily on tab activation
// ---------------------------------------------------------------------------

const activeTab = ref(0);
const tabLoading = ref<Record<number, boolean>>({ 0: false, 1: false, 2: false, 3: false, 4: false });

const orderHistory = ref<OrderHistoryResult[]>([]);
const fillHistory = ref<FillHistoryResult[]>([]);
const fundingHistory = ref<FundingHistoryResult[]>([]);

const tabLoaded = ref<Record<number, boolean>>({ 0: false, 1: false, 2: false, 3: false, 4: false });

async function onTabChange(tab: number) {
  if (tabLoaded.value[tab]) return;
  tabLoading.value[tab] = true;
  try {
    if (tab === 0) {
      await loadPositions(selectedSymbol.value);
    } else if (tab === 1) {
      await loadOpenOrders(selectedSymbol.value);
    } else if (tab === 2) {
      const res = await strikeUserApi.getOrderHistory({ symbol: selectedSymbol.value, limit: 50 });
      orderHistory.value = res.orders;
    } else if (tab === 3) {
      const res = await strikeUserApi.getFillHistory({ symbol: selectedSymbol.value, limit: 50 });
      fillHistory.value = res.fills;
    } else if (tab === 4) {
      const res = await strikeUserApi.getFundingHistory({ symbol: selectedSymbol.value, limit: 50 });
      fundingHistory.value = res.funding;
    }
    tabLoaded.value[tab] = true;
  } catch (e) {
    snackbar.show({ message: e instanceof Error ? e.message : String(e), color: 'error' });
  } finally {
    tabLoading.value[tab] = false;
  }
}

// Reset loaded state when symbol changes so data is refreshed
watch(selectedSymbol, () => {
  tabLoaded.value = { 0: false, 1: false, 2: false, 3: false, 4: false };
  onTabChange(activeTab.value);
});

// Load initial data when dialog opens
watch(dialogVisible, async (open) => {
  if (open) {
    await Promise.all([loadAccount(), onTabChange(0), onTabChange(1)]);
  }
});

async function refreshAll() {
  tabLoaded.value = { 0: false, 1: false, 2: false, 3: false, 4: false };
  await Promise.all([loadAccount(), onTabChange(activeTab.value)]);
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
  { text: 'PnL', value: 'upnl', sortable: true },
  { text: 'Leverage', value: 'Leverage', sortable: true },
  { text: 'Liq. Price', value: 'liquidation_price', sortable: false },
  { text: 'Actions', value: 'actions', sortable: false },
];

const openOrderHeaders = [
  { text: 'Type', value: 'Type', sortable: true },
  { text: 'Side', value: 'Side', sortable: true },
  { text: 'Symbol', value: 'Symbol', sortable: true },
  { text: 'Price', value: 'Price', sortable: true },
  { text: 'Size', value: 'Size', sortable: true },
  { text: 'Filled', value: 'Filled', sortable: true },
  { text: 'Status', value: 'Status', sortable: true },
  { text: 'Actions', value: 'actions', sortable: false },
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
  { text: 'Type', value: 'auto_close_type', sortable: false },
  { text: 'Time', value: 'time', sortable: true },
];

const fundingHistoryHeaders = [
  { text: 'Symbol', value: 'symbol', sortable: true },
  { text: 'Income', value: 'income', sortable: true },
  { text: 'Time', value: 'time', sortable: true },
];

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatPrice(val: string | number | undefined): string {
  if (val === undefined || val === null || val === '') return '—';
  const n = parseFloat(String(val));
  if (isNaN(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function formatChange(val: string | undefined): string {
  if (!val) return '0.00';
  const n = parseFloat(val);
  return (n >= 0 ? '+' : '') + n.toFixed(2);
}

function formatFundingRate(val: string | undefined): string {
  if (!val) return '0.0000%';
  const n = parseFloat(val) * 100;
  return (n >= 0 ? '+' : '') + n.toFixed(4) + '%';
}

function formatTime(val: number | string | undefined): string {
  if (!val) return '—';
  const ts = typeof val === 'number' ? val : Date.parse(val);
  if (isNaN(ts)) return String(val);
  return new Date(ts).toLocaleString();
}

function orderStatusClass(status: string): string {
  switch (status) {
    case 'filled': return 'status-chip success';
    case 'canceled':
    case 'cancelled': return 'status-chip grey';
    case 'rejected': return 'status-chip error';
    case 'open':
    case 'pending': return 'status-chip primary';
    default: return 'status-chip grey';
  }
}

function onLogoError(e: Event) {
  (e.target as HTMLImageElement).style.display = 'none';
}
</script>

<style scoped>
.perps-dialog {
  background: #0f1117 !important;
  display: flex;
  flex-direction: column;
}

.perps-toolbar {
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.perps-content {
  flex: 1;
  overflow-y: auto;
  height: calc(100vh - 64px - 36px);
}

.perps-footer {
  flex-shrink: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.3);
}

/* Symbol selector */
.symbol-select {
  font-weight: 600;
}

/* Price ticker */
.ticker-price {
  font-size: 18px;
  font-weight: 700;
  color: #ffffff;
}

.ticker-change {
  font-size: 13px;
  font-weight: 600;
}

.ticker-meta {
  font-size: 11px;
  color: #9ca3af;
}

/* Account summary */
.account-label {
  font-size: 11px;
  color: #9ca3af;
}

.account-value {
  font-size: 13px;
  font-weight: 600;
  color: #26FAB0;
}

/* Order form */
.order-form-col {
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  max-height: calc(100vh - 100px);
  overflow-y: auto;
}

.form-label {
  font-size: 12px;
  color: #9ca3af;
}

.form-value {
  font-size: 12px;
  font-weight: 600;
  color: #26FAB0;
}

.slider-label {
  font-size: 10px;
  color: #6b7280;
}

.order-summary {
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  padding: 8px 12px;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #9ca3af;
}

.summary-value {
  color: #26FAB0;
  font-weight: 600;
}

.place-order-btn {
  border-radius: 8px !important;
  text-transform: none !important;
  font-weight: 600 !important;
  height: 44px !important;
}

/* Order book */
.section-header {
  font-size: 12px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.ob-mid-price .ob-price {
  font-size: 16px;
  font-weight: 700;
  color: #26FAB0;
}

.ob-placeholder {
  padding: 24px 0;
}

/* Tabs */
.tab-item {
  min-width: auto !important;
  padding: 0 12px !important;
  font-size: 12px !important;
  font-weight: 500 !important;
  text-transform: none !important;
}

.tab-text {
  font-size: 12px;
}

.tab-count {
  background: rgba(38, 250, 176, 0.2);
  color: #26FAB0;
  border-radius: 10px;
  padding: 1px 5px;
  font-size: 10px;
  font-weight: 600;
}

/* Tables */
.perps-table {
  background: transparent !important;
}

.perps-table >>> th {
  font-size: 11px !important;
  color: #6b7280 !important;
  white-space: nowrap;
}

.perps-table >>> td {
  font-size: 12px !important;
  white-space: nowrap;
}

/* Loading / empty states */
.tab-loading {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 40px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: #6b7280;
  font-size: 13px;
}

/* Color helpers */
.positive {
  color: #10b981;
  font-weight: 600;
}

.negative {
  color: #ef4444;
  font-weight: 600;
}

/* Status chips */
.status-chip {
  font-size: 9px !important;
  height: 18px !important;
  padding: 0 6px !important;
  font-weight: 600 !important;
}

.status-chip.success {
  background: rgba(16, 185, 129, 0.15) !important;
  color: #10b981 !important;
  border: 1px solid rgba(16, 185, 129, 0.3) !important;
}

.status-chip.error {
  background: rgba(239, 68, 68, 0.15) !important;
  color: #ef4444 !important;
  border: 1px solid rgba(239, 68, 68, 0.3) !important;
}

.status-chip.primary {
  background: rgba(33, 150, 243, 0.15) !important;
  color: #2196f3 !important;
  border: 1px solid rgba(33, 150, 243, 0.3) !important;
}

.status-chip.grey {
  background: rgba(156, 163, 175, 0.15) !important;
  color: #9ca3af !important;
  border: 1px solid rgba(156, 163, 175, 0.3) !important;
}

.action-btn-compact {
  font-size: 10px !important;
  height: 22px !important;
  padding: 0 8px !important;
  min-width: auto !important;
}

/* Footer */
.powered-by-text {
  font-size: 11px;
  color: #6b7280;
}

.strike-logo {
  height: 18px;
  opacity: 0.7;
}
</style>
