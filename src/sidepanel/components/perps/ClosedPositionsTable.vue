<template>
  <div class="closed-positions">
    <!-- Loading skeleton -->
    <div v-if="loading" class="cp-skeleton">
      <div v-for="i in 3" :key="i" class="cp-skeleton-card" />
    </div>

    <!-- Empty state -->
    <div v-else-if="!positions.length" class="cp-empty">
      <v-icon size="32" class="cp-empty-icon">mdi-history</v-icon>
      <span class="cp-empty-text">{{ $t('perpetuals.noClosedPositions') }}</span>
    </div>

    <!-- Cards -->
    <div v-else class="cp-list">
      <div
        v-for="pos in positions"
        :key="pos.position_id"
        class="cp-card"
      >
        <!-- Header: Symbol + badges -->
        <div class="cp-header">
          <span class="cp-symbol">{{ pos.symbol }}</span>
          <div class="cp-badges">
            <span class="cp-badge" :class="pos.side === 'long' ? 'badge--long' : 'badge--short'">
              {{ pos.side === 'long' ? $t('perpetuals.long') : $t('perpetuals.short') }}
            </span>
            <span class="cp-badge badge--leverage">{{ pos.leverage }}x</span>
          </div>
        </div>

        <!-- Prices: Entry → Exit -->
        <div class="cp-prices">
          <div class="cp-price-block">
            <span class="cp-price-label">{{ $t('perpetuals.entryPrice') }}</span>
            <span class="cp-price-value">${{ formatPrice(pos.entry_price) }}</span>
          </div>
          <v-icon size="12" class="cp-arrow">mdi-arrow-right</v-icon>
          <div class="cp-price-block cp-price-block--right">
            <span class="cp-price-label">{{ $t('perpetuals.exitPrice') }}</span>
            <span class="cp-price-value">${{ formatPrice(pos.exit_price) }}</span>
          </div>
        </div>

        <!-- Footer: realized PnL + duration -->
        <div class="cp-footer">
          <div class="cp-pnl-block">
            <span class="cp-pnl-label">{{ $t('perpetuals.realizedPnl') }}</span>
            <span class="cp-pnl-value" :class="pnlClass(pos.realized_pnl)">
              {{ formatPnl(pos.realized_pnl) }}
            </span>
          </div>
          <div class="cp-duration">
            <v-icon size="10" class="cp-duration-icon">mdi-clock-outline</v-icon>
            <span>{{ formatDuration(pos.opened_at, pos.closed_at) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ClosedPosition } from '@/api/strike-v2.types';

withDefaults(defineProps<{
  positions: ClosedPosition[];
  loading?: boolean;
}>(), {
  loading: false,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(val: string | null | undefined): string {
  if (!val) return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPnl(val: string | null | undefined): string {
  if (!val) return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  const prefix = n >= 0 ? '+$' : '-$';
  return prefix + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pnlClass(val: string | null | undefined): string {
  if (!val) return '';
  const n = parseFloat(val);
  if (n > 0) return 'pnl--positive';
  if (n < 0) return 'pnl--negative';
  return '';
}

function formatDuration(openedAt: string, closedAt: string): string {
  const start = isNaN(Number(openedAt)) ? new Date(openedAt).getTime() : Number(openedAt);
  const end = isNaN(Number(closedAt)) ? new Date(closedAt).getTime() : Number(closedAt);
  if (!start || !end) return '—';
  const diffMs = Math.abs(end - start);
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay > 0) return `${diffDay}d ${diffHr % 24}h`;
  if (diffHr > 0) return `${diffHr}h ${diffMin % 60}m`;
  return `${diffMin}m`;
}
</script>

<style scoped>
.closed-positions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ── Skeleton ── */
.cp-skeleton {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cp-skeleton-card {
  height: 88px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.9; }
}

/* ── Empty ── */
.cp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 28px 16px;
  gap: 8px;
}

.cp-empty-icon {
  color: var(--g-text-3) !important;
}

.cp-empty-text {
  font-size: 12px;
  color: var(--g-text-3);
}

/* ── List ── */
.cp-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ── Card ── */
.cp-card {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 9px 11px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

/* ── Header ── */
.cp-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cp-symbol {
  font-size: 12px;
  font-weight: 700;
  color: var(--g-text-1);
  flex: 1;
}

.cp-badges {
  display: flex;
  gap: 4px;
}

.cp-badge {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 1px 5px;
  border-radius: 4px;
  text-transform: uppercase;
}

.badge--long {
  background: var(--g-success-fill);
  color: var(--g-success);
}

.badge--short {
  background: var(--g-error-fill);
  color: var(--g-error);
}

.badge--leverage {
  background: color-mix(in srgb, var(--g-accent) 12%, transparent);
  color: var(--g-accent);
}

/* ── Prices ── */
.cp-prices {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cp-price-block {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
}

.cp-price-block--right {
  align-items: flex-end;
}

.cp-price-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--g-text-3);
}

.cp-price-value {
  font-size: 11px;
  font-weight: 600;
  color: var(--g-text-2);
  font-variant-numeric: tabular-nums;
}

.cp-arrow {
  color: var(--g-text-3) !important;
  flex-shrink: 0;
}

/* ── Footer ── */
.cp-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--g-hairline-1);
  padding-top: 6px;
}

.cp-pnl-block {
  display: flex;
  align-items: baseline;
  gap: 5px;
}

.cp-pnl-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--g-text-3);
}

.cp-pnl-value {
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.pnl--positive {
  color: var(--g-success);
}

.pnl--negative {
  color: var(--g-error);
}

.cp-duration {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--g-text-3);
}

.cp-duration-icon {
  color: var(--g-text-3) !important;
}
</style>
