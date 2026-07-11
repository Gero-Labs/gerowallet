<template>
  <div class="epoch-history">
    <div class="section-header">
      <div class="section-title">
        <v-icon size="14" color="var(--g-text-1)" class="mr-1">mdi-chart-timeline-variant</v-icon>
        {{ $t('poolOperator.epochHistory') }}
      </div>
      <v-btn text x-small class="refresh-btn" @click="fetchHistory" :loading="loading">
        <v-icon x-small class="mr-1">mdi-refresh</v-icon>
      </v-btn>
    </div>

    <!-- Loading -->
    <div v-if="loading && !history.length" class="text-center py-4">
      <v-progress-circular indeterminate color="primary" size="20" />
    </div>

    <!-- Chart -->
    <div v-if="history.length" class="epoch-chart-wrap">
      <VueHighcharts :options="chartOptions" :styles="{ width: '100%', height: '280px' }" />
    </div>

    <!-- Data Table -->
    <v-data-table
      v-else-if="history.length"
      :headers="headers"
      :items="paginatedItems"
      :items-per-page="-1"
      dense
      class="transparent epoch-table"
      sort-by="epoch"
      :sort-desc="true"
      hide-default-footer
      :header-props="{ 'sort-icon': 'mdi-menu-up' }"
      @click:row="selectEpoch"
    >
      <!-- Pagination -->
      <template v-slot:body.append>
        <tr v-if="tableItems.length > perPage" class="no-hover">
          <td :colspan="headers.length" class="text-center pa-0">
            <v-pagination
              v-model="currentPage"
              :length="totalPages"
              :total-visible="5"
              circle
              class="compact-pagination my-1"
            />
          </td>
        </tr>
      </template>

      <template v-slot:item.activeStake="{ item }">
        <span class="num-value">{{ item.activeStake }}</span>
      </template>
      <template v-slot:item.blocks="{ item }">
        <span class="block-count" :class="blockClass(item.luck)">{{ item.blocks }}</span>
      </template>
      <template v-slot:item.luck="{ item }">
        <span v-if="item.luck === '--'" class="text-muted">--</span>
        <span v-else class="luck-badge" :class="luckBadgeClass(item.luck)">{{ item.luck }}%</span>
      </template>
      <template v-slot:item.spoRewards="{ item }">
        <span class="num-value reward-spo">{{ item.spoRewards }}</span>
      </template>
      <template v-slot:item.delegRewards="{ item }">
        <span class="num-value reward-deleg">{{ item.delegRewards }}</span>
      </template>
      <template v-slot:item.ros="{ item }">
        <span :class="item.rosNum > 0 ? 'text-success' : ''">{{ item.ros }}%</span>
      </template>
    </v-data-table>

    <!-- Empty -->
    <div v-else class="text-center py-4">
      <span class="empty-text">{{ $t('poolOperator.noEpochHistory') }}</span>
    </div>

    <!-- Block Detail Dialog -->
    <v-dialog v-model="showBlockDetail" max-width="500px">
      <v-card class="block-detail-card">
        <v-card-title class="d-flex align-center" style="border-bottom: 1px solid var(--g-hairline-1)">
          <v-icon size="18" color="var(--g-accent)" class="mr-2">mdi-cube-outline</v-icon>
          {{ $t('poolOperator.epoch') }} {{ selectedEpoch?.epoch }} — {{ $t('poolOperator.blocks') }}
          <v-spacer />
          <v-btn icon small @click="showBlockDetail = false"><v-icon small>mdi-close</v-icon></v-btn>
        </v-card-title>
        <v-card-text class="pt-3">
          <div v-if="blocksLoading" class="text-center py-4">
            <v-progress-circular indeterminate color="primary" size="24" />
          </div>
          <div v-else-if="epochBlocks.length">
            <div v-for="block in epochBlocks" :key="block.block_hash" class="block-item">
              <div class="block-slot">
                <v-icon x-small color="var(--g-text-3)" class="mr-1">mdi-clock-outline</v-icon>
                {{ $t('poolOperator.slot') }} {{ block.epoch_slot }}
              </div>
              <div class="block-info">
                <span class="block-height">#{{ block.block_height }}</span>
                <span class="block-time">{{ formatTime(block.block_time) }}</span>
              </div>
              <div class="block-hash" @click="copyHash(block.block_hash)">
                {{ block.block_hash.substring(0, 16) }}...
                <v-icon x-small color="var(--g-text-3)">mdi-content-copy</v-icon>
              </div>
            </div>
          </div>
          <div v-else class="text-center py-4 empty-text">
            {{ $t('poolOperator.noBlocksInEpoch') }}
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRefs, onMounted, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { walletStore } from '@/stores/walletStore';
import spoApi, { PoolBlock, PoolEpochHistory } from '@/api/spo-api';
import blockchainApi from '@/api/blockchain-api';
import snackbar from '@/plugins/snackbar';
import VueHighcharts from '@/shared/components/VueHighcharts.vue';

