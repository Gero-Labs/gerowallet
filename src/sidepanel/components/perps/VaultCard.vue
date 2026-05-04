<template>
  <div class="vault-card" @click="$emit('select', vault.id)">
    <!-- Header: name + badges -->
    <div class="vault-card__header">
      <div class="vault-card__name-row">
        <span class="vault-card__name">{{ vault.name }}</span>
        <v-icon v-if="vault.is_verified" size="14" color="#00c7f3" class="ml-1">mdi-check-decagram</v-icon>
      </div>
      <v-chip
        x-small
        :class="['vault-type-chip', vault.type === 'protocol' ? 'chip--protocol' : 'chip--user']"
        label
      >
        {{ vault.type === 'protocol' ? $t('vaults.typeProtocol') : $t('vaults.typeUser') }}
      </v-chip>
    </div>

    <!-- Primary metrics: TVL | APR | 30d PnL -->
    <div class="vault-card__metrics-row">
      <div class="vault-metric">
        <span class="vault-metric__label">{{ $t('vaults.tvl') }}</span>
        <span class="vault-metric__value">{{ formatTvl(vault.tvl) }}</span>
      </div>
      <div class="vault-metric__divider" />
      <div class="vault-metric">
        <span class="vault-metric__label">{{ $t('vaults.apr') }}</span>
        <span class="vault-metric__value vault-metric__value--cyan">{{ formatApr(vault.apr) }}</span>
      </div>
      <div class="vault-metric__divider" />
      <div class="vault-metric">
        <span class="vault-metric__label">{{ $t('vaults.pnl30d') }}</span>
        <span :class="['vault-metric__value', pnlClass(vault.pnl)]">{{ formatPnl(vault.pnl) }}</span>
      </div>
    </div>

    <!-- Secondary metrics: Sharpe | Max DD | Depositors -->
    <div class="vault-card__secondary-row">
      <div class="vault-secondary">
        <span class="vault-secondary__label">{{ $t('vaults.sharpe') }}</span>
        <span class="vault-secondary__value">{{ formatSharpe(vault.sharpe_ratio) }}</span>
      </div>
      <div class="vault-secondary">
        <span class="vault-secondary__label">{{ $t('vaults.maxDrawdown') }}</span>
        <span class="vault-secondary__value vault-secondary__value--red">{{ formatDrawdown(vault.max_drawdown) }}</span>
      </div>
      <div class="vault-secondary">
        <span class="vault-secondary__label">{{ $t('vaults.depositors') }}</span>
        <span class="vault-secondary__value">{{ vault.depositor_count }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { VaultInfo } from '@/api/strike-v2.types';

// ── Props & Emits ─────────────────────────────────────────────────────────────
defineProps<{
  vault: VaultInfo;
}>();

defineEmits<{
  (e: 'select', vaultId: string): void;
}>();

// ── Format Helpers ────────────────────────────────────────────────────────────

function formatTvl(raw: string): string {
  const n = parseFloat(raw);
  if (isNaN(n)) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatApr(raw: string): string {
  const n = parseFloat(raw);
  if (isNaN(n)) return '0.0%';
  return `${n.toFixed(1)}%`;
}

function formatPnl(raw: string): string {
  const n = parseFloat(raw);
  if (isNaN(n)) return '$0';
  const abs = Math.abs(n);
  const prefix = n >= 0 ? '+$' : '-$';
  if (abs >= 1_000_000) return `${prefix}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${prefix}${(abs / 1_000).toFixed(1)}K`;
  return `${prefix}${abs.toFixed(2)}`;
}

function pnlClass(raw: string): string {
  const n = parseFloat(raw);
  if (isNaN(n) || n === 0) return '';
  return n > 0 ? 'vault-metric__value--green' : 'vault-metric__value--red';
}

function formatSharpe(raw: string): string {
  const n = parseFloat(raw);
  if (isNaN(n)) return '0.00';
  return n.toFixed(2);
}

function formatDrawdown(raw: string): string {
  const n = parseFloat(raw);
  if (isNaN(n)) return '0.0%';
  return `-${Math.abs(n).toFixed(1)}%`;
}
</script>

<style scoped>
/* ── Card ── */
.vault-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 12px 14px;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, transform 0.12s ease;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.vault-card:hover {
  background: rgba(0, 199, 243, 0.05);
  border-color: rgba(0, 199, 243, 0.22);
  transform: translateY(-1px);
}

.vault-card:active {
  transform: translateY(0);
}

/* ── Header ── */
.vault-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.vault-card__name-row {
  display: flex;
  align-items: center;
  min-width: 0;
}

.vault-card__name {
  font-size: 13px;
  font-weight: 700;
  color: #ffffff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vault-type-chip {
  font-size: 9px !important;
  font-weight: 700 !important;
  letter-spacing: 0.05em !important;
  text-transform: uppercase !important;
  height: 18px !important;
  flex-shrink: 0;
}

.chip--protocol {
  background: rgba(0, 199, 243, 0.12) !important;
  color: #00c7f3 !important;
  border: 1px solid rgba(0, 199, 243, 0.25) !important;
}

.chip--user {
  background: rgba(255, 255, 255, 0.06) !important;
  color: rgba(255, 255, 255, 0.5) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
}

/* ── Primary Metrics Row ── */
.vault-card__metrics-row {
  display: flex;
  align-items: center;
  gap: 0;
  margin-bottom: 8px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 8px;
  padding: 8px 10px;
}

.vault-metric {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.vault-metric__divider {
  width: 1px;
  height: 24px;
  background: rgba(255, 255, 255, 0.07);
}

.vault-metric__label {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
}

.vault-metric__value {
  font-size: 12px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);
}

.vault-metric__value--cyan   { color: #00c7f3; }
.vault-metric__value--green  { color: #26FAB0; }
.vault-metric__value--red    { color: #F97066; }

/* ── Secondary Row ── */
.vault-card__secondary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.vault-secondary {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.vault-secondary__label {
  font-size: 9px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.25);
}

.vault-secondary__value {
  font-size: 11px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.6);
}

.vault-secondary__value--red { color: #F97066; }
</style>
