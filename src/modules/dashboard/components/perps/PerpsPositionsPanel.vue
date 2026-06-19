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
          :items="positionRows"
          item-key="pos.PositionID"
          :expanded.sync="expandedRows"
          show-expand
          single-expand
          class="transparent perps-table"
          hide-default-footer
          :items-per-page="-1"
        >
          <template v-slot:[`item.symbol`]="{ item }">
            <span class="font-mono">{{ item.pos.symbol }}</span>
          </template>
          <template v-slot:[`item.Side`]="{ item }">
            <span :class="item.pos.Side === 'long' ? 'clr-green' : 'clr-red'" class="fw-600 text-uppercase font-mono">
              {{ item.pos.Side }}
            </span>
          </template>
          <template v-slot:[`item.entryMark`]="{ item }">
            <div class="cell-stack">
              <span class="font-mono">{{ formatPrice(item.pos.EntryPrice) }}</span>
              <span class="font-mono cell-sub">{{ formatPrice(item.markPrice) }}</span>
            </div>
          </template>
          <template v-slot:[`item.Size`]="{ item }">
            <span class="font-mono">{{ formatSize(item.pos.Size) }}</span>
          </template>
          <template v-slot:[`item.liquidation_price`]="{ item }">
            <v-tooltip top max-width="240" :open-delay="120">
              <template #activator="{ on, attrs }">
                <span
                  class="font-mono cell-hint"
                  :class="liqClass(item)"
                  v-bind="attrs"
                  v-on="on"
                >
                  {{ formatPrice(item.liqPrice) }}
                  <span class="liq-distance" v-if="item.distanceToLiq != null">
                    ({{ formatSignedPct(item.distanceToLiq) }})
                  </span>
                </span>
              </template>
              <span>{{ item.pos.MarginMode === 'cross' ? $t('perps.position.crossTooltip') : $t('perps.position.isolatedTooltip') }}</span>
            </v-tooltip>
          </template>
          <template v-slot:[`item.margin`]="{ item }">
            <span class="font-mono">{{ formatPrice(item.summary.currentMargin) }}</span>
          </template>
          <template v-slot:[`item.upnl`]="{ item }">
            <span :class="pnlClass(item.summary.unrealizedPnl)" class="font-mono fw-600">
              {{ formatSignedUsd(item.summary.unrealizedPnl) }}
              <span class="roe-pct" v-if="item.summary.currentMargin > 0">
                ({{ formatSignedPct(item.summary.pnlPercentage) }})
              </span>
            </span>
          </template>
          <template v-slot:[`item.actions`]="{ item }">
            <v-btn
              x-small text color="#F6465D"
              :loading="closingPosition === item.pos.PositionID"
              @click="closePosition(item.pos)"
              class="action-btn"
            >
              {{ $t('perpetuals.close') }}
            </v-btn>
          </template>
          <template v-slot:expanded-item="{ headers, item }">
            <td :colspan="headers.length" class="expanded-cell">
              <div class="expanded-summary">
                <div class="expanded-title">{{ $t('perps.position.summary') }}</div>
                <div class="expanded-grid">
                  <div class="expanded-stat">
                    <span class="expanded-label">{{ $t('perps.position.notional') }}</span>
                    <span class="expanded-value">${{ formatPrice(item.summary.notional) }}</span>
                  </div>
                  <div class="expanded-stat">
                    <span class="expanded-label">{{ $t('perps.position.margin') }}</span>
                    <span class="expanded-value">${{ formatPrice(item.summary.currentMargin) }}</span>
                  </div>
                  <div class="expanded-stat">
                    <span class="expanded-label">{{ $t('perps.position.maintenanceMargin') }}</span>
                    <span class="expanded-value">${{ formatPrice(item.summary.maintenanceMargin) }}</span>
                  </div>
                  <div class="expanded-stat">
                    <span class="expanded-label">{{ $t('perps.position.upnl') }}</span>
                    <span class="expanded-value" :class="pnlClass(item.summary.unrealizedPnl)">
                      {{ formatSignedUsd(item.summary.unrealizedPnl) }}
                    </span>
                  </div>
                  <div class="expanded-stat">
                    <span class="expanded-label">{{ $t('perps.position.upnlPct') }}</span>
                    <span class="expanded-value" :class="pnlClass(item.summary.unrealizedPnl)">
                      {{ formatSignedPct(item.summary.pnlPercentage) }}
                    </span>
                  </div>
                  <div class="expanded-stat">
                    <span class="expanded-label">{{ $t('perps.position.liqPrice') }}</span>
                    <span class="expanded-value" :class="liqClass(item)">
                      ${{ formatPrice(item.liqPrice) }}
                    </span>
                  </div>
                  <div class="expanded-stat" v-if="item.distanceToLiq != null">
                    <span class="expanded-label">{{ $t('perps.position.distanceToLiq') }}</span>
                    <span class="expanded-value" :class="liqClass(item)">
                      {{ formatSignedPct(item.distanceToLiq) }}
                    </span>
                  </div>
                </div>
              </div>
            </td>
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
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { usePerpsFormatters } from '@/modules/market/composables/perps';
import { strikeUserApi } from '@/api/strike-v2.user';
import { strikeTradeApi } from '@/api/strike-v2.trade';
import { strikeMarketApi } from '@/api/strike-v2.market';
import type {
  AccountResponse,
  FillHistoryResult,
  FundingHistoryResult,
  MarginTier,
  Order,
  OrderHistoryResult,
  Position,
  StrikeMarketConfig,
} from '@/api/strike-v2.types';
import {
  calcPositionSummary,
  normalizeMarginTiers,
  type CrossPositionInput,
  type IsolatedPositionInput,
  type PositionSide as MathPositionSide,
  type PositionSummary,
} from '@/modules/market/math';
import { useStrikeMarketWs } from '@/modules/market/composables/useStrikeMarketWs';
import snackbar from '@/plugins/snackbar';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t: $t } = useTranslation();
const { formatTime } = usePerpsFormatters();

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
// Live mark prices (per-symbol, via market WS)
// ---------------------------------------------------------------------------