const { t } = useTranslation();
const { poolId } = toRefs(poolOperatorStore);
const { loggedWallet } = toRefs(walletStore);

const loading = ref(false);
const history = ref<PoolEpochHistory[]>([]);
const currentPage = ref(1);
const perPage = 10;
const totalPages = computed(() => Math.ceil(tableItems.value.length / perPage));
const paginatedItems = computed(() => {
  const start = (currentPage.value - 1) * perPage;
  return tableItems.value.slice(start, start + perPage);
});

const showBlockDetail = ref(false);
const selectedEpoch = ref<any>(null);
const epochBlocks = ref<PoolBlock[]>([]);
const blocksLoading = ref(false);

const headers = computed(() => [
  { text: t('poolOperator.epoch'), value: 'epoch', sortable: true },
  { text: t('poolOperator.activeStake'), value: 'activeStake', sortable: true, align: 'end' },
  { text: t('poolOperator.blocksProduced'), value: 'blocks', sortable: true, align: 'end' },
  { text: t('poolOperator.expected'), value: 'expected', sortable: true, align: 'end' },
  { text: t('poolOperator.luck'), value: 'luck', sortable: true, align: 'end' },
  { text: t('poolOperator.spoRewards'), value: 'spoRewards', sortable: true, align: 'end' },
  { text: t('poolOperator.delegatorRewards'), value: 'delegRewards', sortable: true, align: 'end' },
  { text: t('poolOperator.delegators'), value: 'delegators', sortable: true, align: 'end' },
  { text: t('poolOperator.ros'), value: 'ros', sortable: true, align: 'end' },
]);

const tableItems = computed(() => {
  // Derive total active stake from any epoch where active_stake_pct is available
  let totalActiveStake = 0;
  for (const ep of history.value) {
    if (ep.active_stake_pct && ep.active_stake_pct > 0 && ep.active_stake) {
      totalActiveStake = Number(ep.active_stake) / (ep.active_stake_pct / 100);
      break;
    }
  }
  // Fallback: ~22.5B ADA in lovelace (mainnet total active stake)
  if (!totalActiveStake) totalActiveStake = 22_500_000_000_000_000;

  return history.value.map(epoch => {
    let expected = 0;
    if (epoch.active_stake_pct && epoch.active_stake_pct > 0) {
      expected = (epoch.active_stake_pct / 100) * 21600;
    } else if (epoch.active_stake) {
      expected = (Number(epoch.active_stake) / totalActiveStake) * 21600;
    }

    const luck = expected > 0.1
      ? Math.round(spoApi.calculateLuck(epoch.block_cnt, expected))
      : (epoch.block_cnt > 0 ? 999 : 0);

    return {
      epoch: epoch.epoch_no,
      activeStake: formatAda(epoch.active_stake),
      blocks: epoch.block_cnt,
      expected: expected > 0.1 ? expected.toFixed(1) : '--',
      luck: luck > 998 ? '--' : luck,
      luckNum: luck > 998 ? 0 : luck,
      spoRewards: formatAda(epoch.pool_fees, 6),
      delegRewards: formatAda(epoch.deleg_rewards, 6),
      delegators: epoch.delegator_cnt,
      ros: calcRos(epoch),
      rosNum: parseFloat(calcRos(epoch)) || 0,
      _raw: epoch,
    };
  });
});

