<template>
  <v-container fluid class="pa-3">
    <!-- Page Header -->
    <div class="page-header d-flex align-center mb-4" style="gap: 12px;">
      <div class="page-icon-wrapper">
        <v-icon color="#F7931A" size="22">mdi-database-clock-outline</v-icon>
      </div>
      <div>
        <div class="text-h6 font-weight-bold">{{ $t('mempool.title') }}</div>
        <div class="text-caption text--secondary">{{ $t('mempool.subtitle') }}</div>
      </div>
      <v-spacer />
      <v-btn small icon :loading="loading" @click="refresh" class="mr-1">
        <v-icon small>mdi-refresh</v-icon>
      </v-btn>
      <v-btn small icon @click="openMempoolSpace">
        <v-icon small>mdi-open-in-new</v-icon>
      </v-btn>
    </div>

    <!-- Fee Rate Cards -->
    <v-row no-gutters class="mb-3">
      <v-col v-for="rate in feeRates" :key="rate.label" cols="6" sm="3" class="pa-1">
        <v-card outlined class="fee-rate-card liquid-glass pa-3 text-center" :style="{ borderColor: rate.color + '40' }">
          <div
            class="fee-indicator mx-auto mb-2"
            :style="{ background: rate.color + '18', borderColor: rate.color + '40' }"
          >
            <span class="font-weight-bold" :style="{ color: rate.color, fontSize: '16px' }">
              {{ fees ? fees[rate.key] : '—' }}
            </span>
          </div>
          <div class="text-caption font-weight-medium" style="font-size: 11px;">{{ rate.label }}</div>
          <div class="text-caption text--secondary" style="font-size: 11px;">sat/vB · {{ rate.time }}</div>
        </v-card>
      </v-col>
    </v-row>

    <!-- Mempool Stats Row -->
    <v-row no-gutters class="mb-3">
      <v-col cols="12" sm="4" class="pa-1">
        <v-card outlined class="liquid-glass pa-3 stat-card">
          <div class="d-flex align-center" style="gap: 10px;">
            <div class="stat-icon-wrapper" style="background: var(--g-warning-fill);">
              <v-icon size="16" color="warning">mdi-clock-outline</v-icon>
            </div>
            <div>
              <div class="t-label text--secondary">
                {{ $t('mempool.pendingTxs') }}
              </div>
              <div class="text-body-1 font-weight-bold">
                {{ mempoolStats ? mempoolStats.count.toLocaleString() : '—' }}
              </div>
            </div>
          </div>
        </v-card>
      </v-col>
      <v-col cols="12" sm="4" class="pa-1">
        <v-card outlined class="liquid-glass pa-3 stat-card">
          <div class="d-flex align-center" style="gap: 10px;">
            <div class="stat-icon-wrapper" style="background: color-mix(in srgb, var(--g-info) 12%, transparent);">
              <v-icon size="16" color="info">mdi-harddisk</v-icon>
            </div>
            <div>
              <div class="t-label text--secondary">
                {{ $t('mempool.mempoolSize') }}
              </div>
              <div class="text-body-1 font-weight-bold">
                {{ mempoolStats ? formatVsize(mempoolStats.vsize) : '—' }}
              </div>
            </div>
          </div>
        </v-card>
      </v-col>
      <v-col cols="12" sm="4" class="pa-1">
        <v-card outlined class="liquid-glass pa-3 stat-card">
          <div class="d-flex align-center" style="gap: 10px;">
            <div class="stat-icon-wrapper" style="background: rgba(247,147,26,0.12);">
              <v-icon size="16" color="#F7931A">mdi-bitcoin</v-icon>
            </div>
            <div>
              <div class="t-label text--secondary">
                {{ $t('mempool.totalFees') }}
              </div>
              <div class="text-body-1 font-weight-bold">
                {{ mempoolStats ? formatBtc(mempoolStats.total_fee) : '—' }}
                <span class="text-caption text--secondary ml-1">BTC</span>
              </div>
            </div>
          </div>
        </v-card>
      </v-col>
    </v-row>

    <!-- Fee Histogram -->
    <v-card outlined class="liquid-glass pa-4 mb-3" v-if="feeHistogram.length > 0">
      <div class="d-flex align-center mb-3">
        <v-icon small color="#F7931A" class="mr-2">mdi-chart-bar</v-icon>
        <span class="text-subtitle-2 font-weight-bold">{{ $t('mempool.feeDistribution') }}</span>
      </div>
      <div class="fee-histogram">
        <v-tooltip
          v-for="bucket in feeHistogram"
          :key="bucket.fee"
          top
          :open-delay="100"
        >
          <template #activator="{ on }">
            <div class="histogram-bar-wrapper" v-on="on">
              <div
                class="histogram-bar"
                :style="{
                  height: `${Math.max(4, (bucket.vsize / maxHistogramVsize) * 120)}px`,
                  background: barColor(bucket.fee),
                }"
              />
              <div class="histogram-label text-caption">{{ bucket.fee }}</div>
            </div>
          </template>
          <span>{{ bucket.fee }} sat/vB · {{ formatVsize(bucket.vsize) }}</span>
        </v-tooltip>
      </div>
      <div class="text-caption text--secondary mt-2 text-center">
        {{ $t('mempool.feeRateSatVb') }}
      </div>
    </v-card>

    <!-- Recent Blocks -->
    <div class="mb-3">
      <div class="d-flex align-center mb-2" style="gap: 8px;">
        <v-icon small color="#F7931A">mdi-cube-outline</v-icon>
        <span class="text-subtitle-2 font-weight-bold">{{ $t('mempool.recentBlocks') }}</span>
      </div>
      <v-skeleton-loader v-if="loading && blocks.length === 0" type="list-item-two-line@4" />
      <v-card
        v-for="block in blocks.slice(0, 6)"
        :key="block.id"
        outlined
        class="liquid-glass mb-2 block-card"
        @click="openBlock(block.id)"
        style="cursor: pointer;"
      >
        <div class="d-flex align-center pa-3" style="gap: 12px;">
          <div class="block-icon-wrapper">
            <v-icon color="#F7931A" size="18">mdi-cube-outline</v-icon>
          </div>
          <div class="flex-grow-1 min-width-0">
            <div class="font-weight-bold" style="font-size: 13px;">
              #{{ block.height.toLocaleString() }}
            </div>
            <div class="text-caption text--secondary">
              {{ block.tx_count.toLocaleString() }} txs ·
              {{ formatSize(block.size) }} ·
              {{ timeAgo(block.timestamp) }}
            </div>
          </div>
          <v-icon small color="grey">mdi-chevron-right</v-icon>
        </div>
      </v-card>
    </div>

    <!-- Transaction Lookup -->
    <v-card outlined class="liquid-glass pa-4">
      <div class="d-flex align-center mb-3" style="gap: 8px;">
        <v-icon small color="#F7931A">mdi-magnify</v-icon>
        <span class="text-subtitle-2 font-weight-bold">{{ $t('mempool.lookupTx') }}</span>
      </div>
      <div class="d-flex" style="gap: 8px;">
        <v-text-field
          v-model="txSearch"
          outlined
          dense
          :placeholder="$t('mempool.txidPlaceholder')"
          hide-details
          class="flex-grow-1"
          @keydown.enter="lookupTx"
        >
          <template #prepend-inner>
            <v-icon small color="grey" class="mr-1">mdi-magnify</v-icon>
          </template>
        </v-text-field>
        <v-btn color="primary" outlined @click="lookupTx" height="40">
          {{ $t('common.search') }}
        </v-btn>
      </div>

      <!-- TX result -->
      <div v-if="txResult" class="mt-4">
        <v-divider class="mb-3" />
        <div class="tx-result-row d-flex justify-space-between align-center mb-2">
          <span class="text-caption text--secondary">{{ $t('mempool.status') }}</span>
          <v-chip x-small :color="txResult.status.confirmed ? 'success' : 'warning'" text-color="white">
            <v-icon x-small left>{{ txResult.status.confirmed ? 'mdi-check-circle' : 'mdi-clock-outline' }}</v-icon>
            {{ txResult.status.confirmed ? $t('mempool.confirmed') : $t('mempool.unconfirmed') }}
          </v-chip>
        </div>
        <div v-if="txResult.status.confirmed" class="tx-result-row d-flex justify-space-between align-center mb-2">
          <span class="text-caption text--secondary">{{ $t('mempool.blockHeight') }}</span>
          <span class="text-caption font-weight-medium">#{{ txResult.status.block_height?.toLocaleString() }}</span>
        </div>
        <div class="tx-result-row d-flex justify-space-between align-center mb-2">
          <span class="text-caption text--secondary">{{ $t('mempool.fee') }}</span>
          <span class="text-caption font-weight-medium">{{ txResult.fee?.toLocaleString() }} sats · {{ feeRate(txResult) }} sat/vB</span>
        </div>
        <div class="tx-result-row d-flex justify-space-between align-center mb-2">
          <span class="text-caption text--secondary">{{ $t('mempool.size') }}</span>
          <span class="text-caption font-weight-medium">{{ txResult.size }} bytes · {{ txResult.weight }} wu</span>
        </div>
        <v-btn text color="primary" small @click="openTxOnMempool(txResult.txid)" class="mt-2 px-0">
          <v-icon left x-small>mdi-open-in-new</v-icon>
          {{ $t('mempool.openOnMempool') }}
        </v-btn>
      </div>

      <v-alert v-if="txError" type="error" outlined dense class="text-caption mt-3 mb-0" icon="mdi-alert-circle-outline">
        {{ txError }}
      </v-alert>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { toRefs } from 'vue';
