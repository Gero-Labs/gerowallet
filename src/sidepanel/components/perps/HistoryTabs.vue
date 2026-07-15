<template>
  <div class="history-tabs">
    <v-tabs
      v-model="activeTab"
      background-color="transparent"
      :slider-color="primaryColor"
      dense
      class="ht-tabs"
      @change="onTabChange"
    >
      <v-tab class="ht-tab">{{ $t('perpetuals.fills') }}</v-tab>
      <v-tab class="ht-tab">{{ $t('perpetuals.funding') }}</v-tab>
      <v-tab class="ht-tab">{{ $t('perpetuals.transactions') }}</v-tab>
    </v-tabs>

    <v-tabs-items v-model="activeTab" class="ht-items">

      <!-- ── FILLS TAB ──────────────────────────────────────────────────── -->
      <v-tab-item>
        <div class="ht-pane">
          <div v-if="loading" class="ht-skeleton">
            <div v-for="i in 4" :key="i" class="ht-skeleton-row" />
          </div>
          <div v-else-if="!fillHistory.length" class="ht-empty">
            <v-icon size="26">mdi-swap-horizontal</v-icon>
            <span>{{ $t('perpetuals.noFills') }}</span>
          </div>
          <div v-else class="ht-list">
            <div
              v-for="fill in fillHistory"
              :key="fill.id"
              class="ht-row"
            >
              <div class="ht-row-main">
                <div class="ht-row-left">
                  <span class="ht-symbol">{{ fill.symbol }}</span>
                  <span
                    class="ht-side-badge"
                    :class="fill.side === 'buy' ? 'badge--buy' : 'badge--sell'"
                  >
                    {{ fill.side === 'buy' ? $t('perpetuals.buy') : $t('perpetuals.sell') }}
                  </span>
                  <span
                    v-if="fill.auto_close_type"
                    class="ht-auto-close-chip"
                    :class="autoCloseClass(fill.auto_close_type)"
                  >
                    {{ formatAutoClose(fill.auto_close_type) }}
                  </span>
                </div>
                <span class="ht-time">{{ formatTime(fill.time) }}</span>
              </div>
              <div class="ht-row-details">
                <div class="ht-detail">
                  <span class="ht-detail-label">{{ $t('perpetuals.price') }}</span>
                  <span class="ht-detail-value">${{ formatNum(fill.price) }}</span>
                </div>
                <div class="ht-detail">
                  <span class="ht-detail-label">{{ $t('perpetuals.qty') }}</span>
                  <span class="ht-detail-value">{{ formatNum(fill.qty) }}</span>
                </div>
                <div class="ht-detail">
                  <span class="ht-detail-label">{{ $t('perpetuals.fee') }}</span>
                  <span class="ht-detail-value">{{ formatNum(fill.commission) }} {{ fill.commission_asset }}</span>
                </div>
                <div class="ht-detail ht-detail--right">
                  <span class="ht-detail-label">{{ $t('perpetuals.realizedPnl') }}</span>
                  <span class="ht-detail-value" :class="pnlClass(fill.realized_pnl)">
                    {{ formatPnl(fill.realized_pnl) }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </v-tab-item>

      <!-- ── FUNDING TAB ─────────────────────────────────────────────────── -->
      <v-tab-item>
        <div class="ht-pane">
          <!-- Running total -->
          <div v-if="fundingHistory.length" class="ht-funding-total">
            <span class="ht-funding-total-label">{{ $t('perpetuals.totalFunding') }}</span>
            <span class="ht-funding-total-value" :class="pnlClass(fundingTotal)">
              {{ formatPnl(fundingTotal) }}
            </span>
          </div>

          <div v-if="loading" class="ht-skeleton">
            <div v-for="i in 4" :key="i" class="ht-skeleton-row" />
          </div>
          <div v-else-if="!fundingHistory.length" class="ht-empty">
            <v-icon size="26">mdi-currency-usd</v-icon>
            <span>{{ $t('perpetuals.noFunding') }}</span>
          </div>
          <div v-else class="ht-list">
            <div
              v-for="item in fundingHistory"
              :key="item.id"
              class="ht-row ht-row--simple"
            >
              <div class="ht-row-left">
                <span class="ht-symbol">{{ item.symbol }}</span>
                <span class="ht-asset-badge">{{ item.asset }}</span>
              </div>
              <div class="ht-row-right">
                <span class="ht-funding-income" :class="pnlClass(item.income)">
                  {{ formatPnl(item.income) }}
                </span>
                <span class="ht-time">{{ formatTime(item.time) }}</span>
              </div>
            </div>
          </div>
        </div>
      </v-tab-item>

      <!-- ── TRANSACTIONS TAB ───────────────────────────────────────────── -->
      <v-tab-item>
        <div class="ht-pane">
          <div v-if="loading" class="ht-skeleton">
            <div v-for="i in 4" :key="i" class="ht-skeleton-row" />
          </div>
          <div v-else-if="!transactionHistory.length" class="ht-empty">
            <v-icon size="26">mdi-bank-outline</v-icon>
            <span>{{ $t('perpetuals.noTransactions') }}</span>
          </div>
          <div v-else class="ht-list">
            <div
              v-for="tx in transactionHistory"
              :key="tx.id"
              class="ht-row ht-row--simple"
            >
              <div class="ht-row-left">
                <span class="ht-type-badge" :class="txTypeClass(tx.type)">
                  {{ formatTxType(tx.type) }}
                </span>
                <span class="ht-asset-badge">{{ tx.asset }}</span>
              </div>
              <div class="ht-row-right">
                <span class="ht-tx-amount" :class="txAmountClass(tx.type)">
                  {{ formatTxAmount(tx.type, tx.amount) }}
                </span>
                <span class="ht-status-chip" :class="txStatusClass(tx.status)">
                  {{ formatTxStatus(tx.status) }}
                </span>
                <span class="ht-time">{{ formatTime(tx.time) }}</span>
              </div>
            </div>
          </div>
        </div>
      </v-tab-item>

    </v-tabs-items>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useStrikeHistory } from '@/modules/market/composables/useStrikeHistory';
