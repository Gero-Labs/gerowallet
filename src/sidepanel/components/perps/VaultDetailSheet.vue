<template>
  <BottomSheet
    :value="value"
    height="85%"
    :show-handle="true"
    :draggable="true"
    @input="$emit('input', $event)"
  >
    <div class="vds-content">

      <!-- ── Loading State ── -->
      <div v-if="loadingDetail" class="vds-loading">
        <v-progress-circular indeterminate size="28" width="2" :color="primaryColor" />
      </div>

      <template v-else-if="vault">

        <!-- ── Section 1: Header ── -->
        <div class="vds-header">
          <div class="vds-header__title-row">
            <span class="vds-vault-name">{{ vault.name }}</span>
            <div class="vds-header__badges">
              <v-chip
                x-small
                :class="['vds-status-chip', `vds-status-chip--${vault.status}`]"
                label
              >
                {{ $t(`vaults.status.${vault.status}`) }}
              </v-chip>
              <v-icon v-if="vault.is_verified" size="16" :color="primaryColor" class="ml-1">mdi-check-decagram</v-icon>
            </div>
          </div>
          <p class="vds-description">{{ vault.description }}</p>
          <div class="vds-leader-row">
            <v-icon size="11" color="rgba(255,255,255,0.3)" class="mr-1">mdi-account-outline</v-icon>
            <span class="vds-leader-addr">{{ truncateAddr(vault.leader_account_id) }}</span>
          </div>
        </div>

        <!-- ── Section 2: Performance Grid ── -->
        <div class="vds-section-label">{{ $t('vaults.performance') }}</div>
        <div class="vds-perf-grid">
          <div class="vds-perf-cell">
            <span class="vds-perf-cell__label">{{ $t('vaults.tvl') }}</span>
            <span class="vds-perf-cell__value">{{ formatTvl(vault.tvl) }}</span>
          </div>
          <div class="vds-perf-cell">
            <span class="vds-perf-cell__label">{{ $t('vaults.apr') }}</span>
            <span class="vds-perf-cell__value vds-perf-cell__value--cyan">{{ formatApr(vault.apr) }}</span>
          </div>
          <div class="vds-perf-cell">
            <span class="vds-perf-cell__label">{{ $t('vaults.sharpe') }}</span>
            <span class="vds-perf-cell__value">{{ formatSharpe(vault.sharpe_ratio) }}</span>
          </div>
          <div class="vds-perf-cell">
            <span class="vds-perf-cell__label">{{ $t('vaults.maxDrawdown') }}</span>
            <span class="vds-perf-cell__value vds-perf-cell__value--red">{{ formatDrawdown(vault.max_drawdown) }}</span>
          </div>
          <div class="vds-perf-cell">
            <span class="vds-perf-cell__label">{{ $t('vaults.depositors') }}</span>
            <span class="vds-perf-cell__value">{{ vault.depositor_count }}</span>
          </div>
          <div class="vds-perf-cell">
            <span class="vds-perf-cell__label">{{ $t('vaults.pnl') }}</span>
            <span :class="['vds-perf-cell__value', pnlClass(vault.pnl)]">{{ formatPnl(vault.pnl) }}</span>
          </div>
        </div>

        <!-- ── Section 3: Chart ── -->
        <div class="vds-section-label">{{ $t('vaults.equityCurve') }}</div>
        <VaultPortfolioChart
          :history="chartHistory"
          :loading="loadingPortfolio"
          @period-change="onPeriodChange($event)"
        />

        <!-- ── Section 4: Your Position ── -->
        <template v-if="userPosition">
          <div class="vds-section-label mt-3">{{ $t('vaults.yourPosition') }}</div>
          <div class="vds-position-card">
            <div class="vds-pos-row">
              <span class="vds-pos-label">{{ $t('vaults.shares') }}</span>
              <span class="vds-pos-value">{{ formatDecimal(userPosition.shares) }}</span>
            </div>
            <div class="vds-pos-row">
              <span class="vds-pos-label">{{ $t('vaults.deposited') }}</span>
              <span class="vds-pos-value">{{ formatTvl(userPosition.deposited) }}</span>
            </div>
            <div class="vds-pos-row">
              <span class="vds-pos-label">{{ $t('vaults.currentValue') }}</span>
              <span class="vds-pos-value vds-pos-value--cyan">{{ formatTvl(userPosition.current_value) }}</span>
            </div>
            <div class="vds-pos-row">
              <span class="vds-pos-label">{{ $t('vaults.pnl') }}</span>
              <span :class="['vds-pos-value', pnlClass(userPosition.pnl)]">{{ formatPnl(userPosition.pnl) }}</span>
            </div>
          </div>
        </template>

        <!-- ── Section 5: Top Depositors ── -->
        <template v-if="depositors.length">
          <div class="vds-section-label mt-3">{{ $t('vaults.topDepositors') }}</div>
          <div class="vds-depositors">
            <div
              v-for="(d, i) in depositors.slice(0, 5)"
              :key="d.account_id"
              class="vds-depositor-row"
            >
              <span class="vds-depositor-rank">{{ i + 1 }}</span>
              <span class="vds-depositor-addr">{{ truncateAddr(d.account_id) }}</span>
              <div class="vds-depositor-stats">
                <span class="vds-depositor-equity">{{ formatTvl(d.equity) }}</span>
                <span class="vds-depositor-share">{{ parseFloat(d.share_percentage).toFixed(1) }}%</span>
                <span :class="['vds-depositor-pnl', pnlClass(d.pnl)]">{{ formatPnl(d.pnl) }}</span>
              </div>
            </div>
          </div>
        </template>

        <!-- ── Section 6: Actions ── -->
        <div class="vds-actions">
          <v-btn
            depressed
            class="vds-btn vds-btn--deposit"
            @click="$emit('deposit')"
          >
            <v-icon size="14" class="mr-1">mdi-bank-transfer-in</v-icon>
            {{ $t('vaults.deposit') }}
          </v-btn>
          <v-btn
            depressed
            class="vds-btn vds-btn--withdraw"
            @click="$emit('withdraw')"
          >
            <v-icon size="14" class="mr-1">mdi-bank-transfer-out</v-icon>
            {{ $t('vaults.withdraw') }}
          </v-btn>
        </div>

      </template>

      <!-- ── Error State ── -->
      <div v-else class="vds-error">
        <v-icon size="24" color="rgba(249,112,102,0.5)">mdi-alert-circle-outline</v-icon>
        <span class="vds-error__text">{{ $t('vaults.loadError') }}</span>
      </div>

    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import BottomSheet from '@/sidepanel/components/BottomSheet.vue';