import mempoolApi, { type MempoolFeeEstimates, type MempoolBlock, type MempoolTransaction } from '@/api/mempool-api';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';

const { loggedWallet } = toRefs(walletStore);

const loading = ref(false);
const fees = ref<MempoolFeeEstimates | null>(null);
const mempoolStats = ref<{ count: number; vsize: number; total_fee: number; fee_histogram: [number, number][] } | null>(null);
const blocks = ref<MempoolBlock[]>([]);
const txSearch = ref('');
const txResult = ref<MempoolTransaction | null>(null);
const txError = ref<string | null>(null);

const isTestnet = computed(() => loggedWallet.value?.network === Network.TESTNET);

const feeRates = [
  { key: 'fastestFee' as keyof MempoolFeeEstimates, label: 'Next Block', time: '~10 min', color: '#e53935' },
  { key: 'halfHourFee' as keyof MempoolFeeEstimates, label: '~30 min', time: '~30 min', color: '#fb8c00' },
  { key: 'hourFee' as keyof MempoolFeeEstimates, label: '~1 hour', time: '~60 min', color: '#43a047' },
  { key: 'economyFee' as keyof MempoolFeeEstimates, label: 'Economy', time: '1+ hour', color: '#1e88e5' },
];

const feeHistogram = computed(() => {
  if (!mempoolStats.value?.fee_histogram) return [];
  return mempoolStats.value.fee_histogram
    .map(([fee, vsize]) => ({ fee, vsize }))
    .sort((a, b) => a.fee - b.fee)
    .slice(0, 40);
});

