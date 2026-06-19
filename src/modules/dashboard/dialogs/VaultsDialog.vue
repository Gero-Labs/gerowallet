<template>
  <v-dialog
    :value="visible"
    fullscreen
    transition="dialog-bottom-transition"
    @input="$emit('update:visible', $event)"
  >
    <v-card dark class="vaults-dialog">

      <!-- ── Toolbar ── -->
      <v-toolbar dark flat color="transparent" class="vaults-dialog-toolbar">
        <v-btn icon @click="close()">
          <v-icon>mdi-close</v-icon>
        </v-btn>
        <v-toolbar-title class="vaults-dialog-title">{{ $t('vaults.title') }}</v-toolbar-title>
        <v-spacer />
        <v-text-field
          v-model="searchQuery"
          :placeholder="$t('vaults.searchPlaceholder')"
          prepend-inner-icon="mdi-magnify"
          outlined
          dense
          dark
          hide-details
          clearable
          style="max-width: 240px;"
          class="vaults-dialog-search mr-2"
        />
      </v-toolbar>

      <!-- ── Content ── -->
      <v-card-text class="pa-0 vaults-dialog-body">
        <v-row no-gutters style="height: 100%;">

          <!-- ── Left: Vault List ── -->
          <v-col cols="5" class="vaults-list-col pa-3">

            <!-- My Deposits Summary -->
            <template v-if="userPositions.length > 0">
              <div class="dialog-section-label mb-2">{{ $t('vaults.myDeposits') }}</div>
              <div class="dialog-summary-card mb-3">
                <div class="dialog-summary-stat">
                  <span class="dialog-summary-label">{{ $t('vaults.totalEquity') }}</span>
                  <span class="dialog-summary-value dialog-summary-value--cyan">
                    {{ formatTvl(totalVaultEquity) }}
                  </span>
                </div>
                <div class="dialog-summary-divider" />
                <div class="dialog-summary-stat">
                  <span class="dialog-summary-label">{{ $t('vaults.totalPnl') }}</span>
                  <span :class="['dialog-summary-value', pnlClass(totalVaultPnl)]">
                    {{ formatPnl(totalVaultPnl) }}
                  </span>
                </div>
              </div>
            </template>

            <!-- Filter chips + sort -->
            <div class="dialog-filters-row mb-3">
              <div class="dialog-filter-chips">
                <button
                  v-for="f in filterOptions"
                  :key="f.id"
                  class="dialog-filter-chip"
                  :class="{ 'dialog-filter-chip--active': activeFilter === f.id }"
                  @click="activeFilter = f.id"
                >
                  {{ f.label }}
                </button>
              </div>
              <v-select
                v-model="sortBy"
                :items="sortOptions"
                item-text="label"
                item-value="id"
                outlined
                dense
                dark
                hide-details
                class="dialog-sort-select"
                attach
              />
            </div>

            <!-- Loading -->
            <div v-if="loading && filteredVaults.length === 0" class="text-center py-8">
              <v-progress-circular indeterminate color="#00c7f3" size="28" width="2" />
              <div class="grey--text text-caption mt-2">{{ $t('vaults.loadingVaults') }}</div>
            </div>

            <!-- Empty: no results -->
            <div
              v-else-if="!loading && filteredVaults.length === 0 && (searchQuery || activeFilter !== 'all')"
              class="dialog-empty-state"
            >
              <v-icon size="36" color="rgba(255,255,255,0.08)">mdi-safe-square-outline</v-icon>
              <div class="text-body-2 grey--text mt-2 text-center">{{ $t('vaults.noVaultsFound') }}</div>
              <v-btn x-small text color="#00c7f3" class="mt-2" @click="clearFilters()">
                {{ $t('vaults.clearFilters') }}
              </v-btn>
            </div>

            <!-- Empty: no vaults -->
            <div
              v-else-if="!loading && vaults.length === 0"
              class="dialog-empty-state"
            >
              <v-icon size="36" color="rgba(255,255,255,0.08)">mdi-safe-square-outline</v-icon>
              <div class="text-body-2 grey--text mt-2 text-center">{{ $t('vaults.noVaultsAvailable') }}</div>
            </div>

            <!-- Vault card list -->
            <div v-else class="dialog-vault-list">
              <VaultCard
                v-for="vault in paginatedVaults"
                :key="vault.id"
                :vault="vault"
                :class="{ 'vault-card--selected': selectedVaultId === vault.id }"
                @select="selectVault(vault.id)"
              />
              <div v-if="hasMore" class="text-center mt-3">
                <v-btn x-small text color="#00c7f3" :loading="loading" @click="loadMore()">
                  {{ $t('common.loadMore') }}
                </v-btn>
              </div>
            </div>

          </v-col>

          <!-- ── Right: Vault Detail Inline ── -->
          <v-col cols="7" class="vaults-detail-col pa-3">

            <!-- No vault selected placeholder -->
            <div v-if="!selectedVaultId" class="detail-placeholder">
              <v-icon size="56" color="rgba(255,255,255,0.06)">mdi-safe-square-outline</v-icon>
              <div class="text-body-2 mt-3" style="color: rgba(255,255,255,0.25);">
                {{ $t('vaults.selectAVault') }}
              </div>
            </div>

            <!-- Vault detail inline content -->
            <template v-else>

              <!-- Loading state -->
              <div v-if="loadingDetail" class="detail-loading">
                <v-progress-circular indeterminate size="28" width="2" color="#00c7f3" />
              </div>

              <template v-else-if="detailVault">

                <!-- Header -->
                <div class="detail-header mb-4">
                  <div class="detail-header__title-row">
                    <span class="detail-vault-name">{{ detailVault.name }}</span>
                    <div class="detail-header__badges">
                      <v-chip
                        x-small
                        :class="['detail-status-chip', `detail-status-chip--${detailVault.status}`]"
                        label
                      >
                        {{ $t(`vaults.status.${detailVault.status}`) }}
                      </v-chip>
                      <v-icon v-if="detailVault.is_verified" size="16" color="#00c7f3" class="ml-1">
                        mdi-check-decagram
                      </v-icon>
                    </div>
                  </div>
                  <p class="detail-description">{{ detailVault.description }}</p>
                  <div class="detail-leader-row">
                    <v-icon size="11" color="rgba(255,255,255,0.3)" class="mr-1">mdi-account-outline</v-icon>
                    <span class="detail-leader-addr">{{ truncateAddr(detailVault.leader_account_id) }}</span>
                  </div>
                </div>

                <!-- Performance Grid -->
                <div class="dialog-section-label mb-2">{{ $t('vaults.performance') }}</div>
                <div class="detail-perf-grid mb-4">
                  <div class="detail-perf-cell">
                    <span class="detail-perf-label">{{ $t('vaults.tvl') }}</span>
                    <span class="detail-perf-value">{{ formatTvl(detailVault.tvl) }}</span>
                  </div>
                  <div class="detail-perf-cell">
                    <span class="detail-perf-label">{{ $t('vaults.apr') }}</span>
                    <span class="detail-perf-value detail-perf-value--cyan">{{ formatApr(detailVault.apr) }}</span>
                  </div>
                  <div class="detail-perf-cell">
                    <span class="detail-perf-label">{{ $t('vaults.sharpe') }}</span>
                    <span class="detail-perf-value">{{ formatSharpe(detailVault.sharpe_ratio) }}</span>
                  </div>
                  <div class="detail-perf-cell">
                    <span class="detail-perf-label">{{ $t('vaults.maxDrawdown') }}</span>
                    <span class="detail-perf-value detail-perf-value--red">{{ formatDrawdown(detailVault.max_drawdown) }}</span>
                  </div>
                  <div class="detail-perf-cell">
                    <span class="detail-perf-label">{{ $t('vaults.depositors') }}</span>
                    <span class="detail-perf-value">{{ detailVault.depositor_count }}</span>
                  </div>
                  <div class="detail-perf-cell">
                    <span class="detail-perf-label">{{ $t('vaults.pnl') }}</span>
                    <span :class="['detail-perf-value', pnlClass(detailVault.pnl)]">{{ formatPnl(detailVault.pnl) }}</span>
                  </div>
                </div>

                <!-- Chart -->
                <div class="dialog-section-label mb-2">{{ $t('vaults.equityCurve') }}</div>
                <VaultPortfolioChart
                  :history="chartHistory"
                  :loading="loadingPortfolio"
                  class="mb-4"
                  @period-change="onPeriodChange($event)"
                />

                <!-- Your Position -->
                <template v-if="detailUserPosition">
                  <div class="dialog-section-label mb-2">{{ $t('vaults.yourPosition') }}</div>
                  <div class="detail-position-card mb-4">
                    <div class="detail-pos-row">
                      <span class="detail-pos-label">{{ $t('vaults.shares') }}</span>
                      <span class="detail-pos-value">{{ formatDecimal(detailUserPosition.shares) }}</span>
                    </div>
                    <div class="detail-pos-row">
                      <span class="detail-pos-label">{{ $t('vaults.deposited') }}</span>
                      <span class="detail-pos-value">{{ formatTvl(detailUserPosition.deposited) }}</span>
                    </div>
                    <div class="detail-pos-row">
                      <span class="detail-pos-label">{{ $t('vaults.currentValue') }}</span>
                      <span class="detail-pos-value detail-pos-value--cyan">{{ formatTvl(detailUserPosition.current_value) }}</span>
                    </div>
                    <div class="detail-pos-row">
                      <span class="detail-pos-label">{{ $t('vaults.pnl') }}</span>
                      <span :class="['detail-pos-value', pnlClass(detailUserPosition.pnl)]">{{ formatPnl(detailUserPosition.pnl) }}</span>
                    </div>
                  </div>
                </template>

                <!-- Top Depositors -->
                <template v-if="depositors.length > 0">
                  <div class="dialog-section-label mb-2">{{ $t('vaults.topDepositors') }}</div>
                  <div class="detail-depositors mb-4">
                    <div
                      v-for="(d, i) in depositors.slice(0, 5)"
                      :key="d.account_id"
                      class="detail-depositor-row"
                    >
                      <span class="detail-depositor-rank">{{ i + 1 }}</span>
                      <span class="detail-depositor-addr">{{ truncateAddr(d.account_id) }}</span>
                      <div class="detail-depositor-stats">
                        <span class="detail-depositor-equity">{{ formatTvl(d.equity) }}</span>
                        <span class="detail-depositor-share">{{ parseFloat(d.share_percentage).toFixed(1) }}%</span>
                        <span :class="['detail-depositor-pnl', pnlClass(d.pnl)]">{{ formatPnl(d.pnl) }}</span>
                      </div>
                    </div>
                  </div>
                </template>

                <!-- Actions -->
                <div class="detail-actions">
                  <v-btn depressed class="detail-btn detail-btn--deposit" @click="showDeposit = true">
                    <v-icon size="14" class="mr-1">mdi-bank-transfer-in</v-icon>
                    {{ $t('vaults.deposit') }}
                  </v-btn>
                  <v-btn depressed class="detail-btn detail-btn--withdraw" @click="showWithdraw = true">
                    <v-icon size="14" class="mr-1">mdi-bank-transfer-out</v-icon>
                    {{ $t('vaults.withdraw') }}
                  </v-btn>
                </div>

              </template>

              <!-- Error state -->
              <div v-else class="detail-error">
                <v-icon size="24" color="rgba(249,112,102,0.5)">mdi-alert-circle-outline</v-icon>
                <span class="detail-error__text">{{ $t('vaults.loadError') }}</span>
              </div>

            </template>

          </v-col>
        </v-row>
      </v-card-text>

    </v-card>

    <!-- ── Deposit Sheet ── -->
    <VaultDepositSheet
      v-if="selectedVaultId && showDeposit"
      :vault-id="selectedVaultId"
      :vault-name="detailVault ? detailVault.name : ''"
      :value="showDeposit"
      @input="showDeposit = $event"
    />

    <!-- ── Withdraw Sheet ── -->
    <VaultWithdrawSheet
      v-if="selectedVaultId && showWithdraw"
      :vault-id="selectedVaultId"
      :vault-name="detailVault ? detailVault.name : ''"
      :value="showWithdraw"
      @input="showWithdraw = $event"
    />

  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useStrikeVaults } from '@/modules/market/composables/useStrikeVaults';
