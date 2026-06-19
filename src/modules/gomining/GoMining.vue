<template>
  <v-layout column class="gomining-page">

    <!-- ── Loading / initializing ──────────────────────────────────────── -->
    <div v-if="state === 'loading'" class="d-flex flex-column align-center justify-center fill-height pa-8">
      <v-progress-circular indeterminate color="primary" size="48" class="mb-4" />
      <div class="text-body-1">{{ $t('gomining.connecting') }}</div>
    </div>

    <!-- ── Error ──────────────────────────────────────────────────────── -->
    <div v-else-if="state === 'error'" class="d-flex flex-column align-center justify-center pa-8">
      <v-icon size="64" color="error" class="mb-4">mdi-alert-circle-outline</v-icon>
      <div class="text-h6 font-weight-bold mb-2">{{ $t('gomining.connectionFailed') }}</div>
      <div class="text-body-2 text--secondary text-center mb-6" style="max-width: 400px;">
        {{ errorMessage || $t('gomining.connectionFailedDescription') }}
      </div>
      <v-btn color="primary" outlined @click="initialize">
        <v-icon left small>mdi-refresh</v-icon>
        {{ $t('common.tryAgain') }}
      </v-btn>
    </div>

    <!-- ── Main content ───────────────────────────────────────────────── -->
    <template v-else-if="state === 'ready'">

      <!-- Page header -->
      <v-row no-gutters class="pa-2 pb-0">
        <v-col cols="12">
          <div class="d-flex align-center" style="gap: 12px;">
            <div class="gomining-logo-wrapper">
              <img :src="gominingLogo" alt="GoMining" style="width: 22px; height: 22px; object-fit: contain;" />
            </div>
            <div>
              <div class="text-h6 font-weight-bold" style="line-height: 1.2;">GoMining</div>
              <div class="text-caption text--secondary">{{ $t('gomining.subtitle') }}</div>
            </div>
            <v-spacer />
            <v-chip x-small color="success" outlined style="border-radius: 6px !important;">
              <v-icon x-small left>mdi-check-circle</v-icon>
              {{ $t('gomining.connected') }}
            </v-chip>
          </div>
        </v-col>
      </v-row>

      <!-- ── Tab navigation ── -->
      <v-row no-gutters class="pa-2">
        <v-col cols="12">
          <v-tabs v-model="activeTab" color="primary" height="36">
            <v-tab class="text-capitalize">
              <v-icon small left>mdi-view-dashboard</v-icon>
              {{ $t('gomining.tabOverview') }}
            </v-tab>
            <v-tab class="text-capitalize">
              <v-icon small left>mdi-pickaxe</v-icon>
              {{ $t('gomining.tabMyMiners') }}
              <v-badge
                v-if="miners.length"
                :content="miners.length"
                color="primary"
                inline
                class="ml-1"
              />
            </v-tab>
            <v-tab class="text-capitalize">
              <v-icon small left>mdi-store</v-icon>
              {{ $t('gomining.tabShop') }}
            </v-tab>
            <v-tab class="text-capitalize">
              <v-icon small left>mdi-chart-line</v-icon>
              {{ $t('gomining.tabEarnings') }}
            </v-tab>
          </v-tabs>
        </v-col>
      </v-row>

      <v-tabs-items v-model="activeTab" class="transparent-tabs">

        <!-- ─ Tab 0: Overview ───────────────────────────────────────────── -->
        <v-tab-item>
          <v-row no-gutters class="pa-2">

            <!-- Stats card (full width) -->
            <v-col cols="12" class="pa-2">
              <GoMiningStatsCard
                :stats="stats"
                :loading="loadingStats"
                @refresh="refreshAll"
              />
            </v-col>

            <!-- Balance card -->
            <v-col cols="12" sm="6" md="4" class="pa-2">
              <GoMiningBalanceCard
                :balance="balance"
                :btc-address="btcAddress"
                :loading="loadingBalance"
                @withdraw="showWithdrawDialog = true"
              />
            </v-col>

            <!-- Earnings chart -->
            <v-col cols="12" sm="6" md="8" class="pa-2">
              <v-card outlined class="liquid-glass pa-4 fill-height earnings-chart-card">
                <div class="d-flex align-center mb-3" style="gap: 8px;">
                  <v-icon small color="#F7931A">mdi-chart-bar</v-icon>
                  <span class="text-subtitle-2 font-weight-bold">{{ $t('gomining.earningsHistory') }}</span>
                  <v-spacer />
                  <span class="text-caption text--secondary">{{ $t('gomining.last14Days') }}</span>
                </div>

                <!-- Empty state -->
                <div v-if="earningsChart.length === 0" class="d-flex align-center justify-center" style="height: 100px;">
                  <div class="text-center">
                    <v-icon size="36" color="grey" class="mb-2">mdi-chart-bar</v-icon>
                    <div class="text-caption text--secondary">
                      {{ miners.length === 0 ? $t('gomining.noMinersForEarnings') : $t('gomining.loadingEarnings') }}
                    </div>
                  </div>
                </div>

                <!-- Bar chart -->
                <div v-else class="earnings-bars d-flex align-end" style="height: 100px; gap: 3px;">
                  <v-tooltip
                    v-for="(pt, i) in earningsChart.slice(-14)"
                    :key="i"
                    top
                  >
                    <template #activator="{ on }">
                      <div
                        v-on="on"
                        class="earnings-bar"
                        :style="barStyle(pt.amount)"
                      />
                    </template>
                    <span>{{ pt.date }}: +{{ pt.amount.toFixed(8) }} BTC</span>
                  </v-tooltip>
                </div>
              </v-card>
            </v-col>

          </v-row>
        </v-tab-item>

        <!-- ─ Tab 1: My Miners ──────────────────────────────────────────── -->
        <v-tab-item>
          <v-row no-gutters class="pa-2">
            <v-col cols="12" class="pa-2">
              <GoMiningMinersGrid
                :miners="miners"
                :loading="loadingMiners"
                @buy-more="activeTab = 2"
              />
            </v-col>
          </v-row>
        </v-tab-item>

        <!-- ─ Tab 2: Shop ────────────────────────────────────────────────── -->
        <v-tab-item>
          <v-row no-gutters class="pa-2">
            <v-col cols="12" class="pa-2">
              <GoMiningShop
                :collections="collections"
                :loading="loadingCollections"
                @buy="openBuyDialog"
              />
            </v-col>
          </v-row>
        </v-tab-item>

        <!-- ─ Tab 3: Earnings ────────────────────────────────────────────── -->
        <v-tab-item>
          <v-row no-gutters class="pa-2">
            <v-col cols="12" class="pa-2">
              <v-card outlined class="liquid-glass">
                <v-card-title class="d-flex align-center" style="gap: 8px;">
                  <v-icon color="primary" small>mdi-chart-line</v-icon>
                  <span class="text-subtitle-1 font-weight-bold">{{ $t('gomining.earningsHistory') }}</span>
                </v-card-title>

                <v-divider />

                <v-card-text v-if="loadingIncome">
                  <v-skeleton-loader type="table-row@6" />
                </v-card-text>

                <v-card-text v-else-if="incomeHistory.length === 0" class="text-center pa-8">
                  <v-icon size="56" color="grey" class="mb-3">mdi-history</v-icon>
                  <div class="text-body-1">{{ $t('gomining.noEarningsYet') }}</div>
                  <div class="text-caption text--secondary mt-1">{{ $t('gomining.noEarningsDescription') }}</div>
                </v-card-text>

                <v-data-table
                  v-else
                  :headers="earningsHeaders"
                  :items="incomeHistory"
                  :items-per-page="10"
                  class="transparent-table"
                  dense
                >
                  <template #item.amount="{ item }">
                    <span class="success--text font-weight-medium">
                      +{{ item.amount.toFixed(8) }} {{ item.currency }}
                    </span>
                  </template>
                  <template #item.date="{ item }">
                    <span class="text-caption">{{ formatDate(item.date) }}</span>
                  </template>
                </v-data-table>
              </v-card>
            </v-col>
          </v-row>
        </v-tab-item>

      </v-tabs-items>
    </template>

    <!-- ── Dialogs ─────────────────────────────────────────────────────── -->
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

  </v-layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
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