const maxHistogramVsize = computed(() =>
  Math.max(...feeHistogram.value.map(b => b.vsize), 1)
);

function barColor(fee: number): string {
  if (fee >= (fees.value?.fastestFee ?? 999)) return '#e53935';
  if (fee >= (fees.value?.halfHourFee ?? 50)) return '#fb8c00';
  if (fee >= (fees.value?.hourFee ?? 10)) return '#43a047';
  return '#1e88e5';
}

function formatVsize(vsize: number): string {
  if (vsize > 1_000_000) return `${(vsize / 1_000_000).toFixed(1)} MB`;
  if (vsize > 1_000) return `${(vsize / 1_000).toFixed(1)} KB`;
  return `${vsize} B`;
}

function formatSize(bytes: number): string {
  if (bytes > 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000).toFixed(1)} KB`;
}

function formatBtc(sats: number): string {
  return (sats / 1e8).toFixed(8);
}

function feeRate(tx: MempoolTransaction): string {
  if (!tx.fee || !tx.weight) return '—';
  return (tx.fee / (tx.weight / 4)).toFixed(1);
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function openBlock(blockId: string) {
  window.open(mempoolApi.getBlockUrl(blockId, isTestnet.value), '_blank');
}

function openTxOnMempool(txid: string) {
  window.open(mempoolApi.getTxUrl(txid, isTestnet.value), '_blank');
}

function openMempoolSpace() {
  window.open(isTestnet.value ? 'https://mempool.space/testnet' : 'https://mempool.space', '_blank');
}

async function lookupTx() {
  if (!txSearch.value.trim()) return;
  txResult.value = null;
  txError.value = null;
  try {
    txResult.value = await mempoolApi.getTransaction(txSearch.value.trim(), isTestnet.value);
  } catch {
    txError.value = 'Transaction not found';
  }
}

async function refresh() {
  loading.value = true;
  try {
    const [feesResult, statsResult, blocksResult] = await Promise.all([
      mempoolApi.getFeeEstimates(isTestnet.value).catch(() => null),
      mempoolApi.getMempoolStats(isTestnet.value).catch(() => null),
      mempoolApi.getRecentBlocks(isTestnet.value).catch(() => null),
    ]);
    fees.value = feesResult;
    mempoolStats.value = statsResult;
    blocks.value = blocksResult || [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => refresh());
</script>

<style scoped>
.page-icon-wrapper {
  width: 42px;
  height: 42px;
  border-radius: var(--g-r-card);
  background: rgba(247, 147, 26, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.fee-rate-card {
  border-radius: var(--g-r-control) !important;
  transition: transform 0.15s ease;
}

.fee-rate-card:hover {
  transform: translateY(-2px);
}

.fee-indicator {
  width: 52px;
  height: 52px;
  border-radius: var(--g-r-control);
  border: 1px solid;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-card {
  border-radius: var(--g-r-control) !important;
}

.stat-icon-wrapper {
  width: 34px;
  height: 34px;
  border-radius: var(--g-r-control);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.block-card {
  border-radius: var(--g-r-control) !important;
  transition: transform 0.15s ease;
}

.block-card:hover {
  transform: translateX(2px);
}

.block-icon-wrapper {
  width: 34px;
  height: 34px;
  border-radius: var(--g-r-control);
  background: rgba(247, 147, 26, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tx-result-row {
  padding: 4px 0;
  border-bottom: 1px solid var(--g-hairline-1);
}

.fee-histogram {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 140px;
  overflow-x: auto;
  padding-bottom: 24px;
  position: relative;
}

.histogram-bar-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  width: 16px;
}

.histogram-bar {
  width: 12px;
  border-radius: 4px 4px 0 0;
  min-height: 4px;
  transition: height 0.3s ease, opacity 0.15s ease;
  opacity: 0.8;
}

.histogram-bar:hover {
  opacity: 1;
}

.histogram-label {
  font-size: 11px;
  color: var(--g-text-3);
  margin-top: 2px;
  transform: rotate(-60deg);
  transform-origin: top left;
  white-space: nowrap;
}
</style>