const marketWs = useStrikeMarketWs();
const markPrices = ref<Record<string, string>>({});
const subs = new Map<string, () => void>();

function ensureMarkPriceSub(symbol: string) {
  if (subs.has(symbol)) return;
  const unsub = marketWs.subscribeMarkPrice(symbol, (data: unknown) => {
    const d = data as { p?: string };
    if (d?.p) markPrices.value = { ...markPrices.value, [symbol]: d.p };
  });
  subs.set(symbol, unsub);
}

function pruneSubs(activeSymbols: Set<string>) {
  for (const [symbol, unsub] of subs.entries()) {
    if (!activeSymbols.has(symbol)) {
      unsub();
      subs.delete(symbol);
    }
  }
}

watch(() => props.positions, (positions) => {
  const active = new Set<string>();
  for (const p of positions ?? []) {
    if (p?.symbol) {
      active.add(p.symbol);
      ensureMarkPriceSub(p.symbol);
    }
  }
  pruneSubs(active);
}, { immediate: true, deep: true });

onBeforeUnmount(() => {
  for (const unsub of subs.values()) unsub();
  subs.clear();
});

// ---------------------------------------------------------------------------
// Margin tiers per symbol — fetch markets once, memoise normalised tiers
// ---------------------------------------------------------------------------

const marketsConfig = ref<Record<string, StrikeMarketConfig>>({});
// Plain Map (non-reactive) so the cache write inside `tiersFor()` doesn't
// trigger a re-run of the computed that calls it.
const tierCache = new Map<string, ReturnType<typeof normalizeMarginTiers>>();

