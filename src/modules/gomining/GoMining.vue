<template>
  <div class="gm">
    <!-- Header. The GoMining mark is a partner lockup: it names whose surface this is, nothing else. -->
    <div class="gm__header">
      <div class="gm__headline">
        <span class="t-label">{{ $t('bitcoin.ecosystem') }}</span>
        <h1 class="t-title gm__title">
          <img :src="gominingLogo" class="gm__logo" alt="" />
          {{ $t('navigation.goMining') }}
        </h1>
        <p class="t-body gm__subtitle">{{ $t('gomining.subtitle') }}</p>
      </div>
      <div v-if="state === 'ready'" class="gm__header-side">
        <span class="t-caption gm-status gm-status--ok" role="status">
          <span class="gm-status__dot" aria-hidden="true"></span>
          {{ $t('gomining.connected') }}
        </span>
      </div>
    </div>

    <!-- Connecting -->
    <div v-if="state === 'loading'" class="gm__loading" role="status">
      <v-progress-circular indeterminate color="var(--g-accent)" size="40" width="3" />
      <span class="t-body">{{ $t('gomining.connecting') }}</span>
    </div>

    <!-- Connection failed -->
    <div v-else-if="state === 'error'" class="glass-panel gm__error" role="alert">
      <v-icon size="32" class="gm__error-icon">mdi-alert-circle-outline</v-icon>
      <h2 class="t-heading gm__error-title">{{ $t('gomining.connectionFailed') }}</h2>
      <p class="t-body gm__error-text">{{ errorMessage || $t('gomining.connectionFailedDescription') }}</p>
      <GButton tier="secondary" compact @click="initialize()">
        <v-icon size="small" start>mdi-refresh</v-icon>
        {{ $t('common.tryAgain') }}
      </GButton>
    </div>

    <template v-else-if="state === 'ready'">
      <!-- Segmented tabs -->
      <div class="gm-tabs" role="tablist" :aria-label="$t('navigation.goMining')">
        <button
          v-for="tab in tabs"
          :id="`gm-tab-${tab.id}`"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.index ? 'true' : 'false'"
          :aria-controls="`gm-panel-${tab.id}`"
          :class="['t-body-sm', 'gm-tab', { 'gm-tab--active': activeTab === tab.index }]"
          @click="activeTab = tab.index"
        >
          <v-icon size="small">{{ tab.icon }}</v-icon>
          {{ $t(tab.labelKey) }}
          <span v-if="tab.id === 'miners' && miners.length" class="t-caption g-num gm-tab__count">{{ miners.length }}</span>
        </button>
      </div>

      <!-- Overview -->
      <div v-if="activeTab === 0" id="gm-panel-overview" class="gm-overview" role="tabpanel" aria-labelledby="gm-tab-overview">
        <GoMiningStatsCard
          class="gm-overview__full"
          :stats="stats"
          :loading="loadingStats"
          @refresh="refreshAll()"
        />

        <GoMiningBalanceCard
          :balance="balance"
          :btc-address="btcAddress"
          :loading="loadingBalance"
          @withdraw="showWithdrawDialog = true"
        />

        <section class="glass-panel gm-chart" :aria-label="$t('gomining.earningsHistory')">
          <div class="gm-chart__head">
            <span class="gm-chart__icon"><v-icon size="18">mdi-chart-bar</v-icon></span>
            <span class="t-body-lg">{{ $t('gomining.earningsHistory') }}</span>
            <span class="t-caption gm-chart__range">{{ $t('gomining.last14Days') }}</span>
          </div>

          <div v-if="earningsChart.length === 0" class="gm-chart__empty">
            <v-icon size="28" class="gm-chart__empty-icon">mdi-chart-bar</v-icon>
            <span class="t-caption">
              {{ miners.length === 0 ? $t('gomining.noMinersForEarnings') : $t('gomining.loadingEarnings') }}
            </span>
          </div>

          <!-- One bar a day; the amount is in the tooltip and, for readers, in the hidden text. -->
          <ul v-else class="gm-bars">
            <li v-for="(pt, i) in earningsChart.slice(-14)" :key="i" class="gm-bars__item">
              <v-tooltip location="top" content-class="custom-tooltip">
                <template #activator="{ props: activatorProps }">
                  <span v-bind="activatorProps" class="gm-bars__bar" :style="{ height: barHeight(pt.amount) }"></span>
                </template>
                <span>{{ barLabel(pt) }}</span>
              </v-tooltip>
              <span class="gm-sr-only">{{ barLabel(pt) }}</span>
            </li>
          </ul>
        </section>
      </div>

      <!-- My miners -->
      <div v-else-if="activeTab === 1" id="gm-panel-miners" role="tabpanel" aria-labelledby="gm-tab-miners">
        <GoMiningMinersGrid
          :miners="miners"
          :loading="loadingMiners"
          @buy-more="activeTab = 2"
        />
      </div>

      <!-- Shop -->
      <div v-else-if="activeTab === 2" id="gm-panel-shop" role="tabpanel" aria-labelledby="gm-tab-shop">
        <GoMiningShop
          :collections="collections"
          :loading="loadingCollections"
          @buy="openBuyDialog"
        />
      </div>

      <!-- Earnings -->
      <section v-else-if="activeTab === 3" id="gm-panel-earnings" class="glass-panel gm-earnings" role="tabpanel" aria-labelledby="gm-tab-earnings">
        <div class="gm-earnings__head">
          <span class="gm-chart__icon"><v-icon size="18">mdi-chart-line</v-icon></span>
          <span class="t-body-lg">{{ $t('gomining.earningsHistory') }}</span>
        </div>

        <div v-if="loadingIncome" class="gm-earnings__body" aria-busy="true">
          <v-skeleton-loader type="table-row@6" />
        </div>

        <div v-else-if="incomeHistory.length === 0" class="gm-earnings__empty">
          <v-icon size="28" class="gm-chart__empty-icon">mdi-history</v-icon>
          <span class="t-body-lg">{{ $t('gomining.noEarningsYet') }}</span>
          <span class="t-caption">{{ $t('gomining.noEarningsDescription') }}</span>
        </div>

        <!-- The card carries the material; the table is transparent over it. -->
        <v-data-table
          v-else
          :headers="earningsHeaders"
          :items="incomeHistory"
          :items-per-page="10"
          class="gm-table"
          density="compact"
        >
          <template #item.amount="{ item }">
            <span class="g-num gm-table__in">+{{ formatBtcFromBtc(item.amount) }} {{ item.currency }}</span>
          </template>
          <template #item.date="{ item }">
            <span class="t-body-sm">{{ formatDate(item.date) }}</span>
          </template>
        </v-data-table>
      </section>
    </template>

    <!-- Dialogs -->
    <GoMiningWithdrawDialog
      v-if="userId"
      v-model="showWithdrawDialog"
      :user-id="userId"
      :btc-address="btcAddress"
      :balance="balance"
      @success="onWithdrawSuccess"
    />

    <GoMiningBuyDialog
      v-if="userId"
      v-model="showBuyDialog"
      :user-id="userId"
      :collection="selectedCollection"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { useTranslation } from '@/shared/composables/useTranslation';
