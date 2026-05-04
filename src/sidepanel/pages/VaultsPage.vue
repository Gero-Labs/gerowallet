<template>
  <div class="vaults-page">

    <!-- ── Sticky Header ── -->
    <div class="vaults-header pa-3">
      <div class="d-flex align-center" style="gap: 8px;">
        <v-btn icon small @click="$router.push('/')">
          <v-icon color="white">mdi-arrow-left</v-icon>
        </v-btn>
        <span class="vaults-title">{{ $t('vaults.title') }}</span>
      </div>
    </div>

    <!-- ── Not Connected: Show Onboarding ── -->
    <div v-if="!isConnected" class="vaults-onboarding-wrap">
      <StrikeOnboarding @connected="onConnected" />
    </div>

    <template v-else>

      <!-- ── My Deposits Section ── -->
      <template v-if="userPositions.length > 0">
        <div class="vaults-section-label mx-3 mt-3">{{ $t('vaults.myDeposits') }}</div>

        <!-- Summary Card -->
        <div class="deposits-summary mx-3 mb-2">
          <div class="deposits-summary__col">
            <span class="deposits-summary__label">{{ $t('vaults.totalEquity') }}</span>
            <span class="deposits-summary__value deposits-summary__value--cyan">
              {{ formatTvl(totalVaultEquity) }}
            </span>
          </div>
          <div class="deposits-summary__divider" />
          <div class="deposits-summary__col">
            <span class="deposits-summary__label">{{ $t('vaults.totalPnl') }}</span>
            <span :class="['deposits-summary__value', pnlClass(totalVaultPnl)]">
              {{ formatPnl(totalVaultPnl) }}
            </span>
          </div>
        </div>

        <!-- Horizontal scroll of position mini-cards -->
        <div class="positions-scroll-wrap mb-1">
          <div class="positions-scroll px-3">
            <div
              v-for="pos in userPositions"
              :key="pos.vault_id"
              class="position-mini-card"
              @click="openDetail(pos.vault_id)"
            >
              <div class="pmini-name">{{ vaultNameById(pos.vault_id) }}</div>
              <div class="pmini-value">{{ formatTvl(pos.current_value) }}</div>
              <div :class="['pmini-pnl', pnlClass(pos.pnl)]">{{ formatPnl(pos.pnl) }}</div>
            </div>
          </div>
        </div>
      </template>

      <!-- ── Browse Section ── -->
      <div class="vaults-section-label mx-3 mt-3">{{ $t('vaults.browseVaults') }}</div>

      <!-- Search -->
      <div class="px-3 mb-2">
        <v-text-field
          v-model="searchQuery"
          :placeholder="$t('vaults.searchPlaceholder')"
          prepend-inner-icon="mdi-magnify"
          outlined
          dense
          dark
          hide-details
          class="vaults-search"
          clearable
        />
      </div>

      <!-- Filter chips + Sort row -->
      <div class="filters-row px-3 mb-2">
        <div class="filter-chips">
          <button
            v-for="f in filterOptions"
            :key="f.id"
            class="filter-chip"
            :class="{ 'filter-chip--active': activeFilter === f.id }"
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
          class="sort-select"
          attach
        />
      </div>

      <!-- Loading -->
      <div v-if="loading && filteredVaults.length === 0" class="text-center py-8">
        <v-progress-circular indeterminate color="#00c7f3" size="32" width="3" />
        <div class="grey--text text-caption mt-2">{{ $t('vaults.loadingVaults') }}</div>
      </div>

      <!-- Empty state: no search results -->
      <div
        v-else-if="!loading && filteredVaults.length === 0 && (searchQuery || activeFilter !== 'all')"
        class="empty-state"
      >
        <v-icon size="40" color="rgba(255,255,255,0.08)">mdi-safe-square-outline</v-icon>
        <div class="text-body-2 grey--text mt-3 text-center">{{ $t('vaults.noVaultsFound') }}</div>
        <v-btn x-small text color="#00c7f3" class="mt-2" @click="clearFilters()">
          {{ $t('vaults.clearFilters') }}
        </v-btn>
      </div>

      <!-- Empty state: no vaults at all -->
      <div
        v-else-if="!loading && vaults.length === 0"
        class="empty-state"
      >
        <v-icon size="40" color="rgba(255,255,255,0.08)">mdi-safe-square-outline</v-icon>
        <div class="text-body-2 grey--text mt-3 text-center">{{ $t('vaults.noVaultsAvailable') }}</div>
      </div>

      <!-- Vault list -->
      <div v-else class="vault-list px-3">
        <VaultCard
          v-for="vault in paginatedVaults"
          :key="vault.id"
          :vault="vault"
          @select="openDetail($event)"
        />

        <!-- Load More -->
        <div v-if="hasMore" class="text-center mt-3 mb-4">
          <v-btn
            small
            text
            color="#00c7f3"
            :loading="loading"
            @click="loadMore()"
          >
            {{ $t('common.loadMore') }}
          </v-btn>
        </div>
      </div>

    </template>

    <!-- ── Vault Detail Sheet ── -->
    <VaultDetailSheet
      v-if="selectedVaultId"
      :vault-id="selectedVaultId"
      :value="showDetail"
      @input="showDetail = $event"
      @deposit="onDepositRequest()"
      @withdraw="onWithdrawRequest()"
    />

    <!-- ── Deposit Sheet ── -->
    <VaultDepositSheet
      v-if="selectedVaultId && showDeposit"
      :vault-id="selectedVaultId"
      :vault-name="selectedVaultName"
      :value="showDeposit"
      @input="showDeposit = $event"
    />

    <!-- ── Withdraw Sheet ── -->
    <VaultWithdrawSheet
      v-if="selectedVaultId && showWithdraw"
      :vault-id="selectedVaultId"
      :vault-name="selectedVaultName"
      :value="showWithdraw"
      @input="showWithdraw = $event"
    />

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useStrikeVaults } from '@/modules/market/composables/useStrikeVaults';
import { useStrikeOnboarding } from '@/modules/market/composables/useStrikeOnboarding';
import VaultCard from '../components/perps/VaultCard.vue';
import VaultDetailSheet from '../components/perps/VaultDetailSheet.vue';
import VaultDepositSheet from '../components/perps/VaultDepositSheet.vue';
import VaultWithdrawSheet from '../components/perps/VaultWithdrawSheet.vue';
import StrikeOnboarding from '../components/perps/StrikeOnboarding.vue';