import VaultPortfolioChart from './VaultPortfolioChart.vue';
import { useStrikeVaults } from '@/modules/market/composables/useStrikeVaults';
import { useChainContext } from '../../composables/useChainContext';
import type { VaultInfo, VaultDepositor, UserVaultPosition, VaultPeriod } from '@/api/strike-v2.types';

const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

// ── Props & Emits ─────────────────────────────────────────────────────────────
const props = defineProps<{
  vaultId: string;
  value: boolean;
}>();

defineEmits<{
  (e: 'input', value: boolean): void;
  (e: 'deposit'): void;
  (e: 'withdraw'): void;
}>();

// ── Composable ────────────────────────────────────────────────────────────────
const { getVaultDetail, getVaultPortfolio, getVaultDepositors, getUserPosition } = useStrikeVaults();

// ── State ─────────────────────────────────────────────────────────────────────
const vault = ref<VaultInfo | null>(null);
const depositors = ref<VaultDepositor[]>([]);
const userPosition = ref<UserVaultPosition | null>(null);
const chartHistory = ref<Array<[number, number, number, number]>>([]);
const loadingDetail = ref(false);
const loadingPortfolio = ref(false);
const activePeriod = ref<VaultPeriod>('30d');

// ── Methods ───────────────────────────────────────────────────────────────────
async function loadAll() {
  if (!props.vaultId) return;
  loadingDetail.value = true;

  try {
    const [detail, deps, pos] = await Promise.all([
      getVaultDetail(props.vaultId),
      getVaultDepositors(props.vaultId, { limit: 5 }),
      getUserPosition(props.vaultId).catch(() => null),
    ]);
    vault.value = detail;
    depositors.value = deps;
    userPosition.value = pos;
  } finally {
    loadingDetail.value = false;
  }

  loadChartData(activePeriod.value);
}

async function loadChartData(period: VaultPeriod) {
  if (!props.vaultId) return;
  loadingPortfolio.value = true;
  try {
    const portfolio = await getVaultPortfolio(props.vaultId, period);
    if (portfolio?.history) {
      chartHistory.value = portfolio.history.map((h) => [
        h.timestamp,
        parseFloat(h.tvl),
        parseFloat(h.pnl),
        0,
      ]) as Array<[number, number, number, number]>;
    }
  } finally {
    loadingPortfolio.value = false;
  }
}

function onPeriodChange(period: VaultPeriod) {
  activePeriod.value = period;
  loadChartData(period);
}

// ── Watchers ──────────────────────────────────────────────────────────────────
watch(() => [props.value, props.vaultId] as const, ([open, id]) => {
  if (open && id) loadAll();
}, { immediate: true });