import type { VaultInfo, VaultDepositor, UserVaultPosition, VaultPeriod } from '@/api/strike-v2.types';
import VaultCard from '@/sidepanel/components/perps/VaultCard.vue';
import VaultPortfolioChart from '@/sidepanel/components/perps/VaultPortfolioChart.vue';
import VaultDepositSheet from '@/sidepanel/components/perps/VaultDepositSheet.vue';
import VaultWithdrawSheet from '@/sidepanel/components/perps/VaultWithdrawSheet.vue';

// ── Props & Emits ─────────────────────────────────────────────────────────────

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
}>();

// ── Composable ────────────────────────────────────────────────────────────────

const {
  vaults,
  userPositions,
  loading,
  totalVaultEquity,
  totalVaultPnl,
  loadVaults,
  loadUserPositions,
  getVaultDetail,
  getVaultPortfolio,
  getVaultDepositors,
  getUserPosition,
} = useStrikeVaults();

// ── State ─────────────────────────────────────────────────────────────────────

const searchQuery = ref('');
const activeFilter = ref<'all' | 'verified' | 'protocol'>('all');
const sortBy = ref<'tvl' | 'apr' | 'pnl'>('tvl');
const visibleCount = ref(20);
const PAGE_SIZE = 20;

// Detail panel state
const selectedVaultId = ref<string>('');
const detailVault = ref<VaultInfo | null>(null);
const depositors = ref<VaultDepositor[]>([]);
const detailUserPosition = ref<UserVaultPosition | null>(null);
const chartHistory = ref<Array<[number, number, number, number]>>([]);
const loadingDetail = ref(false);
const loadingPortfolio = ref(false);
const activePeriod = ref<VaultPeriod>('30d');