import { formatBtcFromBtc } from '@/shared/utils/format';
import GButton from '@/shared/components/GButton/GButton.vue';
import goMiningApi, {
  type GoMiningUserStats,
  type GoMiningNft,
  type GoMiningCollection,
  type GoMiningBalance,
  type GoMiningIncomeRecord,
  type GoMiningEarningsPoint,
} from '@/api/gomining-api';
import GoMiningStatsCard from './components/GoMiningStatsCard.vue';
import GoMiningBalanceCard from './components/GoMiningBalanceCard.vue';
import GoMiningMinersGrid from './components/GoMiningMinersGrid.vue';
import GoMiningShop from './components/GoMiningShop.vue';
import GoMiningWithdrawDialog from './dialogs/GoMiningWithdrawDialog.vue';
import GoMiningBuyDialog from './dialogs/GoMiningBuyDialog.vue';
import gominingLogo from '@/assets/svg/gomining.svg';

const { t } = useTranslation();

// ─── Wallet state ─────────────────────────────────────────────────────────────
const { loggedWallet } = toRefs(walletStore);

const btcAddress = computed(() => loggedWallet.value?.baseAddress ?? '');

// ─── Local state ──────────────────────────────────────────────────────────────
type PageState = 'loading' | 'error' | 'ready';

const state = ref<PageState>('loading');
const errorMessage = ref('');
const activeTab = ref(0);