// ── Composables ────────────────────────────────────────────────────────────────

const {
  vaults,
  userPositions,
  loading,
  totalVaultEquity,
  totalVaultPnl,
  loadVaults,
  loadUserPositions,
} = useStrikeVaults();

const { isConnected } = useStrikeOnboarding();

// ── State ─────────────────────────────────────────────────────────────────────

const selectedVaultId = ref<string>('');
const selectedVaultName = ref<string>('');
const showDetail = ref(false);
const showDeposit = ref(false);
const showWithdraw = ref(false);
const searchQuery = ref('');
const activeFilter = ref<'all' | 'verified' | 'protocol'>('all');
const sortBy = ref<'tvl' | 'apr' | 'pnl'>('tvl');
const visibleCount = ref(20);

const PAGE_SIZE = 20;

// ── Filter / Sort Options ──────────────────────────────────────────────────────

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

// ── Filtered + Sorted Vaults ──────────────────────────────────────────────────

const filteredVaults = computed(() => {
  let list = [...vaults.value];

  // Filter
  if (activeFilter.value === 'verified') {
    list = list.filter((v) => v.is_verified);
  } else if (activeFilter.value === 'protocol') {
    list = list.filter((v) => v.type === 'protocol');
  }

  // Search
  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter((v) => v.name.toLowerCase().includes(q));
  }

  // Sort
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

function openDetail(vaultId: string) {
  selectedVaultId.value = vaultId;
  selectedVaultName.value = vaultNameById(vaultId);
  showDetail.value = true;
}

function onDepositRequest() {
  showDetail.value = false;
  showDeposit.value = true;
}

function onWithdrawRequest() {
  showDetail.value = false;
  showWithdraw.value = true;
}

function onConnected() {
  loadVaults();
  loadUserPositions();
}

function loadMore() {
  visibleCount.value += PAGE_SIZE;
}

function clearFilters() {
  searchQuery.value = '';
  activeFilter.value = 'all';
}

function vaultNameById(vaultId: string): string {
  return vaults.value.find((v) => v.id === vaultId)?.name ?? vaultId;
}

// ── Format Helpers ─────────────────────────────────────────────────────────────

function formatTvl(raw: string | number): string {
  const n = typeof raw === 'number' ? raw : parseFloat(raw as string);
  if (isNaN(n)) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
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

function pnlClass(raw: string | number): string {
  const n = typeof raw === 'number' ? raw : parseFloat(raw as string);
  if (isNaN(n) || n === 0) return '';
  return n > 0 ? 'color--green' : 'color--red';
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(() => {
  loadVaults();
  if (isConnected.value) {
    loadUserPositions();
  }
});
</script>

<style scoped>
.vaults-page {
  min-height: 100%;
  padding-bottom: 80px;
  overflow-y: auto;
}

/* ── Header ── */
.vaults-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(14, 14, 18, 0.92);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding-bottom: 8px !important;
}

.vaults-title {
  font-size: 15px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: -0.01em;
}

/* ── Onboarding ── */
.vaults-onboarding-wrap {
  padding: 16px;
}

/* ── Section label ── */
.vaults-section-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
  margin-bottom: 6px;
}

/* ── Deposits Summary Card ── */
.deposits-summary {
  display: flex;
  align-items: center;
  background: rgba(0, 199, 243, 0.04);
  border: 1px solid rgba(0, 199, 243, 0.12);
  border-radius: 12px;
  padding: 12px 16px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.deposits-summary__col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.deposits-summary__divider {
  width: 1px;
  height: 28px;
  background: rgba(0, 199, 243, 0.15);
  margin: 0 16px;
}

.deposits-summary__label {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
}

.deposits-summary__value {
  font-size: 16px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);
}

.deposits-summary__value--cyan { color: #00c7f3; }

/* ── Position Mini-Cards (horizontal scroll) ── */
.positions-scroll-wrap {
  overflow: hidden;
}

.positions-scroll {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: none;
}

.positions-scroll::-webkit-scrollbar {
  display: none;
}

.position-mini-card {
  flex-shrink: 0;
  width: 112px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.position-mini-card:hover {
  background: rgba(0, 199, 243, 0.05);
  border-color: rgba(0, 199, 243, 0.22);
}

.pmini-name {
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.pmini-value {
  font-size: 13px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-weight: 700;
  color: #ffffff;
  margin-bottom: 2px;
}

.pmini-pnl {
  font-size: 11px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-weight: 600;
}

/* ── Search ── */
.vaults-search {
  background: rgba(255, 255, 255, 0.03) !important;
  border-radius: 10px !important;
}

/* ── Filters Row ── */
.filters-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-chips {
  display: flex;
  gap: 4px;
  flex: 1;
}

.filter-chip {
  padding: 4px 10px;
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

.filter-chip--active {
  background: rgba(0, 199, 243, 0.12);
  border-color: rgba(0, 199, 243, 0.3);
  color: #00c7f3;
  font-weight: 600;
}

.sort-select {
  max-width: 90px;
  flex-shrink: 0;
}

/* ── Vault List ── */
.vault-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── Empty States ── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 24px;
}

/* ── Color Utilities ── */
.color--green { color: #26FAB0; }
.color--red   { color: #F97066; }
</style>