const chartOptions = computed(() => {
  const sorted = [...history.value].sort((a, b) => a.epoch_no - b.epoch_no);
  const epochs = sorted.map(e => e.epoch_no);

  // Derive total active stake (same logic as tableItems)
  let totalActiveStake = 0;
  for (const ep of history.value) {
    if (ep.active_stake_pct && ep.active_stake_pct > 0 && ep.active_stake) {
      totalActiveStake = Number(ep.active_stake) / (ep.active_stake_pct / 100);
      break;
    }
  }
  if (!totalActiveStake) totalActiveStake = 22_500_000_000_000_000;

  const blocksData = sorted.map(e => e.block_cnt);
  const expectedData = sorted.map(e => {
    if (e.active_stake_pct && e.active_stake_pct > 0) return +((e.active_stake_pct / 100) * 21600).toFixed(1);
    if (e.active_stake) return +((Number(e.active_stake) / totalActiveStake) * 21600).toFixed(1);
    return 0;
  });
  const stakeData = sorted.map(e => +(Number(e.active_stake || 0) / 1_000_000).toFixed(0));
  const delegatorsData = sorted.map(e => e.delegator_cnt);
  const spoRewardsData = sorted.map(e => Number(e.pool_fees || 0) / 1_000_000);
  const delegRewardsData = sorted.map(e => Number(e.deleg_rewards || 0) / 1_000_000);

  return {
    chart: {
      backgroundColor: 'transparent',
      style: { fontFamily: 'inherit' },
      spacingTop: 10,
      spacingBottom: 5,
    },
    title: { text: undefined },
    credits: { enabled: false },
    legend: {
      enabled: true,
      itemStyle: { color: 'rgba(255,255,255,0.6)', fontSize: '10px', fontWeight: '400' },
      itemHoverStyle: { color: '#fff' },
    },
    xAxis: {
      categories: epochs,
      labels: { style: { color: 'rgba(255,255,255,0.4)', fontSize: '9px' }, step: Math.max(1, Math.floor(epochs.length / 15)) },
      lineColor: 'rgba(255,255,255,0.06)',
      tickColor: 'rgba(255,255,255,0.06)',
    },
    yAxis: [
      { // 0: Blocks
        title: { text: undefined },
        labels: { style: { color: 'rgba(45,240,247,0.6)', fontSize: '9px' } },
        gridLineColor: 'rgba(255,255,255,0.04)',
        min: 0,
      },
      { // 1: Stake (ADA)
        title: { text: undefined },
        labels: { style: { color: 'rgba(253,176,34,0.6)', fontSize: '9px' }, formatter() { return formatAda(String((this as any).value * 1_000_000)); } },
        opposite: true,
        gridLineWidth: 0,
        min: 0,
      },
      { // 2: Delegators
        title: { text: undefined },
        labels: { enabled: false },
        gridLineWidth: 0,
        min: 0,
        visible: false,
      },
      { // 3: Rewards (ADA)
        title: { text: undefined },
        labels: { enabled: false },
        gridLineWidth: 0,
        min: 0,
        visible: false,
      },
    ],
    tooltip: {
      shared: true,
      backgroundColor: 'rgba(19,22,27,0.95)',
      borderColor: 'rgba(255,255,255,0.1)',
      style: { color: 'rgba(255,255,255,0.85)', fontSize: '11px' },
      headerFormat: '<span style="font-size:11px;font-weight:600">Epoch {point.key}</span><br/>',
    },
    plotOptions: {
      column: { borderWidth: 0, borderRadius: 2, stacking: undefined },
      series: { animation: { duration: 600 } },
    },
    series: [
      {
        name: t('poolOperator.blocksProduced'),
        type: 'column',
        yAxis: 0,
        data: blocksData,
        color: 'rgba(45,240,247,0.7)',
        tooltip: { valueSuffix: ' blocks' },
      },
      {
        name: t('poolOperator.expected'),
        type: 'spline',
        yAxis: 0,
        data: expectedData,
        color: 'rgba(253,162,155,0.8)',
        dashStyle: 'ShortDash',
        lineWidth: 1.5,
        marker: { enabled: false },
        tooltip: { valueSuffix: ' blocks' },
      },
      {
        name: t('poolOperator.activeStake'),
        type: 'area',
        yAxis: 1,
        data: stakeData,
        color: '#FDB022',
        fillColor: { linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [[0, 'rgba(253,176,34,0.15)'], [1, 'rgba(253,176,34,0)']] },
        lineWidth: 1.5,
        marker: { enabled: false },
        tooltip: { pointFormatter() { return `<span style="color:${(this as any).color}">BULLET_TMP</span> ${(this as any).series.name}: <b>${formatAda(String((this as any).y * 1_000_000))} ADA</b><br/>`; } },
      },
      {
        name: t('poolOperator.delegators'),
        type: 'spline',
        yAxis: 2,
        data: delegatorsData,
        color: 'rgba(117,224,167,0.7)',
        lineWidth: 1,
        marker: { enabled: false },
        tooltip: { valueSuffix: '' },
      },
      {
        name: t('poolOperator.spoRewards'),
        type: 'column',
        yAxis: 3,
        data: spoRewardsData,
        color: 'rgba(253,176,34,0.5)',
        stack: 'rewards',
        tooltip: { pointFormatter() { return `<span style="color:${(this as any).color}">BULLET_TMP</span> ${(this as any).series.name}: <b>${formatAda(String(Math.round((this as any).y * 1_000_000)), 6)} ADA</b><br/>`; } },
      },
      {
        name: t('poolOperator.delegatorRewards'),
        type: 'column',
        yAxis: 3,
        data: delegRewardsData,
        color: 'rgba(117,224,167,0.35)',
        stack: 'rewards',
        tooltip: { pointFormatter() { return `<span style="color:${(this as any).color}">BULLET_TMP</span> ${(this as any).series.name}: <b>${formatAda(String(Math.round((this as any).y * 1_000_000)), 6)} ADA</b><br/>`; } },
      },
    ],
  };
});