function tiersFor(symbol: string): ReturnType<typeof normalizeMarginTiers> {
  const cached = tierCache.get(symbol);
  if (cached) return cached;
  const cfg = marketsConfig.value[symbol];
  const raw: MarginTier[] | undefined = cfg?.margin_tiers;
  if (!raw || raw.length === 0) return [];
  const numeric = normalizeMarginTiers(raw);
  tierCache.set(symbol, numeric);
  return numeric;
}

watch(marketsConfig, () => tierCache.clear(), { deep: true });

let fetchedMarkets = false;
watch(() => props.positions, async (positions) => {
  if (fetchedMarkets) return;
  if (!positions || positions.length === 0) return;
  fetchedMarkets = true;
  try {
    const res = await strikeMarketApi.getMarkets();
    marketsConfig.value = res.markets ?? {};
  } catch {
    fetchedMarkets = false;
  }
}, { immediate: true });

// ---------------------------------------------------------------------------
// Computed rows with derived math (uPnL, margin, liq, etc.)
// ---------------------------------------------------------------------------

interface PositionRow {
  pos: Position;
  markPrice: number;
  summary: PositionSummary;
  liqPrice: number;
  distanceToLiq: number | null;
}

function toMathSide(s: Position['Side']): MathPositionSide {
  return s === 'long' ? 'LONG' : 'SHORT';
}

function liveMarkFor(pos: Position): number {
  const ws = markPrices.value[pos.symbol];
  const wsNum = ws ? parseFloat(ws) : NaN;
  if (isFinite(wsNum) && wsNum > 0) return wsNum;
  // Fallback for the active symbol: parent-supplied livePrice
  if (pos.symbol === props.symbol && props.livePrice > 0) return props.livePrice;
  const entry = parseFloat(pos.EntryPrice ?? '0');
  return isFinite(entry) ? entry : 0;
}

const positions = computed<Position[]>(() => props.positions ?? []);

const positionRows = computed<PositionRow[]>(() => {
  const list = positions.value;
  if (list.length === 0) return [];

  const walletBalance = parseFloat(props.account?.wallet_balance ?? '0') || 0;

  // Build cross/isolated context once.
  const crossInputs: CrossPositionInput[] = [];
  const isoInputs: IsolatedPositionInput[] = [];

  for (const p of list) {
    const tiers = tiersFor(p.symbol);
    if (tiers.length === 0) continue;
    const size = Math.abs(parseFloat(p.Size ?? '0'));
    const entry = parseFloat(p.EntryPrice ?? '0');
    const mark = liveMarkFor(p);
    const notional = mark * size;
    let tier = tiers[tiers.length - 1];
    for (const t of tiers) {
      if (notional <= t.max_notional) { tier = t; break; }
    }
    if (p.MarginMode === 'cross') {
      crossInputs.push({
        symbol: p.symbol,
        side: toMathSide(p.Side),
        size,
        entryPrice: entry,
        markPrice: mark,
        notional,
        tier,
      });
    } else {
      isoInputs.push({ isoBalance: parseFloat(p.IsolatedMargin ?? '0') || 0 });
    }
  }

  return list.map((p) => {
    const tiers = tiersFor(p.symbol);
    const mark = liveMarkFor(p);
    const entry = parseFloat(p.EntryPrice ?? '0') || 0;
    const size = Math.abs(parseFloat(p.Size ?? '0')) || 0;
    const isoBalance = parseFloat(p.IsolatedMargin ?? '0') || 0;
    const side = toMathSide(p.Side);

    const summary = calcPositionSummary({
      side,
      marginType: p.MarginMode === 'cross' ? 'cross' : 'isolated',
      entryPrice: entry,
      markPrice: mark,
      size,
      leverage: p.Leverage,
      isoBalance,
      tiers,
      walletBalance,
      // Exclude the current position by symbol+side, not symbol alone —
      // hedge-mode traders have both LONG and SHORT open on one symbol.
      otherCrossPositions: p.MarginMode === 'cross'
        ? crossInputs.filter((c) => !(c.symbol === p.symbol && c.side === side))
        : crossInputs,
      isolatedPositions: isoInputs,
    });

    const apiLiq = parseFloat(p.liquidation_price ?? '');
    const liqPrice = isFinite(apiLiq) && apiLiq > 0 ? apiLiq : summary.liquidationPrice;

    let distanceToLiq: number | null = null;
    if (mark > 0 && liqPrice > 0) {
      distanceToLiq = ((liqPrice - mark) / mark) * 100;
    }

    return { pos: p, markPrice: mark, summary, liqPrice, distanceToLiq };
  });
});