// Sheet state
const showDeposit = ref(false);
const showWithdraw = ref(false);

// ── Filter / Sort Options ─────────────────────────────────────────────────────

const filterOptions = computed(() => [
  { id: 'all' as const, label: 'All' },
  { id: 'verified' as const, label: 'Verified' },
  { id: 'protocol' as const, label: 'Protocol' },
]);

const sortOptions = computed(() => [
  { id: 'tvl' as const, label: 'TVL' },
  { id: 'apr' as const, label: 'APR' },
  { id: 'pnl' as const, label: 'PnL' },
]);

// ── Filtered Vaults ───────────────────────────────────────────────────────────

const filteredVaults = computed(() => {
  let list = [...vaults.value];

  if (activeFilter.value === 'verified') {
    list = list.filter((v) => v.is_verified);
  } else if (activeFilter.value === 'protocol') {
    list = list.filter((v) => v.type === 'protocol');
  }

  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter((v) => v.name.toLowerCase().includes(q));
  }

  list.sort((a, b) => {
    if (sortBy.value === 'tvl') return parseFloat(b.tvl) - parseFloat(a.tvl);
    if (sortBy.value === 'apr') return parseFloat(b.apr) - parseFloat(a.apr);
    if (sortBy.value === 'pnl') return parseFloat(b.pnl) - parseFloat(a.pnl);
    return 0;
  });

  return list;
});