function calcRos(epoch: PoolEpochHistory): string {
  // Use Koios epoch_ros if available and non-zero
  if (epoch.epoch_ros && epoch.epoch_ros > 0) return epoch.epoch_ros.toFixed(2);

  // Calculate: annualized return = (total_rewards / active_stake) * (365 / 5) * 100
  const rewards = Number(epoch.pool_fees || 0) + Number(epoch.deleg_rewards || 0);
  const stake = Number(epoch.active_stake || 0);
  if (stake <= 0 || rewards <= 0) return '0';

  const epochsPerYear = 73; // 365 / 5
  const annualizedRos = (rewards / stake) * epochsPerYear * 100;
  return annualizedRos.toFixed(2);
}

function blockClass(luck: number): string {
  if (luck >= 120) return 'text-great';
  if (luck >= 80) return 'text-good';
  if (luck > 0) return 'text-warn';
  return 'text-muted';
}

function luckBadgeClass(luck: number): string {
  if (luck >= 120) return 'luck--great';
  if (luck >= 80) return 'luck--good';
  if (luck > 0) return 'luck--low';
  return 'luck--none';
}

function formatAda(lovelace: string | number | null, decimals = 2): string {
  if (!lovelace || lovelace === '0') return '0';
  const ada = Number(lovelace) / 1_000_000;
  if (ada >= 1_000_000_000) return (ada / 1_000_000_000).toFixed(2) + 'B';
  if (ada >= 1_000_000) return (ada / 1_000_000).toFixed(2) + 'M';
  if (ada >= 10_000) return (ada / 1_000).toFixed(1) + 'K';
  return ada.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatTime(unixTime: number): string {
  return new Date(unixTime * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function copyHash(hash: string) {
  navigator.clipboard.writeText(hash);
  snackbar.fireSuccess(t('common.copied'));
}

async function fetchHistory() {
  if (!poolId.value || !loggedWallet.value) return;
  loading.value = true;
  try {
    const data = await blockchainApi.getPoolHistory(poolId.value, loggedWallet.value.chain, loggedWallet.value.network);
    // Backend returns snake_case fields directly (Koios format)
    history.value = (data || []).map((h: any) => ({
      epoch_no: h.epoch_no ?? h.epochNo,
      active_stake: h.active_stake ?? h.activeStake,
      active_stake_pct: h.active_stake_pct ?? h.activeStakePct,
      saturation_pct: h.saturation_pct ?? h.saturationPct,
      block_cnt: h.block_cnt ?? h.blockCnt,
      delegator_cnt: h.delegator_cnt ?? h.delegatorCnt,
      margin: h.margin,
      fixed_cost: h.fixed_cost ?? h.fixedCost,
      pool_fees: h.pool_fees ?? h.poolFees,
      deleg_rewards: h.deleg_rewards ?? h.delegRewards,
      member_rewards: h.member_rewards ?? h.memberRewards,
      epoch_ros: h.epoch_ros ?? h.epochRos,
    }));
  } catch (e) {
    console.warn('Failed to fetch pool history:', e);
  } finally {
    loading.value = false;
  }
}

async function selectEpoch(item: any) {
  const epoch = item._raw || item;
  selectedEpoch.value = { epoch: epoch.epoch_no || item.epoch };
  showBlockDetail.value = true;
  blocksLoading.value = true;
  try {
    epochBlocks.value = await spoApi.getPoolBlocks(poolId.value!, loggedWallet.value!.network, selectedEpoch.value.epoch);
  } catch {
    epochBlocks.value = [];
  } finally {
    blocksLoading.value = false;
  }
}

onMounted(() => { if (poolId.value) fetchHistory(); });
watch(poolId, (id) => { if (id) fetchHistory(); });
</script>

<style scoped>
.epoch-history { }

.epoch-chart-wrap {
  margin-bottom: 16px;
  border-bottom: 1px solid var(--g-hairline-1);
  padding-bottom: 12px;
}

.section-header {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
}

.section-title {
  font-size: 11px; font-weight: 600; color: var(--g-text-1);
  display: flex; align-items: center;
}

.refresh-btn {
  text-transform: none !important; letter-spacing: normal !important; color: var(--g-text-3) !important;
}

/* Data table — matches MarketTokenTable style */
.epoch-table >>> .v-data-table__wrapper {
  overflow-x: auto;
}

.epoch-table >>> tbody tr {
  cursor: pointer;
}

.epoch-table >>> tbody tr:hover {
  background: var(--g-hairline-1) !important;
}

.epoch-table >>> th {
  font-size: 11px !important;
  white-space: nowrap;
}

.epoch-table >>> td {
  padding-top: 4px !important;
  padding-bottom: 4px !important;
}

.epoch-table >>> td.text-end {
  font-family: var(--g-font-mono);
  font-variant-numeric: tabular-nums;
}

.epoch-table >>> .no-hover:hover {
  background: transparent !important;
}

.block-count { font-weight: 700; }

.text-great { color: var(--g-success); }
.text-good { color: var(--g-text-1); }
.text-warn { color: var(--g-error); }
.text-muted { color: var(--g-text-3); }
.text-success { color: var(--g-success); }
.num-value { color: var(--g-text-2); font-weight: 500; }
.reward-spo { color: var(--g-warning); }
.reward-deleg { color: var(--g-success); }

.luck-badge {
  display: inline-block; padding: 1px 6px; border-radius: var(--g-r-chip);
  font-size: 11px; font-weight: 700;
}
.luck--great { background: var(--g-success-fill); color: var(--g-success); }
.luck--good { background: var(--g-hairline-1); color: var(--g-text-2); }
.luck--low { background: var(--g-error-fill); color: var(--g-error); }
.luck--none { background: var(--g-hairline-1); color: var(--g-text-3); }

.empty-text { color: var(--g-text-3); font-size: 13px; }

/* Block Detail Dialog */
.block-detail-card { background: var(--g-raised) !important; border: 1px solid var(--g-hairline-1); }

.block-item { padding: 10px 0; border-bottom: 1px solid var(--g-hairline-1); }
.block-item:last-child { border-bottom: none; }

.block-slot { font-size: 11px; color: var(--g-text-3); display: flex; align-items: center; }
.block-info { display: flex; align-items: center; gap: 12px; margin-top: 2px; }
.block-height { font-size: 14px; font-weight: 600; color: var(--g-text-1); }
.block-time { font-size: 12px; color: var(--g-text-3); }

.block-hash {
  font-family: var(--g-font-mono); font-size: 11px; color: var(--g-text-3);
  margin-top: 2px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;
  transition: color 0.15s;
}
.block-hash:hover { color: var(--g-text-2); }
</style>
