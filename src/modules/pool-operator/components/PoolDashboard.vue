<template>
  <div class="pool-dashboard">
    <!-- Empty State -->
    <div v-if="!poolId" class="empty-state">
      <div class="empty-icon-wrap">
        <v-icon size="40" color="rgba(255,255,255,0.15)">mdi-server-network-off</v-icon>
      </div>
      <h3 class="empty-title">{{ $t('poolOperator.noPoolConfigured') }}</h3>
      <p class="empty-subtitle">{{ $t('poolOperator.setupColdKeyFirst') }}</p>
    </div>

    <div v-else>
      <!-- Hero Header -->
      <div class="pool-hero liquid-glass">
        <!-- Accent glow -->
        <div class="hero-glow" />

        <div class="hero-content">
          <div class="hero-left">
            <div class="hero-ticker-row">
              <span v-if="poolInfo?.ticker" class="hero-ticker">[{{ poolInfo.ticker }}]</span>
              <span class="hero-name">{{ poolInfo?.name || $t('poolOperator.title') }}</span>
            </div>
            <div class="hero-id" @click="copyPoolId">
              <span>{{ poolId }}</span>
              <v-icon x-small color="rgba(255,255,255,0.25)" class="ml-1">mdi-content-copy</v-icon>
            </div>
            <div v-if="poolInfo?.description" class="hero-desc">{{ poolInfo.description }}</div>
          </div>

          <div class="hero-right">
            <!-- Live status indicator -->
            <div class="status-badge" :class="statusClass">
              <span class="status-dot" />
              <span>{{ statusText }}</span>
            </div>
          </div>
        </div>

        <!-- Quick Stats Bar -->
        <div v-if="isRegistered && poolInfo" class="hero-stats">
          <div class="hero-stat">
            <span class="hs-value">{{ formatAdaShort(poolInfo.live_stake) }}</span>
            <span class="hs-label">{{ $t('poolOperator.liveStake') }}</span>
          </div>
          <div class="hero-stat-divider" />
          <div class="hero-stat">
            <span class="hs-value">{{ (poolInfo.live_delegators || 0).toLocaleString() }}</span>
            <span class="hs-label">{{ $t('poolOperator.delegators') }}</span>
          </div>
          <div class="hero-stat-divider" />
          <div class="hero-stat">
            <span class="hs-value">{{ (poolInfo.block_count || 0).toLocaleString() }}</span>
            <span class="hs-label">{{ $t('poolOperator.blocksProduced') }}</span>
          </div>
          <div class="hero-stat-divider" />
          <div class="hero-stat">
            <span class="hs-value">{{ (poolInfo.ros || 0).toFixed(2) }}%</span>
            <span class="hs-label">{{ $t('poolOperator.ros') }}</span>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="stats-grid mt-3">
        <div v-for="i in 6" :key="i" class="stat-card liquid-glass-compact skeleton">
          <div class="skeleton-line" style="width: 50%; height: 10px" />
          <div class="skeleton-line" style="width: 35%; height: 20px; margin-top: 8px" />
        </div>
      </div>

      <!-- Detail Cards -->
      <div v-else-if="isRegistered" class="stats-grid mt-3">
        <div class="stat-card liquid-glass-compact">
          <div class="sc-header">
            <v-icon size="14" color="#2DF0F7">mdi-hand-coin</v-icon>
            <span class="sc-label">{{ $t('poolOperator.pledge') }}</span>
          </div>
          <div class="sc-value">{{ formatAda(registeredParams?.pledge) }} <span class="sc-unit">ADA</span></div>
          <div v-if="poolInfo?.live_pledge != null" class="sc-sub" :class="pledgeMet ? 'sc-sub--ok' : 'sc-sub--warn'">
            {{ $t('poolOperator.live') }}: {{ formatAda(poolInfo.live_pledge) }}
            <v-icon x-small :color="pledgeMet ? '#75E0A7' : '#FDA29B'">{{ pledgeMet ? 'mdi-check' : 'mdi-alert' }}</v-icon>
          </div>
        </div>

        <div class="stat-card liquid-glass-compact">
          <div class="sc-header">
            <v-icon size="14" color="#FDB022">mdi-currency-usd</v-icon>
            <span class="sc-label">{{ $t('poolOperator.cost') }}</span>
          </div>
          <div class="sc-value">{{ formatAda(registeredParams?.cost) }} <span class="sc-unit">ADA</span></div>
        </div>

        <div class="stat-card liquid-glass-compact">
          <div class="sc-header">
            <v-icon size="14" color="#A078FF">mdi-percent</v-icon>
            <span class="sc-label">{{ $t('poolOperator.margin') }}</span>
          </div>
          <div class="sc-value">{{ formatMargin(registeredParams?.margin) }}<span class="sc-unit">%</span></div>
        </div>

        <div v-if="poolInfo" class="stat-card liquid-glass-compact">
          <div class="sc-header">
            <v-icon size="14" color="#00c7f3">mdi-gauge</v-icon>
            <span class="sc-label">{{ $t('poolOperator.saturation') }}</span>
          </div>
          <div class="sc-value">{{ (poolInfo.live_saturation || 0).toFixed(1) }}<span class="sc-unit">%</span></div>
          <div class="sat-bar-wrap">
            <div class="sat-bar-track">
              <div class="sat-bar-fill" :style="{ width: Math.min(poolInfo.live_saturation || 0, 100) + '%' }" />
            </div>
          </div>
        </div>

        <div v-if="poolInfo" class="stat-card liquid-glass-compact">
          <div class="sc-header">
            <v-icon size="14" color="#00ffd1">mdi-access-point-network</v-icon>
            <span class="sc-label">{{ $t('poolOperator.relays') }}</span>
          </div>
          <div class="sc-value">{{ registeredParams?.relays?.length || 0 }}</div>
        </div>
      </div>

      <!-- Refresh -->
      <div class="text-center mt-2" v-if="poolId">
        <v-btn text x-small class="refresh-btn" @click="fetchPoolData" :loading="loading">
          <v-icon x-small class="mr-1">mdi-refresh</v-icon>
          {{ $t('common.refresh') }}
        </v-btn>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, toRefs, computed, onMounted, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { walletStore } from '@/stores/walletStore';