import type { TransactionType, TransactionStatus } from '@/api/strike-v2.types';
import { useChainContext } from '../../composables/useChainContext';

const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

const activeTab = ref(0);
const loadedTabs = ref(new Set<number>([0]));

const {
  fillHistory,
  fundingHistory,
  transactionHistory,
  loading,
  loadFillHistory,
  loadFundingHistory,
  loadTransactionHistory,
} = useStrikeHistory();

// Load fills immediately
loadFillHistory();

function onTabChange(tab: number) {
  if (loadedTabs.value.has(tab)) return;
  loadedTabs.value.add(tab);
  if (tab === 1) loadFundingHistory();
  if (tab === 2) loadTransactionHistory();
}

// ── Funding total ────────────────────────────────────────────────────────────

const fundingTotal = computed((): string => {
  if (!fundingHistory.value.length) return '0';
  const sum = fundingHistory.value.reduce((acc, item) => {
    return acc + parseFloat(item.income ?? '0');
  }, 0);
  return sum.toFixed(4);
});

// ── Formatters ───────────────────────────────────────────────────────────────

function formatNum(val: string | null | undefined): string {
  if (!val) return '0';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function formatPnl(val: string | null | undefined): string {
  if (!val) return '$0.00';
  const n = parseFloat(String(val));
  if (isNaN(n)) return '—';
  const prefix = n >= 0 ? '+$' : '-$';
  return prefix + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function pnlClass(val: string | null | undefined): string {
  if (!val) return '';
  const n = parseFloat(String(val));
  if (n > 0) return 'pnl--positive';
  if (n < 0) return 'pnl--negative';
  return '';
}

function formatTime(ts: number | string): string {
  const ms = typeof ts === 'string' ? parseInt(ts) : ts;
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatAutoClose(type: string): string {
  const map: Record<string, string> = {
    liquidation: 'LIQ',
    adl: 'ADL',
    bankrupt: 'BKR',
  };
  return map[type.toLowerCase()] ?? type.toUpperCase();
}

function autoCloseClass(type: string): string {
  const t = type.toLowerCase();
  if (t === 'liquidation') return 'ac--liquidation';
  if (t === 'adl') return 'ac--adl';
  if (t === 'bankrupt') return 'ac--bankrupt';
  return '';
}

function formatTxType(type: TransactionType): string {
  const map: Record<string, string> = {
    deposit: 'Deposit',
    withdraw: 'Withdraw',
    fee: 'Fee',
    realized_pnl: 'PnL',
    liquidation: 'Liq',
  };
  return map[type] ?? type;
}

function txTypeClass(type: TransactionType): string {
  const map: Record<TransactionType, string> = {
    deposit: 'tt--deposit',
    withdraw: 'tt--withdraw',
    fee: 'tt--fee',
    realized_pnl: 'tt--pnl',
    liquidation: 'tt--liquidation',
  };
  return map[type] ?? '';
}

function formatTxAmount(type: TransactionType, amount: string): string {
  const n = parseFloat(amount ?? '0');
  if (isNaN(n)) return '—';
  const isPositive = type === 'deposit' || (type === 'realized_pnl' && n >= 0);
  const prefix = isPositive ? '+$' : '-$';
  return prefix + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function txAmountClass(type: TransactionType): string {
  if (type === 'deposit') return 'pnl--positive';
  if (type === 'withdraw' || type === 'fee' || type === 'liquidation') return 'pnl--negative';
  return '';
}

function formatTxStatus(status: TransactionStatus): string {
  const map: Record<string, string> = {
    completed: 'Done',
    settled: 'Settled',
    pending: 'Pending',
    pending_settlement: 'Settling',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
  return map[status] ?? status;
}

function txStatusClass(status: TransactionStatus): string {
  const map: Record<string, string> = {
    completed: 'st--done',
    settled: 'st--done',
    pending: 'st--pending',
    pending_settlement: 'st--pending',
    failed: 'st--failed',
    cancelled: 'st--failed',
  };
  return map[status] ?? '';
}
</script>

<style scoped>
.history-tabs {
  display: flex;
  flex-direction: column;
}

/* ── Tabs ── */
.ht-tabs {
  border-bottom: 1px solid var(--g-hairline-1);
}

.ht-tab {
  font-size: 11px !important;
  font-weight: 700 !important;
  letter-spacing: 0.08em !important;
  text-transform: uppercase !important;
  color: var(--g-text-3) !important;
  min-width: 0 !important;
  padding: 0 12px !important;
}

.ht-tab.v-tab--active {
  color: var(--g-text-1) !important;
}

.ht-items {
  background: transparent !important;
}

/* ── Pane ── */
.ht-pane {
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ── Skeleton ── */
.ht-skeleton {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ht-skeleton-row {
  height: 52px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.9; }
}

/* ── Empty ── */
.ht-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  gap: 8px;
  color: var(--g-text-3);
  font-size: 12px;
}

/* ── List ── */
.ht-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ── Rows ── */
.ht-row {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.ht-row--simple {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.ht-row-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ht-row-left {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.ht-row-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.ht-row-details {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 4px;
}

/* ── Shared elements ── */
.ht-symbol {
  font-size: 12px;
  font-weight: 700;
  color: var(--g-text-2);
}

.ht-time {
  font-size: 11px;
  color: var(--g-text-3);
  white-space: nowrap;
}

/* ── Side badge ── */
.ht-side-badge {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 1px 5px;
  border-radius: 4px;
  text-transform: uppercase;
}

.badge--buy {
  background: var(--g-success-fill);
  color: var(--g-success);
}

.badge--sell {
  background: var(--g-error-fill);
  color: var(--g-error);
}

/* ── Auto-close chip ── */
.ht-auto-close-chip {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  padding: 1px 5px;
  border-radius: 4px;
  text-transform: uppercase;
}

.ac--liquidation {
  background: var(--g-warning-fill);
  color: var(--g-warning);
}

.ac--adl {
  background: var(--g-warning-fill);
  color: var(--g-warning);
}

.ac--bankrupt {
  background: var(--g-error-fill);
  color: var(--g-error);
}

/* ── Detail cells ── */
.ht-detail {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ht-detail--right {
  align-items: flex-end;
}

.ht-detail-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--g-text-3);
}

.ht-detail-value {
  font-size: 11px;
  font-weight: 600;
  color: var(--g-text-2);
  font-variant-numeric: tabular-nums;
}

/* ── Funding total ── */
.ht-funding-total {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: var(--g-hairline-1);
  border-radius: var(--g-r-control);
  border: 1px solid var(--g-hairline-1);
  margin-bottom: 2px;
}

.ht-funding-total-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--g-text-3);
}

.ht-funding-total-value {
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* ── Funding income ── */
.ht-funding-income {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* ── Asset badge ── */
.ht-asset-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--g-text-3);
  background: var(--g-hairline-1);
  padding: 1px 5px;
  border-radius: 4px;
}

/* ── Tx type badge ── */
.ht-type-badge {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.tt--deposit {
  background: var(--g-success-fill);
  color: var(--g-success);
}

.tt--withdraw {
  background: color-mix(in srgb, var(--g-accent) 12%, transparent);
  color: var(--g-accent);
}

.tt--fee {
  background: var(--g-hairline-1);
  color: var(--g-text-3);
}

.tt--pnl {
  background: var(--g-hairline-1);
  color: var(--g-text-3);
}

.tt--liquidation {
  background: var(--g-error-fill);
  color: var(--g-error);
}

/* ── Tx amount ── */
.ht-tx-amount {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* ── Tx status chip ── */
.ht-status-chip {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 1px 5px;
  border-radius: 4px;
  text-transform: uppercase;
}

.st--done {
  background: var(--g-success-fill);
  color: var(--g-success);
}

.st--pending {
  background: var(--g-warning-fill);
  color: var(--g-warning);
}

.st--failed {
  background: var(--g-error-fill);
  color: var(--g-error);
}

/* ── PnL colors (shared) ── */
.pnl--positive {
  color: var(--g-success);
}

.pnl--negative {
  color: var(--g-error);
}
</style>