const paginatedVaults = computed(() => filteredVaults.value.slice(0, visibleCount.value));
const hasMore = computed(() => filteredVaults.value.length > visibleCount.value);

// ── Methods ───────────────────────────────────────────────────────────────────

function close() {
  emit('update:visible', false);
}

function clearFilters() {
  searchQuery.value = '';
  activeFilter.value = 'all';
}

function loadMore() {
  visibleCount.value += PAGE_SIZE;
}

async function selectVault(vaultId: string) {
  if (selectedVaultId.value === vaultId) return;
  selectedVaultId.value = vaultId;
  detailVault.value = null;
  depositors.value = [];
  detailUserPosition.value = null;
  chartHistory.value = [];
  await loadDetailData(vaultId);
}

async function loadDetailData(vaultId: string) {
  loadingDetail.value = true;
  try {
    const [detail, deps, pos] = await Promise.all([
      getVaultDetail(vaultId),
      getVaultDepositors(vaultId, { limit: 5 }),
      getUserPosition(vaultId).catch(() => null),
    ]);
    detailVault.value = detail;
    depositors.value = deps;
    detailUserPosition.value = pos;
  } finally {
    loadingDetail.value = false;
  }
  loadChartData(activePeriod.value, vaultId);
}

async function loadChartData(period: VaultPeriod, vaultId?: string) {
  const id = vaultId ?? selectedVaultId.value;
  if (!id) return;
  loadingPortfolio.value = true;
  try {
    const portfolio = await getVaultPortfolio(id, period);
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

watch(() => props.visible, (open) => {
  if (open) {
    loadVaults();
    loadUserPositions();
  }
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(() => {
  if (props.visible) {
    loadVaults();
    loadUserPositions();
  }
});

// ── Format Helpers ─────────────────────────────────────────────────────────────

function formatTvl(raw: string | number): string {
  const n = typeof raw === 'number' ? raw : parseFloat(raw as string);
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
.vaults-dialog {
  background: rgba(10, 12, 16, 0.97) !important;
  overflow: hidden;
}

/* ── Toolbar ── */
.vaults-dialog-toolbar {
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  z-index: 5;
}

.vaults-dialog-title {
  font-size: 15px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: -0.01em;
}

.vaults-dialog-search {
  background: rgba(255, 255, 255, 0.03) !important;
  border-radius: 10px !important;
}

/* ── Body ── */
.vaults-dialog-body {
  height: calc(100vh - 64px);
  overflow: hidden;
}

/* ── Left column ── */
.vaults-list-col {
  height: 100%;
  overflow-y: auto;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
}

/* ── Right column ── */
.vaults-detail-col {
  height: 100%;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
}

/* ── Section label ── */
.dialog-section-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
}

/* ── Summary card ── */
.dialog-summary-card {
  display: flex;
  align-items: center;
  background: rgba(0, 199, 243, 0.04);
  border: 1px solid rgba(0, 199, 243, 0.12);
  border-radius: 12px;
  padding: 12px 16px;
}

.dialog-summary-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.dialog-summary-divider {
  width: 1px;
  height: 28px;
  background: rgba(0, 199, 243, 0.15);
  margin: 0 16px;
}

.dialog-summary-label {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
}

.dialog-summary-value {
  font-size: 15px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);
}

.dialog-summary-value--cyan { color: #00c7f3; }

/* ── Filters ── */
.dialog-filters-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dialog-filter-chips {
  display: flex;
  gap: 4px;
  flex: 1;
  flex-wrap: wrap;
}

.dialog-filter-chip {
  padding: 3px 10px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.dialog-filter-chip--active {
  background: rgba(0, 199, 243, 0.12);
  border-color: rgba(0, 199, 243, 0.3);
  color: #00c7f3;
  font-weight: 600;
}

.dialog-sort-select {
  max-width: 88px;
  flex-shrink: 0;
}

/* ── Vault list ── */
.dialog-vault-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Selected vault highlight */
:deep(.vault-card--selected) {
  background: rgba(0, 199, 243, 0.07) !important;
  border-color: rgba(0, 199, 243, 0.3) !important;
}

/* ── Empty states ── */
.dialog-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
}

/* ── Detail panel ── */
.detail-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 300px;
}

.detail-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
}

.detail-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 160px;
}

.detail-error__text {
  font-size: 12px;
  color: rgba(249, 112, 102, 0.7);
}

/* Detail header */
.detail-header__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.detail-vault-name {
  font-size: 18px;
  font-weight: 800;
  color: #ffffff;
  letter-spacing: -0.01em;
}

.detail-header__badges {
  display: flex;
  align-items: center;
}

.detail-status-chip {
  font-size: 9px !important;
  font-weight: 700 !important;
  letter-spacing: 0.05em !important;
  text-transform: uppercase !important;
  height: 18px !important;
}

.detail-status-chip--active {
  background: rgba(38, 250, 176, 0.12) !important;
  color: #26FAB0 !important;
  border: 1px solid rgba(38, 250, 176, 0.25) !important;
}

.detail-status-chip--paused {
  background: rgba(255, 167, 38, 0.12) !important;
  color: #FFA726 !important;
  border: 1px solid rgba(255, 167, 38, 0.25) !important;
}

.detail-status-chip--closed {
  background: rgba(249, 112, 102, 0.1) !important;
  color: #F97066 !important;
  border: 1px solid rgba(249, 112, 102, 0.22) !important;
}

.detail-description {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  line-height: 1.6;
  margin: 0 0 6px;
}

.detail-leader-row {
  display: flex;
  align-items: center;
}

.detail-leader-addr {
  font-size: 10px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: rgba(255, 255, 255, 0.3);
}

/* Performance Grid */
.detail-perf-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.detail-perf-cell {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.detail-perf-label {
  font-size: 9px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.28);
}

.detail-perf-value {
  font-size: 13px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);
}