const userId = ref('');
const stats = ref<GoMiningUserStats | null>(null);
const miners = ref<GoMiningNft[]>([]);
const collections = ref<GoMiningCollection[]>([]);
const balance = ref<GoMiningBalance | null>(null);
const incomeHistory = ref<GoMiningIncomeRecord[]>([]);
const earningsChart = ref<GoMiningEarningsPoint[]>([]);

const loadingStats = ref(false);
const loadingMiners = ref(false);
const loadingCollections = ref(false);
const loadingBalance = ref(false);
const loadingIncome = ref(false);

const showWithdrawDialog = ref(false);
const showBuyDialog = ref(false);
const selectedCollection = ref<GoMiningCollection | null>(null);

const tabs = [
  { id: 'overview', index: 0, icon: 'mdi-view-dashboard-outline', labelKey: 'gomining.tabOverview' },
  { id: 'miners', index: 1, icon: 'mdi-pickaxe', labelKey: 'gomining.tabMyMiners' },
  { id: 'shop', index: 2, icon: 'mdi-store-outline', labelKey: 'gomining.tabShop' },
  { id: 'earnings', index: 3, icon: 'mdi-chart-line', labelKey: 'gomining.tabEarnings' },
];

// ─── Earnings headers ─────────────────────────────────────────────────────────
const earningsHeaders = computed(() => [
  { title: t('common.date'), key: 'date', sortable: true },
  { title: t('common.amount'), key: 'amount', sortable: true },
  { title: t('gomining.currency'), key: 'currency', sortable: false },
]);

// ─── Initialization ───────────────────────────────────────────────────────────
async function initialize() {
  state.value = 'loading';
  errorMessage.value = '';

  if (!btcAddress.value) {
    state.value = 'error';
    errorMessage.value = t('gomining.noBtcAddress');
    return;
  }

  try {
    // Create/fetch GoMining account linked to BTC address
    const user = await goMiningApi.initUser(btcAddress.value);
    userId.value = user.userId;

    state.value = 'ready';

    // Load all data in parallel (non-blocking after initial auth)
    await refreshAll();
  } catch (error: unknown) {
    console.error('⛏ GoMining: initialization failed', error);
    state.value = 'error';
    errorMessage.value = error instanceof Error ? error.message : '';
  }
}

async function refreshAll() {
  if (!userId.value) return;

  await Promise.allSettled([
    refreshStats(),
    refreshMiners(),
    refreshCollections(),
    refreshBalance(),
  ]);

  // Load earnings chart for last 30 days
  loadEarningsChart();
}

async function refreshStats() {
  loadingStats.value = true;
  try {
    stats.value = await goMiningApi.getUserStats(userId.value);
  } catch (e) {
    console.warn('⛏ GoMining: failed to load stats', e);
  } finally {
    loadingStats.value = false;
  }
}

async function refreshMiners() {
  loadingMiners.value = true;
  try {
    miners.value = await goMiningApi.getMyNfts(userId.value);
  } catch (e) {
    console.warn('⛏ GoMining: failed to load miners', e);
  } finally {
    loadingMiners.value = false;
  }
}

async function refreshCollections() {
  loadingCollections.value = true;
  try {
    collections.value = await goMiningApi.getCollections();
  } catch (e) {
    console.warn('⛏ GoMining: failed to load collections', e);
  } finally {
    loadingCollections.value = false;
  }
}

async function refreshBalance() {
  loadingBalance.value = true;
  try {
    balance.value = await goMiningApi.getBalances(userId.value);
  } catch (e) {
    console.warn('⛏ GoMining: failed to load balance', e);
  } finally {
    loadingBalance.value = false;
  }
}

async function loadEarningsChart() {
  loadingIncome.value = true;
  try {
    const now = new Date();
    const dateEnd = now.toISOString().split('T')[0];
    const dateStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const [chart, history] = await Promise.allSettled([
      goMiningApi.getEarningsChart(userId.value, dateStart, dateEnd),
      goMiningApi.getIncomeHistory(userId.value),
    ]);

    if (chart.status === 'fulfilled') earningsChart.value = chart.value;
    if (history.status === 'fulfilled') incomeHistory.value = history.value;
  } finally {
    loadingIncome.value = false;
  }
}

// ─── Actions ──────────────────────────────────────────────────────────────────
function openBuyDialog(collection: GoMiningCollection) {
  selectedCollection.value = collection;
  showBuyDialog.value = true;
}