// ── Format Helpers ────────────────────────────────────────────────────────────
function formatTvl(raw: string | number): string {
  const n = typeof raw === 'number' ? raw : parseFloat(raw);
  if (isNaN(n)) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatApr(raw: string): string {
  const n = parseFloat(raw);
  return isNaN(n) ? '0.0%' : `${n.toFixed(1)}%`;
}

function formatSharpe(raw: string): string {
  const n = parseFloat(raw);
  return isNaN(n) ? '0.00' : n.toFixed(2);
}

function formatDrawdown(raw: string): string {
  const n = parseFloat(raw);
  return isNaN(n) ? '0.0%' : `-${Math.abs(n).toFixed(1)}%`;
}

function formatPnl(raw: string | number): string {
  const n = typeof raw === 'number' ? raw : parseFloat(raw as string);
  if (isNaN(n)) return '$0';
  const abs = Math.abs(n);
  const prefix = n >= 0 ? '+$' : '-$';
  if (abs >= 1_000_000) return `${prefix}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${prefix}${(abs / 1_000).toFixed(1)}K`;
  return `${prefix}${abs.toFixed(2)}`;
}

function formatDecimal(raw: string): string {
  const n = parseFloat(raw);
  return isNaN(n) ? '0' : n.toFixed(4);
}

function pnlClass(raw: string | number): string {
  const n = typeof raw === 'number' ? raw : parseFloat(raw as string);
  if (isNaN(n) || n === 0) return '';
  return n > 0 ? 'color--green' : 'color--red';
}

function truncateAddr(addr: string): string {
  if (!addr || addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}
</script>

<style scoped>
/* ── Content ── */
.vds-content {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-bottom: 16px;
}

/* ── Loading / Error ── */
.vds-loading,
.vds-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 160px;
}

.vds-error__text {
  font-size: 12px;
  color: rgba(249, 112, 102, 0.7);
}

/* ── Header ── */
.vds-header {
  margin-bottom: 14px;
}

.vds-header__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.vds-vault-name {
  font-size: 16px;
  font-weight: 800;
  color: #ffffff;
  letter-spacing: -0.01em;
}

.vds-header__badges {
  display: flex;
  align-items: center;
}

.vds-status-chip {
  font-size: 9px !important;
  font-weight: 700 !important;
  letter-spacing: 0.05em !important;
  text-transform: uppercase !important;
  height: 18px !important;
}

.vds-status-chip--active {
  background: rgba(38, 250, 176, 0.12) !important;
  color: #26FAB0 !important;
  border: 1px solid rgba(38, 250, 176, 0.25) !important;
}

.vds-status-chip--paused {
  background: rgba(255, 167, 38, 0.12) !important;
  color: #FFA726 !important;
  border: 1px solid rgba(255, 167, 38, 0.25) !important;
}

.vds-status-chip--closed {
  background: rgba(249, 112, 102, 0.1) !important;
  color: #F97066 !important;
  border: 1px solid rgba(249, 112, 102, 0.22) !important;
}

.vds-description {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  line-height: 1.6;
  margin: 0 0 6px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.vds-leader-row {
  display: flex;
  align-items: center;
}

.vds-leader-addr {
  font-size: 10px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: rgba(255, 255, 255, 0.3);
}

/* ── Section Label ── */
.vds-section-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
  margin-bottom: 8px;
  margin-top: 14px;
}

/* ── Performance Grid ── */
.vds-perf-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.vds-perf-cell {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.vds-perf-cell__label {
  font-size: 9px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.28);
}

.vds-perf-cell__value {
  font-size: 13px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);
}

.vds-perf-cell__value--cyan { color: var(--chain-primary); }
.vds-perf-cell__value--red  { color: #F97066; }

/* ── Position Card ── */
.vds-position-card {
  background: color-mix(in srgb, var(--chain-primary) 4%, transparent);
  border: 1px solid color-mix(in srgb, var(--chain-primary) 12%, transparent);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.vds-pos-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.vds-pos-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.vds-pos-value {
  font-size: 12px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
}

.vds-pos-value--cyan { color: var(--chain-primary); }

/* ── Depositors ── */
.vds-depositors {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.vds-depositor-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.vds-depositor-rank {
  font-size: 10px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.25);
  width: 14px;
  text-align: center;
  flex-shrink: 0;
}

.vds-depositor-addr {
  font-size: 10px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: rgba(255, 255, 255, 0.5);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vds-depositor-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.vds-depositor-equity {
  font-size: 11px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
}

.vds-depositor-share {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
}

.vds-depositor-pnl {
  font-size: 10px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-weight: 600;
}

/* ── Actions ── */
.vds-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.vds-btn {
  flex: 1;
  height: 42px !important;
  border-radius: 10px !important;
  font-size: 13px !important;
  font-weight: 700 !important;
  text-transform: none !important;
  letter-spacing: 0.02em !important;
}

.vds-btn--deposit {
  background: color-mix(in srgb, var(--chain-primary) 12%, transparent) !important;
  color: var(--chain-primary) !important;
  border: 1px solid color-mix(in srgb, var(--chain-primary) 30%, transparent) !important;
}

.vds-btn--deposit:hover {
  background: color-mix(in srgb, var(--chain-primary) 20%, transparent) !important;
}

.vds-btn--withdraw {
  background: rgba(255, 255, 255, 0.05) !important;
  color: rgba(255, 255, 255, 0.6) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
}

.vds-btn--withdraw:hover {
  background: rgba(255, 255, 255, 0.09) !important;
}

/* ── Color Utilities ── */
.color--green { color: #26FAB0; }
.color--red   { color: #F97066; }

.mt-3 { margin-top: 12px; }
</style>