const expandedRows = ref<PositionRow[]>([]);

// ---------------------------------------------------------------------------
// Formatters (tight, scoped — independent of usePerpsFormatters)
// ---------------------------------------------------------------------------

function formatPrice(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '') return '—';
  const n = typeof val === 'number' ? val : parseFloat(val);
  if (!isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSize(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '') return '—';
  const n = typeof val === 'number' ? val : parseFloat(val);
  if (!isFinite(n)) return '—';
  return Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function formatSignedUsd(n: number): string {
  if (!isFinite(n)) return '—';
  const prefix = n >= 0 ? '+$' : '-$';
  return prefix + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSignedPct(n: number): string {
  if (!isFinite(n)) return '—';
  const prefix = n >= 0 ? '+' : '';
  return `${prefix}${n.toFixed(2)}%`;
}

function pnlClass(n: number): string {
  if (!isFinite(n) || n === 0) return '';
  return n > 0 ? 'clr-green' : 'clr-red';
}

function liqClass(row: PositionRow): string {
  if (row.distanceToLiq == null) return 'clr-yellow';
  return Math.abs(row.distanceToLiq) < 10 ? 'clr-orange' : 'clr-yellow';
}

// ---------------------------------------------------------------------------
// Table headers
// ---------------------------------------------------------------------------

const positionHeaders = [
  { text: $t('perpetuals.positions'), value: 'symbol', sortable: true },
  { text: $t('perpetuals.side'), value: 'Side', sortable: true },
  { text: $t('perps.position.size'), value: 'Size', sortable: false },
  { text: `${$t('perps.position.entry')} / ${$t('perps.position.mark')}`, value: 'entryMark', sortable: false },
  { text: $t('perps.position.liqPrice'), value: 'liquidation_price', sortable: false },
  { text: $t('perps.position.margin'), value: 'margin', sortable: false },
  { text: `${$t('perps.position.upnl')} (%)`, value: 'upnl', sortable: false },
  { text: '', value: 'actions', sortable: false, width: 70 },
  { text: '', value: 'data-table-expand', width: 28 },
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

/* Stacked entry/mark cell */
.cell-stack {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.cell-sub {
  color: #848e9c;
  font-size: 10px !important;
}

.cell-hint {
  text-decoration: underline dotted rgba(255, 255, 255, 0.18);
  text-underline-offset: 2px;
  cursor: help;
}

.liq-distance {
  color: #848e9c;
  font-size: 10px;
  margin-left: 2px;
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
.clr-orange { color: #FFA726 !important; }

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

/* ── Expanded row ── */
.expanded-cell {
  padding: 8px 12px !important;
  background: rgba(255, 255, 255, 0.02) !important;
  height: auto !important;
}

.expanded-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.expanded-title {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #5e6673;
}

.expanded-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 4px 12px;
}

.expanded-stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.expanded-label {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #5e6673;
}

.expanded-value {
  font-size: 11px;
  font-weight: 600;
  color: #eaecef;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

/* ── Responsive — narrow widths ── */
@media (max-width: 720px) {
  /* Hide nice-to-have columns on narrow widths: keep symbol, side, size, uPnL, liq */
  .perps-table >>> th:nth-child(4),
  .perps-table >>> td:nth-child(4),
  .perps-table >>> th:nth-child(6),
  .perps-table >>> td:nth-child(6) {
    display: none;
  }
}
</style>
