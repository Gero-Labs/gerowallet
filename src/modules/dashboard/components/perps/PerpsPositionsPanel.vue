<template>
  <div class="positions-area">
    <v-tabs
      v-model="activeTab"
      bg-color="transparent"
      color="success"
      slider-color="success"
      height="32"
      @update:model-value="onTabChange"
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

    <v-window v-model="activeTab" class="transparent positions-tabs-items">
      <!-- Positions -->
      <v-window-item>
        <div v-if="tabLoading[0]" class="tab-loading">
          <v-progress-circular indeterminate color="success" size="24" />
        </div>
        <div v-else-if="positions.length === 0" class="empty-state">
          <v-icon size="32" color="var(--g-raised)">mdi-chart-line</v-icon>
          <p class="mt-1">{{ $t('perpetuals.noOpenPositions') }}</p>
        </div>
        <v-data-table
          v-else
          density="compact"
          :headers="positionHeaders"
          :items="positionRows"
          item-value="pos.PositionID"
          :expanded="expandedRows" @update:expanded="expandedRows = $event.slice(-1)"
          show-expand
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
            <v-tooltip location="top"  max-width="240" :open-delay="120">
              <template #activator="{ props: activatorProps }">
                <span
                  class="font-mono cell-hint"
                  :class="liqClass(item)"
                  v-bind="activatorProps"

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
              size="x-small" variant="text" color="error"
              :loading="closingPosition === item.pos.PositionID"
              @click="closePosition(item.pos)"
              class="action-btn"
            >
              {{ $t('perpetuals.close') }}
            </v-btn>
          </template>
          <template #expanded-row="{ columns, item }"><tr>
            <td :colspan="columns.length" class="expanded-cell">
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
          </tr></template>
        </v-data-table>
      </v-window-item>

      <!-- Open Orders -->
      <v-window-item>
        <div class="d-flex justify-end pa-1" v-if="openOrders.length > 0">
          <v-btn size="x-small" variant="text" color="error" :loading="cancellingAll" @click="cancelAllOrdersAction()">
            {{ $t('perpetuals.cancelAll') }}
          </v-btn>
        </div>
        <div v-if="tabLoading[1]" class="tab-loading">
          <v-progress-circular indeterminate color="success" size="24" />
        </div>
        <div v-else-if="openOrders.length === 0" class="empty-state">
          <v-icon size="32" color="var(--g-raised)">mdi-format-list-bulleted</v-icon>
          <p class="mt-1">{{ $t('perpetuals.noOpenOrders') }}</p>
        </div>
        <v-data-table
          v-else
          density="compact"
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
            <v-btn size="x-small" variant="text" color="error" :loading="cancellingOrder === item.ID" @click="cancelOrderAction(item)" class="action-btn">
              {{ $t('perpetuals.cancel') }}
            </v-btn>
          </template>
        </v-data-table>
      </v-window-item>

      <!-- Order History -->
      <v-window-item>
        <div v-if="tabLoading[2]" class="tab-loading">
          <v-progress-circular indeterminate color="success" size="24" />
        </div>
        <div v-else-if="orderHistory.length === 0" class="empty-state">
          <v-icon size="32" color="var(--g-raised)">mdi-history</v-icon>
          <p class="mt-1">{{ $t('perpetuals.noOrderHistory') }}</p>
        </div>
        <v-data-table
          v-else density="compact"
          :headers="orderHistoryHeaders"
          :items="orderHistory"
          class="transparent perps-table"
          :items-per-page="20"
          :items-per-page-options="[10, 20, 50]"
        >
          <template v-slot:[`item.side`]="{ item }">
            <span :class="item.side === 'buy' ? 'clr-green' : 'clr-red'" class="fw-600 text-uppercase font-mono">{{ item.side }}</span>
          </template>
          <template v-slot:[`item.created_at`]="{ item }">{{ formatTime(item.created_at) }}</template>
        </v-data-table>
      </v-window-item>

      <!-- Fill History -->
      <v-window-item>
        <div v-if="tabLoading[3]" class="tab-loading">
          <v-progress-circular indeterminate color="success" size="24" />
        </div>
        <div v-else-if="fillHistory.length === 0" class="empty-state">
          <v-icon size="32" color="var(--g-raised)">mdi-swap-horizontal</v-icon>
          <p class="mt-1">{{ $t('perpetuals.noFillHistory') }}</p>
        </div>
        <v-data-table
          v-else density="compact"
          :headers="fillHistoryHeaders"
          :items="fillHistory"
          class="transparent perps-table"
          :items-per-page="20"
          :items-per-page-options="[10, 20, 50]"
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
      </v-window-item>

      <!-- Funding History -->
      <v-window-item>
        <div v-if="tabLoading[4]" class="tab-loading">
          <v-progress-circular indeterminate color="success" size="24" />
        </div>
        <div v-else-if="fundingHistory.length === 0" class="empty-state">
          <v-icon size="32" color="var(--g-raised)">mdi-percent</v-icon>
          <p class="mt-1">{{ $t('perpetuals.noFundingHistory') }}</p>
        </div>
        <v-data-table
          v-else density="compact"
          :headers="fundingHistoryHeaders"
          :items="fundingHistory"
          class="transparent perps-table"
          :items-per-page="20"
          :items-per-page-options="[10, 20, 50]"
        >
          <template v-slot:[`item.income`]="{ item }">
            <span :class="parseFloat(item.income) >= 0 ? 'clr-green' : 'clr-red'" class="font-mono">
              {{ parseFloat(item.income) >= 0 ? '+' : '' }}{{ parseFloat(item.income).toFixed(6) }} {{ item.asset }}
            </span>
          </template>
          <template v-slot:[`item.time`]="{ item }">{{ formatTime(item.time) }}</template>
        </v-data-table>
      </v-window-item>
    </v-window>
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

