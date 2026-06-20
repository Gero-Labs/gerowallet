<template>
  <div class="account-panel">
    <!-- Wallet Balance -->
    <div class="ap-balance-section">
      <div class="ap-balance-label">{{ $t('perpetuals.walletBalance') }}</div>
      <div class="ap-balance-value">
        <span v-if="walletBalance !== null">${{ formatUsd(walletBalance) }}</span>
        <span v-else class="ap-placeholder">—</span>
      </div>
    </div>

    <!-- 3-col stats grid -->
    <div class="ap-stats-grid">
      <div class="ap-stat">
        <div class="ap-stat-label">{{ $t('perpetuals.available') }}</div>
        <div class="ap-stat-value">
          <span v-if="availableBalance !== null">${{ formatUsd(availableBalance) }}</span>
          <span v-else class="ap-placeholder">—</span>
        </div>
      </div>
      <div class="ap-stat ap-stat--center">
        <div class="ap-stat-label">{{ $t('perpetuals.margin') }}</div>
        <div class="ap-stat-value">
          <span v-if="totalMargin !== null">${{ formatUsd(totalMargin) }}</span>
          <span v-else class="ap-placeholder">—</span>
        </div>
      </div>
      <div class="ap-stat ap-stat--right">
        <div class="ap-stat-label">{{ $t('perpetuals.unrealizedPnl') }}</div>
        <div class="ap-stat-value" :class="pnlClass">
          <span v-if="unrealizedPnl !== null">{{ formatPnl(unrealizedPnl) }}</span>
          <span v-else class="ap-placeholder">—</span>
        </div>
      </div>
    </div>

    <!-- Margin ratio bar -->
    <div class="ap-margin-section">
      <div class="ap-margin-header">
        <span class="ap-margin-label">{{ $t('perpetuals.marginRatio') }}</span>
        <span class="ap-margin-badge" :class="riskBadgeClass">{{ riskLabel }}</span>
        <span class="ap-margin-pct">{{ marginRatio.toFixed(1) }}%</span>
      </div>
      <div class="ap-progress-track">
        <div
          class="ap-progress-fill"
          :class="riskFillClass"
          :style="{ width: Math.min(marginRatio, 100) + '%' }"
        />
      </div>
    </div>

    <!-- Action buttons -->
    <div class="ap-actions">
      <v-btn
        depressed
        small
        class="ap-btn ap-btn--deposit"
        @click="$emit('deposit')"
      >
        <v-icon left size="14">mdi-arrow-down-circle-outline</v-icon>
        {{ $t('perpetuals.deposit') }}
      </v-btn>
      <v-btn
        depressed
        small
        outlined
        class="ap-btn ap-btn--withdraw"
        @click="$emit('withdraw')"
      >
        <v-icon left size="14">mdi-arrow-up-circle-outline</v-icon>
        {{ $t('perpetuals.withdraw') }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useStrikeAccount } from '@/modules/market/composables/useStrikeAccount';

defineEmits<{
  (e: 'deposit'): void;
  (e: 'withdraw'): void;
}>();

const {
  walletBalance,
  availableBalance,
  unrealizedPnl,
  totalMargin,
  marginRatio,
  marginRiskLevel,
} = useStrikeAccount();

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatUsd(val: string | number | null): string {
  if (val === null || val === undefined) return '—';
  const n = parseFloat(String(val));
  if (isNaN(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPnl(val: string | number | null): string {
  if (val === null || val === undefined) return '—';
  const n = parseFloat(String(val));
  if (isNaN(n)) return '—';
  const prefix = n >= 0 ? '+$' : '-$';
  return prefix + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Computed ─────────────────────────────────────────────────────────────────

const pnlClass = computed(() => {
  if (unrealizedPnl.value === null) return '';
  const n = parseFloat(String(unrealizedPnl.value));
  if (n > 0) return 'pnl--positive';
  if (n < 0) return 'pnl--negative';
  return '';
});

const riskLabel = computed((): string => {
  switch (marginRiskLevel.value) {
    case 'danger':
    case 'liquidation':
      return 'Reduce Only';
    case 'warning':
      return 'Margin Call';
    default:
      return 'Healthy';
  }
});

const riskBadgeClass = computed((): string => {
  switch (marginRiskLevel.value) {
    case 'danger':
    case 'liquidation':
      return 'badge--danger';
    case 'warning':
      return 'badge--warning';
    default:
      return 'badge--healthy';
  }
});

const riskFillClass = computed((): string => {
  switch (marginRiskLevel.value) {
    case 'danger':
    case 'liquidation':
      return 'fill--danger';
    case 'warning':
      return 'fill--warning';
    default:
      return 'fill--healthy';
  }
});
</script>

<style scoped>
.account-panel {
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 14px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── Balance ── */
.ap-balance-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ap-balance-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.35);
}

.ap-balance-value {
  font-size: 24px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.92);
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.ap-placeholder {
  color: rgba(255, 255, 255, 0.25);
}

/* ── Stats Grid ── */
.ap-stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
}

.ap-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ap-stat--center {
  align-items: center;
}

.ap-stat--right {
  align-items: flex-end;
}

.ap-stat-label {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.3);
}

.ap-stat-value {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.75);
}

.pnl--positive {
  color: #26FAB0;
}

.pnl--negative {
  color: #F97066;
}

/* ── Margin ratio ── */
.ap-margin-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ap-margin-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ap-margin-label {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.3);
  flex: 1;
}

.ap-margin-badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 1px 6px;
  border-radius: 4px;
}

.badge--healthy {
  background: rgba(38, 250, 176, 0.15);
  color: #26FAB0;
}

.badge--warning {
  background: rgba(255, 167, 38, 0.15);
  color: #FFA726;
}

.badge--danger {
  background: rgba(249, 112, 102, 0.15);
  color: #F97066;
}

.ap-margin-pct {
  font-size: 10px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.55);
  min-width: 36px;
  text-align: right;
}

.ap-progress-track {
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.ap-progress-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s ease, background-color 0.3s ease;
}

.fill--healthy {
  background: #26FAB0;
}

.fill--warning {
  background: #FFA726;
}

.fill--danger {
  background: #F97066;
}

/* ── Actions ── */
.ap-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.ap-btn {
  font-size: 11px !important;
  font-weight: 700 !important;
  letter-spacing: 0.06em !important;
  text-transform: uppercase !important;
  border-radius: 8px !important;
  height: 32px !important;
}

.ap-btn--deposit {
  background: var(--chain-primary) !important;
  color: #000 !important;
}

.ap-btn--withdraw {
  border-color: rgba(255, 255, 255, 0.18) !important;
  color: rgba(255, 255, 255, 0.75) !important;
}
</style>
