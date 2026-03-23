<template>
  <div class="epoch-history">
    <div class="section-header">
      <div class="section-title">
        <v-icon size="16" color="#2DF0F7" class="mr-2">mdi-chart-timeline-variant</v-icon>
        {{ $t('poolOperator.epochHistory') }}
      </div>
      <v-btn text x-small class="refresh-btn" @click="fetchHistory" :loading="loading">
        <v-icon x-small class="mr-1">mdi-refresh</v-icon>
      </v-btn>
    </div>

    <!-- Loading -->
    <div v-if="loading && !history.length" class="text-center py-6">
      <v-progress-circular indeterminate color="primary" size="24" />
    </div>

    <!-- History Table -->
    <div v-else-if="history.length" class="epoch-table-wrap">
      <table class="epoch-table">
        <thead>
          <tr>
            <th>{{ $t('poolOperator.epoch') }}</th>
            <th class="text-right">{{ $t('poolOperator.blocksProduced') }}</th>
            <th class="text-right">{{ $t('poolOperator.expected') }}</th>
            <th class="text-right">{{ $t('poolOperator.luck') }}</th>
            <th class="text-right">{{ $t('poolOperator.rewards') }}</th>
            <th class="text-right">{{ $t('poolOperator.delegators') }}</th>
            <th class="text-right">{{ $t('poolOperator.ros') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="epoch in history" :key="epoch.epoch_no" class="epoch-row" @click="selectEpoch(epoch)">
            <td>
              <span class="epoch-num">{{ epoch.epoch_no }}</span>
            </td>
            <td class="text-right">
              <span class="block-count" :class="blockCountClass(epoch)">{{ epoch.block_cnt }}</span>
            </td>
            <td class="text-right num-muted">{{ expectedBlocks(epoch).toFixed(1) }}</td>
            <td class="text-right">
              <span class="luck-badge" :class="luckClass(epoch)">
                {{ luckPct(epoch).toFixed(0) }}%
              </span>
            </td>
            <td class="text-right num-value">{{ formatAdaShort(epoch.pool_fees) }}</td>
            <td class="text-right num-muted">{{ epoch.delegator_cnt }}</td>
            <td class="text-right">
              <span class="ros-value" :class="epoch.epoch_ros > 0 ? 'text-success' : ''">
                {{ epoch.epoch_ros ? epoch.epoch_ros.toFixed(2) : '0' }}%
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Empty -->
    <div v-else class="text-center py-4">
      <span class="empty-text">{{ $t('poolOperator.noEpochHistory') }}</span>
    </div>

    <!-- Block Detail Drawer -->
    <v-dialog v-model="showBlockDetail" max-width="500px">
      <v-card class="block-detail-card">
        <v-card-title class="d-flex align-center" style="border-bottom: 1px solid rgba(255,255,255,0.06)">
          <v-icon size="18" color="#2DF0F7" class="mr-2">mdi-cube-outline</v-icon>
          {{ $t('poolOperator.epoch') }} {{ selectedEpoch?.epoch_no }} — {{ $t('poolOperator.blocks') }}
          <v-spacer />
          <v-btn icon small @click="showBlockDetail = false">
            <v-icon small>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <v-card-text class="pt-3">
          <div v-if="blocksLoading" class="text-center py-4">
            <v-progress-circular indeterminate color="primary" size="24" />
          </div>
          <div v-else-if="epochBlocks.length">
            <div v-for="block in epochBlocks" :key="block.block_hash" class="block-item">
              <div class="block-slot">
                <v-icon x-small color="rgba(255,255,255,0.3)" class="mr-1">mdi-clock-outline</v-icon>
                {{ $t('poolOperator.slot') }} {{ block.epoch_slot }}
              </div>
              <div class="block-info">
                <span class="block-height">#{{ block.block_height }}</span>
                <span class="block-time">{{ formatTime(block.block_time) }}</span>
              </div>
              <div class="block-hash" @click="copyHash(block.block_hash)">
                {{ block.block_hash.substring(0, 16) }}...
                <v-icon x-small color="rgba(255,255,255,0.2)">mdi-content-copy</v-icon>
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
import { ref, toRefs, onMounted, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { walletStore } from '@/stores/walletStore';
import spoApi, { PoolEpochHistory, PoolBlock } from '@/api/spo-api';
import snackbar from '@/plugins/snackbar';

const { t } = useTranslation();
const { poolId } = toRefs(poolOperatorStore);
const { loggedWallet } = toRefs(walletStore);

const loading = ref(false);
const history = ref<PoolEpochHistory[]>([]);
const showBlockDetail = ref(false);
const selectedEpoch = ref<PoolEpochHistory | null>(null);
const epochBlocks = ref<PoolBlock[]>([]);
const blocksLoading = ref(false);

// Epoch total blocks cache (for expected block calculation)
const epochInfoCache = ref<Record<number, number>>({});

function expectedBlocks(epoch: PoolEpochHistory): number {
  const pct = epoch.active_stake_pct;
  if (!pct) return 0;
  // Use ~21600 as average total blocks per epoch (432000 slots * 0.05 activeSlotCoeff)
  const totalBlocks = epochInfoCache.value[epoch.epoch_no] || 21600;
  return spoApi.calculateExpectedBlocks(pct, totalBlocks);
}

function luckPct(epoch: PoolEpochHistory): number {
  const expected = expectedBlocks(epoch);
  return spoApi.calculateLuck(epoch.block_cnt, expected);
}

function blockCountClass(epoch: PoolEpochHistory): string {
  if (epoch.block_cnt === 0) return 'text-muted';
  const luck = luckPct(epoch);
  if (luck >= 120) return 'text-great';
  if (luck >= 80) return 'text-good';
  return 'text-warn';
}

function luckClass(epoch: PoolEpochHistory): string {
  const luck = luckPct(epoch);
  if (luck >= 120) return 'luck--great';
  if (luck >= 80) return 'luck--good';
  if (luck > 0) return 'luck--low';
  return 'luck--none';
}

function formatAdaShort(lovelace: string | null): string {
  if (!lovelace) return '0';
  const ada = Number(lovelace) / 1_000_000;
  if (ada >= 1_000) return (ada / 1_000).toFixed(1) + 'K';
  return ada.toFixed(0);
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
    history.value = await spoApi.getPoolHistory(poolId.value, loggedWallet.value.network, 20);
  } catch (e) {
    console.warn('Failed to fetch pool history:', e);
  } finally {
    loading.value = false;
  }
}

async function selectEpoch(epoch: PoolEpochHistory) {
  selectedEpoch.value = epoch;
  showBlockDetail.value = true;
  blocksLoading.value = true;
  try {
    epochBlocks.value = await spoApi.getPoolBlocks(poolId.value!, loggedWallet.value!.network, epoch.epoch_no);
  } catch (e) {
    console.warn('Failed to fetch epoch blocks:', e);
    epochBlocks.value = [];
  } finally {
    blocksLoading.value = false;
  }
}

onMounted(() => { if (poolId.value) fetchHistory(); });
watch(poolId, (id) => { if (id) fetchHistory(); });
</script>

<style scoped>
.epoch-history {
  margin-top: 12px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255,255,255,0.6);
  display: flex;
  align-items: center;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.refresh-btn {
  text-transform: none !important;
  letter-spacing: normal !important;
  color: rgba(255,255,255,0.3) !important;
}

/* Table */
.epoch-table-wrap {
  overflow-x: auto;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.06);
}

.epoch-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.epoch-table thead th {
  background: rgba(10, 14, 20, 0.8);
  backdrop-filter: blur(10px);
  color: rgba(255,255,255,0.4);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 10px;
  font-weight: 600;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  white-space: nowrap;
  position: sticky;
  top: 0;
}

.epoch-row {
  cursor: pointer;
  transition: background 0.15s;
}

.epoch-row:hover {
  background: rgba(0, 199, 243, 0.04);
}

.epoch-row td {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.03);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.epoch-num {
  font-weight: 600;
  color: rgba(255,255,255,0.7);
}

.block-count {
  font-weight: 700;
}

.text-great { color: #75E0A7; }
.text-good { color: rgba(255,255,255,0.9); }
.text-warn { color: #FDA29B; }
.text-muted { color: rgba(255,255,255,0.25); }
.text-success { color: #75E0A7; }

.num-value {
  color: rgba(255,255,255,0.8);
  font-weight: 500;
}

.num-muted {
  color: rgba(255,255,255,0.35);
}

/* Luck badge */
.luck-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
}

.luck--great { background: rgba(117,224,167,0.12); color: #75E0A7; }
.luck--good { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.7); }
.luck--low { background: rgba(253,162,155,0.12); color: #FDA29B; }
.luck--none { background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.2); }

.ros-value { font-weight: 600; }

.empty-text {
  color: rgba(255,255,255,0.25);
  font-size: 12px;
}

/* Block Detail Dialog */
.block-detail-card {
  background: #13161b !important;
  border: 1px solid rgba(255,255,255,0.08);
}

.block-item {
  padding: 10px 0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.block-item:last-child { border-bottom: none; }

.block-slot {
  font-size: 10px;
  color: rgba(255,255,255,0.35);
  display: flex;
  align-items: center;
}

.block-info {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 2px;
}

.block-height {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255,255,255,0.9);
}

.block-time {
  font-size: 11px;
  color: rgba(255,255,255,0.4);
}

.block-hash {
  font-family: 'Roboto Mono', monospace;
  font-size: 10px;
  color: rgba(255,255,255,0.2);
  margin-top: 2px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: color 0.15s;
}
.block-hash:hover { color: rgba(255,255,255,0.5); }
</style>