function onWithdrawSuccess() {
  // Refresh balance after withdrawal
  refreshBalance();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}


const maxEarnings = computed(() => {
  if (!earningsChart.value.length) return 1;
  return Math.max(...earningsChart.value.map(p => p.amount), 0.000001);
});

function barHeight(amount: number): string {
  return `${Math.max(4, (amount / maxEarnings.value) * 100)}%`;
}

function barLabel(pt: GoMiningEarningsPoint): string {
  return t('gomining.earnedOn', { date: pt.date, amount: formatBtcFromBtc(pt.amount) });
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
onMounted(() => {
  initialize();
});
</script>

<style scoped lang="scss">
.gm {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  min-height: 100%;
  padding: var(--g-s-4);
}

/* ── Header ─────────────────────────────────────────────── */
.gm__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--g-s-4);
  flex-wrap: wrap;
}

.gm__headline {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.gm__title {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  margin: 0;
}

.gm__logo {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.gm__subtitle {
  margin: 0;
}

.gm__header-side {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

.gm-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border-radius: var(--g-r-pill);
  font-weight: 600;
  white-space: nowrap;
}

.gm-status--ok {
  background: var(--g-success-fill);
  color: var(--g-success);
}

.gm-status__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--g-r-pill);
  background: currentColor;
}

/* ── Page states ────────────────────────────────────────── */
.gm__loading,
.gm__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--g-s-2);
  padding: var(--g-s-6) var(--g-s-4);
  text-align: center;
}

.gm__error-icon {
  color: var(--g-error);
}

.gm__error-title {
  margin: 0;
}

.gm__error-text {
  max-width: 42ch;
  margin: 0 0 var(--g-s-2);
}

/* ── Segmented tabs ─────────────────────────────────────── */
.gm-tabs {
  align-self: flex-start;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-1);
}

.gm-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
  height: 32px;
  padding: 0 var(--g-s-4);
  border: 0;
  border-radius: var(--g-r-pill);
  background: transparent;
  color: var(--g-text-2);
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease), color var(--g-dur-fast) var(--g-ease);
}

.gm-tab:hover {
  color: var(--g-text-1);
}

.gm-tab--active {
  background: var(--g-hairline-2);
  color: var(--g-text-1);
}

.gm-tab .v-icon {
  color: inherit;
}

.gm-tab .gm-tab__count {
  font-weight: 500;
}

/* ── Overview grid ──────────────────────────────────────── */
.gm-overview {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  gap: var(--g-s-4);
}

.gm-overview__full {
  grid-column: 1 / -1;
}

@media (max-width: 960px) {
  .gm-overview {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* ── Earnings chart ─────────────────────────────────────── */
.gm-chart {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
}

.gm-chart__head,
.gm-earnings__head {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

.gm-chart__range {
  margin-left: auto;
}

.gm-chart__icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
}

.gm-chart__icon .v-icon {
  color: var(--g-text-2);
}

.gm-chart__empty,
.gm-earnings__empty {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--g-s-1);
  min-height: 100px;
  text-align: center;
}

.gm-chart__empty-icon {
  margin-bottom: var(--g-s-1);
  color: var(--g-text-3);
}

.gm-bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 100px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.gm-bars__item {
  flex: 1 1 0;
  display: flex;
  align-items: flex-end;
  min-width: 0;
  height: 100%;
}

.gm-bars__bar {
  display: block;
  width: 100%;
  min-height: 4px;
  border-radius: var(--g-r-chip);
  background: var(--g-accent);
  opacity: 0.75;
  transition: opacity var(--g-dur-fast) var(--g-ease);
}

.gm-bars__item:hover .gm-bars__bar {
  opacity: 1;
}

.gm-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* ── Earnings table ─────────────────────────────────────── */
.gm-earnings {
  display: flex;
  flex-direction: column;
}

.gm-earnings__head {
  padding: var(--g-s-4);
  border-bottom: 1px solid var(--g-hairline-1);
}

.gm-earnings__body {
  padding: var(--g-s-3);
}

.gm-earnings__empty {
  padding: var(--g-s-6) var(--g-s-4);
}

.gm-table {
  background: transparent;
  color: var(--g-text-1);
}

.gm-table :deep(.v-data-table-header__content) {
  color: var(--g-text-3);
  font-weight: 500;
}

.gm-table__in {
  color: var(--g-success);
}
</style>
