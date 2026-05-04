<template>
  <div class="positions-table">
    <!-- Loading skeleton -->
    <div v-if="loading" class="pt-skeleton">
      <div v-for="i in 2" :key="i" class="pt-skeleton-card" />
    </div>

    <!-- Empty state -->
    <div v-else-if="!positions.length" class="pt-empty">
      <v-icon size="32" class="pt-empty-icon">mdi-chart-line-variant</v-icon>
      <span class="pt-empty-text">{{ $t('perpetuals.noOpenPositions') }}</span>
    </div>

    <!-- Position cards -->
    <div v-else class="pt-list">
      <div
        v-for="pos in positions"
        :key="pos.PositionID"
        class="pt-card"
      >
        <!-- Row 1: Symbol + badges -->
        <div class="pt-card-header">
          <span class="pt-symbol">{{ pos.symbol }}</span>
          <div class="pt-badges">
            <span class="pt-badge" :class="pos.Side === 'long' ? 'badge--long' : 'badge--short'">
              {{ pos.Side === 'long' ? $t('perpetuals.long') : $t('perpetuals.short') }}
            </span>
            <span class="pt-badge badge--leverage">{{ pos.Leverage }}x</span>
            <span class="pt-badge badge--margin-mode">
              {{ pos.MarginMode === 'cross' ? $t('perpetuals.cross') : $t('perpetuals.isolated') }}
            </span>
          </div>
        </div>

        <!-- Row 2: Entry / Mark prices -->
        <div class="pt-prices-row">
          <div class="pt-price-col">
            <span class="pt-price-label">{{ $t('perpetuals.entryPrice') }}</span>
            <span class="pt-price-value">${{ formatPrice(pos.EntryPrice) }}</span>
          </div>
          <div class="pt-price-divider" />
          <div class="pt-price-col pt-price-col--right">
            <span class="pt-price-label">{{ $t('perpetuals.markPrice') }}</span>
            <span class="pt-price-value">${{ formatPrice(pos.EntryPrice) }}</span>
          </div>
        </div>

        <!-- Row 3: Unrealized PnL (large) -->
        <div class="pt-upnl-row">
          <div class="pt-upnl-block">
            <span class="pt-upnl-label">{{ $t('perpetuals.unrealizedPnl') }}</span>
            <span class="pt-upnl-value" :class="pnlClass(pos.upnl)">
              {{ formatPnl(pos.upnl) }}
            </span>
          </div>
        </div>

        <!-- Row 4: Liquidation price + Close button -->
        <div class="pt-footer-row">
          <div class="pt-liq-block">
            <span class="pt-liq-label">{{ $t('perpetuals.liquidationPrice') }}</span>
            <span
              class="pt-liq-value"
              :class="isLiqClose(pos) ? 'liq--warn' : ''"
            >
              ${{ formatPrice(pos.liquidation_price) }}
            </span>
          </div>
          <v-btn
            depressed
            x-small
            class="pt-close-btn"
            @click="$emit('close-position', pos)"
          >
            {{ $t('perpetuals.close') }}
          </v-btn>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Position } from '@/api/strike-v2.types';

const props = withDefaults(defineProps<{
  positions: Position[];
  loading?: boolean;
}>(), {
  loading: false,
});

defineEmits<{
  (e: 'close-position', position: Position): void;
}>();

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

function isLiqClose(pos: Position): boolean {
  const liq = parseFloat(pos.liquidation_price ?? '0');
  const entry = parseFloat(pos.EntryPrice ?? '0');
  if (!liq || !entry) return false;
  // Warn if liquidation price is within 10% of entry
  return Math.abs(liq - entry) / entry < 0.1;
}
</script>

<style scoped>
.positions-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── Skeleton ── */
.pt-skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pt-skeleton-card {
  height: 120px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.9; }
}

/* ── Empty state ── */
.pt-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  gap: 8px;
}

.pt-empty-icon {
  color: rgba(255, 255, 255, 0.15) !important;
}

.pt-empty-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.3);
  text-align: center;
}

/* ── List ── */
.pt-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── Card ── */
.pt-card {
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.15s ease;
}

.pt-card:hover {
  border-color: rgba(255, 255, 255, 0.14);
}

/* ── Header row ── */
.pt-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pt-symbol {
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: 0.02em;
  flex: 1;
}

.pt-badges {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pt-badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.badge--long {
  background: rgba(38, 250, 176, 0.15);
  color: #26FAB0;
}

.badge--short {
  background: rgba(249, 112, 102, 0.15);
  color: #F97066;
}

.badge--leverage {
  background: rgba(0, 199, 243, 0.15);
  color: #00c7f3;
}

.badge--margin-mode {
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.5);
}

/* ── Prices row ── */
.pt-prices-row {
  display: flex;
  align-items: stretch;
  gap: 10px;
}

.pt-price-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.pt-price-col--right {
  align-items: flex-end;
}

.pt-price-divider {
  width: 1px;
  background: rgba(255, 255, 255, 0.07);
  align-self: stretch;
}

.pt-price-label {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: rgba(255, 255, 255, 0.28);
}

.pt-price-value {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.75);
  font-variant-numeric: tabular-nums;
}

/* ── Unrealized PnL ── */
.pt-upnl-row {
  padding: 6px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.pt-upnl-block {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.pt-upnl-label {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: rgba(255, 255, 255, 0.28);
}

.pt-upnl-value {
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.pnl--positive {
  color: #26FAB0;
}

.pnl--negative {
  color: #F97066;
}

/* ── Footer row ── */
.pt-footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pt-liq-block {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.pt-liq-label {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: rgba(255, 255, 255, 0.28);
}

.pt-liq-value {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.6);
  font-variant-numeric: tabular-nums;
}

.liq--warn {
  color: #FFA726;
}

.pt-close-btn {
  font-size: 10px !important;
  font-weight: 700 !important;
  letter-spacing: 0.06em !important;
  text-transform: uppercase !important;
  height: 26px !important;
  padding: 0 12px !important;
  border-radius: 6px !important;
  background: rgba(249, 112, 102, 0.14) !important;
  color: #F97066 !important;
  border: 1px solid rgba(249, 112, 102, 0.25) !important;
  transition: background 0.15s ease !important;
}

.pt-close-btn:hover {
  background: rgba(249, 112, 102, 0.24) !important;
}
</style>