.detail-perf-value--cyan { color: #00c7f3; }
.detail-perf-value--red  { color: #F97066; }

/* Position card */
.detail-position-card {
  background: rgba(0, 199, 243, 0.04);
  border: 1px solid rgba(0, 199, 243, 0.12);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-pos-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.detail-pos-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.detail-pos-value {
  font-size: 12px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
}

.detail-pos-value--cyan { color: #00c7f3; }

/* Depositors */
.detail-depositors {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-depositor-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.detail-depositor-rank {
  font-size: 10px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.25);
  width: 14px;
  text-align: center;
  flex-shrink: 0;
}

.detail-depositor-addr {
  font-size: 10px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: rgba(255, 255, 255, 0.5);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-depositor-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.detail-depositor-equity {
  font-size: 11px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
}

.detail-depositor-share {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
}

.detail-depositor-pnl {
  font-size: 10px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-weight: 600;
}

/* Actions */
.detail-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.detail-btn {
  flex: 1;
  height: 42px !important;
  border-radius: 10px !important;
  font-size: 13px !important;
  font-weight: 700 !important;
  text-transform: none !important;
  letter-spacing: 0.02em !important;
}

.detail-btn--deposit {
  background: rgba(0, 199, 243, 0.12) !important;
  color: #00c7f3 !important;
  border: 1px solid rgba(0, 199, 243, 0.3) !important;
}

.detail-btn--deposit:hover {
  background: rgba(0, 199, 243, 0.2) !important;
}

.detail-btn--withdraw {
  background: rgba(255, 255, 255, 0.05) !important;
  color: rgba(255, 255, 255, 0.6) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
}

.detail-btn--withdraw:hover {
  background: rgba(255, 255, 255, 0.09) !important;
}

/* Color utilities */
.color--green { color: #26FAB0; }
.color--red   { color: #F97066; }
</style>
