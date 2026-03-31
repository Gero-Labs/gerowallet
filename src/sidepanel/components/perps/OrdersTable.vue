<template>
  <div class="orders-table">
    <!-- Header -->
    <div class="ot-header">
      <span class="ot-title">
        {{ $t('perpetuals.openOrders') }}
        <span v-if="orders.length" class="ot-count">{{ orders.length }}</span>
      </span>
      <button
        v-if="orders.length"
        class="ot-cancel-all"
        @click="$emit('cancel-all')"
      >
        {{ $t('perpetuals.cancelAll') }}
      </button>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="ot-skeleton">
      <div v-for="i in 3" :key="i" class="ot-skeleton-card" />
    </div>

    <!-- Empty state -->
    <div v-else-if="!orders.length" class="ot-empty">
      <v-icon size="28" class="ot-empty-icon">mdi-format-list-bulleted</v-icon>
      <span class="ot-empty-text">{{ $t('perpetuals.noOpenOrders') }}</span>
    </div>

    <!-- Order cards -->
    <div v-else class="ot-list">
      <div
        v-for="order in orders"
        :key="order.ID"
        class="ot-card"
      >
        <!-- Row 1: Type + Side + Symbol + Cancel -->
        <div class="ot-card-header">
          <div class="ot-left">
            <span class="ot-badge" :class="orderTypeClass(order.Type)">
              {{ formatType(order.Type) }}
            </span>
            <span class="ot-badge" :class="order.Side === 'buy' ? 'badge--buy' : 'badge--sell'">
              {{ order.Side === 'buy' ? $t('perpetuals.buy') : $t('perpetuals.sell') }}
            </span>
            <span class="ot-symbol">{{ order.Symbol }}</span>
          </div>
          <button
            class="ot-cancel-btn"
            :title="$t('perpetuals.cancelOrder')"
            @click="$emit('cancel-order', order.ID, order.Symbol)"
          >
            <v-icon size="14">mdi-close</v-icon>
          </button>
        </div>

        <!-- Row 2: Price | Size -->
        <div class="ot-fields-row">
          <div class="ot-field">
            <span class="ot-field-label">{{ $t('perpetuals.price') }}</span>
            <span class="ot-field-value">
              {{ order.Type === 'market' ? $t('perpetuals.market') : '$' + formatNum(order.Price) }}
            </span>
          </div>
          <div class="ot-field ot-field--center">
            <span class="ot-field-label">{{ $t('perpetuals.size') }}</span>
            <span class="ot-field-value">{{ formatNum(order.Size) }}</span>
          </div>
          <div class="ot-field ot-field--right">
            <span class="ot-field-label">{{ $t('perpetuals.filled') }}</span>
            <span class="ot-field-value">{{ formatNum(order.Filled) }}</span>
          </div>
        </div>

        <!-- Row 3: Fill progress bar -->
        <div class="ot-fill-track">
          <div
            class="ot-fill-bar"
            :style="{ width: fillPct(order) + '%' }"
          />
        </div>

        <!-- Row 4: Status chip -->
        <div class="ot-status-row">
          <span class="ot-status-chip" :class="statusClass(order.Status)">
            {{ formatStatus(order.Status) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Order, OrderType, OrderStatus } from '@/api/strike-v2.types';

withDefaults(defineProps<{
  orders: Order[];
  loading?: boolean;
}>(), {
  loading: false,
});

defineEmits<{
  (e: 'cancel-order', orderId: string, symbol: string): void;
  (e: 'cancel-all'): void;
}>();

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatNum(val: string | null | undefined): string {
  if (!val || val === '0') return '0';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function fillPct(order: Order): number {
  const size = parseFloat(order.Size ?? '0');
  const filled = parseFloat(order.Filled ?? '0');
  if (!size) return 0;
  return Math.min((filled / size) * 100, 100);
}

function formatType(type: OrderType): string {
  const map: Record<string, string> = {
    market: 'MKT',
    limit: 'LMT',
    stop: 'STP',
    stop_limit: 'STP LMT',
    take_profit: 'TP',
    take_profit_limit: 'TP LMT',
  };
  return map[type] ?? type.toUpperCase();
}

function formatStatus(status: OrderStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function orderTypeClass(type: OrderType): string {
  if (type === 'market') return 'type--market';
  if (type === 'limit') return 'type--limit';
  if (type === 'stop' || type === 'stop_limit') return 'type--stop';
  return 'type--tp';
}

function statusClass(status: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    open: 'status--open',
    pending: 'status--pending',
    untriggered: 'status--pending',
    filled: 'status--filled',
    canceled: 'status--canceled',
    rejected: 'status--canceled',
    expired: 'status--canceled',
    none: 'status--canceled',
  };
  return map[status] ?? '';
}
</script>

<style scoped>
.orders-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── Header ── */
.ot-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px;
}

.ot-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.35);
  display: flex;
  align-items: center;
  gap: 5px;
}