import blockchainApi from '@/api/blockchain-api';
import snackbar from '@/plugins/snackbar';

const { t } = useTranslation();
const { poolId, isRegistered, isRetiring, retirementEpoch, registeredParams } = toRefs(poolOperatorStore);
const { loggedWallet } = toRefs(walletStore);

const loading = ref(false);
const poolInfo = ref<any>(null);
const pledgeMet = ref(true);

const statusClass = computed(() => {
  if (isRetiring.value) return 'status--retiring';
  if (isRegistered.value) return 'status--active';
  return 'status--inactive';
});

const statusText = computed(() => {
  if (isRetiring.value) return `${t('poolOperator.retiring')} ${t('poolOperator.epoch')} ${retirementEpoch.value}`;
  if (isRegistered.value) return t('poolOperator.registered');
  return t('poolOperator.notRegistered');
});

function formatAda(lovelace: any): string {
  if (!lovelace && lovelace !== 0) return '0';
  return (Number(lovelace) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatAdaShort(lovelace: any): string {
  if (!lovelace) return '0';
  const ada = Number(lovelace) / 1_000_000;
  if (ada >= 1_000_000) return (ada / 1_000_000).toFixed(2) + 'M';
  if (ada >= 1_000) return (ada / 1_000).toFixed(0) + 'K';
  return ada.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatMargin(margin: any): string {
  if (!margin || !margin.denominator) return '0';
  const val = (margin.numerator / margin.denominator) * 100;
  return isNaN(val) ? '0' : val.toFixed(2);
}

function copyPoolId() {
  if (poolId.value) {
    navigator.clipboard.writeText(poolId.value);
    snackbar.fireSuccess(t('poolOperator.poolIdCopied'));
  }
}

async function fetchPoolData() {
  if (!poolId.value || !loggedWallet.value) return;
  loading.value = true;
  try {
    const data = await blockchainApi.getPoolById(poolId.value, loggedWallet.value.chain, loggedWallet.value.network);
    if (data) {
      poolInfo.value = data;
      poolOperatorStore.isRegistered = true;
      if (data.live_pledge != null && data.pledge != null) {
        pledgeMet.value = Number(data.live_pledge) >= Number(data.pledge);
      }
      if (data.pledge != null) {
        poolOperatorStore.registeredParams = {
          pledge: data.pledge,
          cost: data.fixed_cost || data.cost,
          margin: data.margin_of_cost != null
            ? { numerator: Math.round(data.margin_of_cost * 10000), denominator: 10000 }
            : data.margin,
          relays: data.relays || [],
          owners: data.owners || [],
        };
      }
    }
  } catch (e: any) {
    if (e.message?.includes('404') || e.response?.status === 404) {
      poolOperatorStore.isRegistered = false;
      poolInfo.value = null;
    } else {
      console.warn('Failed to fetch pool data:', e);
    }
  } finally {
    loading.value = false;
  }
}

onMounted(() => { if (poolId.value) fetchPoolData(); });
watch(poolId, (id) => { if (id) fetchPoolData(); });
</script>

<style scoped>
.pool-dashboard {
  padding: 4px;
}

/* Empty state */
.empty-state {
  text-align: center;
  padding: 56px 16px;
}
.empty-icon-wrap {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
}
.empty-title {
  color: rgba(255,255,255,0.4);
  font-size: 15px;
  font-weight: 600;
}
.empty-subtitle {
  color: rgba(255,255,255,0.2);
  font-size: 12px;
}

/* Hero Card */
.pool-hero {
  position: relative;
  padding: 20px;
  overflow: hidden;
}

.hero-glow {
  position: absolute;
  top: -40px;
  right: -40px;
  width: 160px;
  height: 160px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(45, 240, 247, 0.08) 0%, transparent 70%);
  pointer-events: none;
}

.hero-content {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  position: relative;
  z-index: 1;
}

.hero-ticker-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.hero-ticker {
  font-size: 22px;
  font-weight: 800;
  background: linear-gradient(135deg, #2DF0F7, #00ffd1);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-name {
  font-size: 18px;
  font-weight: 600;
  color: rgba(255,255,255,0.9);
}

.hero-id {
  display: inline-flex;
  align-items: center;
  margin-top: 6px;
  cursor: pointer;
  font-family: 'Roboto Mono', monospace;
  font-size: 10px;
  color: rgba(255,255,255,0.28);
  word-break: break-all;
  transition: color 0.15s;
  line-height: 1.4;
}
.hero-id:hover { color: rgba(255,255,255,0.5); }

.hero-desc {
  font-size: 12px;
  color: rgba(255,255,255,0.35);
  margin-top: 8px;
  line-height: 1.5;
  max-width: 500px;
}

/* Status badge */
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  white-space: nowrap;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.status--active {
  background: rgba(117,224,167,0.12);
  color: #75E0A7;
}
.status--active .status-dot {
  background: #75E0A7;
  box-shadow: 0 0 6px rgba(117,224,167,0.6);
  animation: livePulse 2s ease-in-out infinite;
}
.status--retiring {
  background: rgba(253,162,155,0.12);
  color: #FDA29B;
}
.status--retiring .status-dot {
  background: #FDA29B;
}
.status--inactive {
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.35);
}
.status--inactive .status-dot {
  background: rgba(255,255,255,0.2);
}

@keyframes livePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* Hero Stats Bar */
.hero-stats {
  display: flex;
  align-items: center;
  gap: 0;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid rgba(255,255,255,0.06);
  position: relative;
  z-index: 1;
}

.hero-stat {
  flex: 1;
  text-align: center;
}

.hero-stat-divider {
  width: 1px;
  height: 28px;
  background: rgba(255,255,255,0.06);
}

.hs-value {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: rgba(255,255,255,0.95);
  font-variant-numeric: tabular-nums;
}

.hs-label {
  display: block;
  font-size: 10px;
  color: rgba(255,255,255,0.3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 2px;
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

@media (max-width: 600px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
}

.stat-card {
  padding: 14px;
  transition: border-color 0.2s;
}
.stat-card:hover {
  border-color: rgba(255,255,255,0.15) !important;
}

.sc-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.sc-label {
  font-size: 10px;
  color: rgba(255,255,255,0.35);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  font-weight: 600;
}

.sc-value {
  font-size: 20px;
  font-weight: 700;
  color: rgba(255,255,255,0.95);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.sc-unit {
  font-size: 11px;
  font-weight: 500;
  color: rgba(255,255,255,0.3);
}

.sc-sub {
  font-size: 10px;
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 3px;
}
.sc-sub--ok { color: #75E0A7; }
.sc-sub--warn { color: #FDA29B; }

/* Saturation bar */
.sat-bar-wrap { margin-top: 8px; }
.sat-bar-track {
  height: 4px;
  background: rgba(255,255,255,0.06);
  border-radius: 2px;
  overflow: hidden;
}
.sat-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #00c7f3, #00ffd1);
  border-radius: 2px;
  transition: width 0.6s ease;
}

/* Skeleton */
.stat-card.skeleton { display: flex; flex-direction: column; gap: 0; }
.skeleton-line {
  background: linear-gradient(90deg,
    rgba(255,255,255,0.04) 25%,
    rgba(255,255,255,0.08) 50%,
    rgba(255,255,255,0.04) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.2s ease infinite;
  border-radius: 4px;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Refresh */
.refresh-btn {
  text-transform: none !important;
  letter-spacing: normal !important;
  font-size: 11px !important;
  color: rgba(255,255,255,0.3) !important;
}
.refresh-btn:hover {
  color: rgba(255,255,255,0.6) !important;
}
</style>