const expandedRows = ref<string[]>([]);

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
  { title: $t('perpetuals.positions'), key: 'symbol', sortable: true },
  { title: $t('perpetuals.side'), key: 'Side', sortable: true },
  { title: $t('perps.position.size'), key: 'Size', sortable: false },
  { title: `${$t('perps.position.entry')} / ${$t('perps.position.mark')}`, key: 'entryMark', sortable: false },
  { title: $t('perps.position.liqPrice'), key: 'liquidation_price', sortable: false },
  { title: $t('perps.position.margin'), key: 'margin', sortable: false },
  { title: `${$t('perps.position.upnl')} (%)`, key: 'upnl', sortable: false },
  { title: '', key: 'actions', sortable: false, width: 70 },
  { title: '', key: 'data-table-expand', width: 28 },
];

const openOrderHeaders = [
  { title: 'Type', key: 'Type', sortable: true },
  { title: 'Side', key: 'Side', sortable: true },
  { title: 'Symbol', key: 'Symbol', sortable: true },
  { title: 'Price', key: 'Price', sortable: true },
  { title: 'Size', key: 'Size', sortable: true },
  { title: 'Filled', key: 'Filled', sortable: true },
  { title: 'Status', key: 'Status', sortable: true },
  { title: '', key: 'actions', sortable: false, width: 70 },
];

const orderHistoryHeaders = [
  { title: 'Type', key: 'type', sortable: true },
  { title: 'Side', key: 'side', sortable: true },
  { title: 'Symbol', key: 'symbol', sortable: true },
  { title: 'Price', key: 'price', sortable: true },
  { title: 'Size', key: 'size', sortable: true },
  { title: 'Filled', key: 'filled', sortable: true },
  { title: 'Status', key: 'status', sortable: true },
  { title: 'Time', key: 'created_at', sortable: true },
];

const fillHistoryHeaders = [
  { title: 'Symbol', key: 'symbol', sortable: true },
  { title: 'Side', key: 'side', sortable: true },
  { title: 'Price', key: 'price', sortable: true },
  { title: 'Qty', key: 'qty', sortable: true },
  { title: 'Fee', key: 'commission', sortable: true },
  { title: 'Realized PnL', key: 'realized_pnl', sortable: true },
  { title: 'Time', key: 'time', sortable: true },
];

const fundingHistoryHeaders = [
  { title: 'Symbol', key: 'symbol', sortable: true },
  { title: 'Income', key: 'income', sortable: true },
  { title: 'Time', key: 'time', sortable: true },
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
  border-top: 1px solid var(--g-hairline-2);
  border-right: 1px solid var(--g-hairline-2);
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
  background: var(--g-success-fill);
  color: var(--g-success);
  border-radius: var(--g-r-control);
  padding: 0 4px;
  font-size: 11px;
  font-weight: 600;
}

/* Tables */
.perps-table { background: transparent !important; }

.perps-table >>> th {
  font-size: 11px !important;
  color: var(--g-text-3) !important;
  white-space: nowrap;
  padding: 4px 8px !important;
  height: 28px !important;
}

.perps-table >>> td {
  font-size: 11px !important;
  white-space: nowrap;
  padding: 2px 8px !important;
  height: 28px !important;
  font-family: var(--g-font-mono);
  color: var(--g-text-1);
}

/* Stacked entry/mark cell */
.cell-stack {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.cell-sub {
  color: var(--g-text-3);
  font-size: 11px !important;
}

.cell-hint {
  text-decoration: underline dotted var(--g-hairline-3);
  text-underline-offset: 2px;
  cursor: help;
}

.liq-distance {
  color: var(--g-text-3);
  font-size: 11px;
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
  color: var(--g-text-3);
  font-size: 12px;
  flex: 1;
  min-height: 206px;
}

/* Action buttons */
.action-btn {
  font-size: 11px !important;
  text-transform: none !important;
  min-width: auto !important;
  height: 22px !important;
  padding: 0 6px !important;
}

/* Color utilities */
.clr-green { color: var(--g-success) !important; }
.clr-red { color: var(--g-error) !important; }
.clr-yellow { color: var(--g-warning) !important; }
.clr-orange { color: var(--g-warning) !important; }

.fw-600 { font-weight: 600; }

.font-mono { font-family: var(--g-font-mono); }

.roe-pct {
  font-size: 11px;
  opacity: 0.8;
}

.form-value {
  font-size: 11px;
  font-weight: 600;
  color: var(--g-text-1);
  font-family: var(--g-font-mono);
}

/* ── Expanded row ── */
.expanded-cell {
  padding: 8px 12px !important;
  background: var(--g-raised) !important;
  height: auto !important;
}

.expanded-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.expanded-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--g-text-3);
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
  font-size: 11px;
  font-weight: 600;
  color: var(--g-text-3);
}

.expanded-value {
  font-size: 11px;
  font-weight: 600;
  color: var(--g-text-1);
  font-family: var(--g-font-mono);
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