// ─── Earnings headers ─────────────────────────────────────────────────────────
const earningsHeaders = computed(() => [
  { text: 'Date', value: 'date', sortable: true },
  { text: 'Amount', value: 'amount', sortable: true },
  { text: 'Currency', value: 'currency', sortable: false },
]);

// ─── Initialization ───────────────────────────────────────────────────────────
async function initialize() {
  state.value = 'loading';
  errorMessage.value = '';

  if (!btcAddress.value) {
    state.value = 'error';
    errorMessage.value = 'No Bitcoin wallet address found.';
    return;
  }

  try {
    // Create/fetch GoMining account linked to BTC address
    const user = await goMiningApi.initUser(btcAddress.value);
    userId.value = user.userId;

    state.value = 'ready';

    // Load all data in parallel (non-blocking after initial auth)
    await refreshAll();
  } catch (error: any) {
    console.error('⛏ GoMining: initialization failed', error);
    state.value = 'error';
    errorMessage.value = error?.message ?? '';
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

function barStyle(amount: number): object {
  const pct = Math.max(4, (amount / maxEarnings.value) * 100);
  return {
    flex: 1,
    height: `${pct}%`,
    background: '#F7931A',
    borderRadius: '3px 3px 0 0',
    opacity: 0.85,
  };
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
onMounted(() => {
  initialize();
});
</script>

<style scoped>
.gomining-page {
  min-height: 100%;
}

.gomining-logo-wrapper {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: rgba(247, 147, 26, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.transparent-tabs {
  background: transparent !important;
}

.transparent-table {
  background: transparent !important;
}

.earnings-chart-card {
  border-radius: 10px !important;
}

.earnings-bars {
  width: 100%;
  padding: 0 2px;
}

.earnings-bar {
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
  min-height: 4px;
  opacity: 0.75;
  border-radius: 3px 3px 0 0 !important;
}

.earnings-bar:hover {
  opacity: 1 !important;
  transform: scaleY(1.03);
  transform-origin: bottom;
}
</style>