.ot-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 199, 243, 0.2);
  color: #00c7f3;
  font-size: 9px;
  font-weight: 800;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  padding: 0 4px;
}

.ot-cancel-all {
  font-size: 10px;
  font-weight: 600;
  color: #F97066;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  opacity: 0.75;
  transition: opacity 0.15s;
}

.ot-cancel-all:hover {
  opacity: 1;
}

/* ── Skeleton ── */
.ot-skeleton {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ot-skeleton-card {
  height: 96px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.9; }
}

/* ── Empty ── */
.ot-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 28px 16px;
  gap: 7px;
}

.ot-empty-icon {
  color: rgba(255, 255, 255, 0.15) !important;
}

.ot-empty-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.28);
}

/* ── List ── */
.ot-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ── Card ── */
.ot-card {
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 10px;
  padding: 9px 11px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

/* ── Card header ── */
.ot-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ot-left {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ot-symbol {
  font-size: 12px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);
  margin-left: 2px;
}

.ot-badge {
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 2px 5px;
  border-radius: 4px;
  text-transform: uppercase;
}

.type--market {
  background: rgba(0, 199, 243, 0.12);
  color: #00c7f3;
}

.type--limit {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
}

.type--stop {
  background: rgba(255, 167, 38, 0.12);
  color: #FFA726;
}

.type--tp {
  background: rgba(38, 250, 176, 0.1);
  color: #26FAB0;
}

.badge--buy {
  background: rgba(38, 250, 176, 0.12);
  color: #26FAB0;
}

.badge--sell {
  background: rgba(249, 112, 102, 0.12);
  color: #F97066;
}

.ot-cancel-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.3);
  padding: 2px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: color 0.15s, background 0.15s;
}

.ot-cancel-btn:hover {
  color: #F97066;
  background: rgba(249, 112, 102, 0.1);
}

/* ── Fields row ── */
.ot-fields-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
}

.ot-field {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ot-field--center {
  align-items: center;
}

.ot-field--right {
  align-items: flex-end;
}

.ot-field-label {
  font-size: 8.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.25);
}

.ot-field-value {
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  font-variant-numeric: tabular-nums;
}

/* ── Fill progress ── */
.ot-fill-track {
  height: 2px;
  background: rgba(255, 255, 255, 0.07);
  border-radius: 1px;
  overflow: hidden;
}

.ot-fill-bar {
  height: 100%;
  background: #00c7f3;
  border-radius: 1px;
  transition: width 0.3s ease;
}

/* ── Status row ── */
.ot-status-row {
  display: flex;
  align-items: center;
}

.ot-status-chip {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 7px;
  border-radius: 4px;
  text-transform: uppercase;
}

.status--open {
  background: rgba(0, 199, 243, 0.12);
  color: #00c7f3;
}

.status--pending {
  background: rgba(255, 167, 38, 0.12);
  color: #FFA726;
}

.status--filled {
  background: rgba(38, 250, 176, 0.12);
  color: #26FAB0;
}

.status--canceled {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.35);
}
</style>
