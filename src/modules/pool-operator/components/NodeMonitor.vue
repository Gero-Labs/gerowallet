<template>
  <div class="node-monitor">
    <div class="section-header">
      <div class="section-title">
        <v-icon size="16" color="#75E0A7" class="mr-2">mdi-server</v-icon>
        {{ $t('poolOperator.nodeMonitor') }}
        <span v-if="connected" class="live-indicator">
          <span class="live-dot" />
          {{ $t('poolOperator.live') }}
        </span>
      </div>
      <div class="header-actions">
        <v-btn v-if="configured" text x-small class="action-btn" @click="pollNode" :loading="polling">
          <v-icon x-small class="mr-1">mdi-refresh</v-icon>
        </v-btn>
        <v-btn text x-small class="action-btn" @click="showConfig = true">
          <v-icon x-small>mdi-cog</v-icon>
        </v-btn>
      </div>
    </div>

    <!-- Not configured -->
    <div v-if="!configured" class="node-setup liquid-glass-compact">
      <div class="setup-content">
        <v-icon size="32" color="rgba(255,255,255,0.15)" class="mb-3">mdi-server-off</v-icon>
        <div class="setup-title">{{ $t('poolOperator.nodeNotConfigured') }}</div>
        <div class="setup-text">{{ $t('poolOperator.nodeSetupDescription') }}</div>
        <v-btn small color="#75E0A7" class="mt-3 black--text" style="text-transform: none; border-radius: 8px" @click="showConfig = true">
          {{ $t('poolOperator.connectNode') }}
        </v-btn>
      </div>
    </div>

    <!-- Connected — Node Stats -->
    <template v-else>
      <!-- Connection error -->
      <div v-if="configured && !connected && !polling" class="node-error liquid-glass-compact">
        <v-icon size="16" color="#FDA29B" class="mr-2">mdi-close-network</v-icon>
        <div>
          <span style="font-size: 12px; color: #FDA29B">{{ $t('poolOperator.offline') }}</span>
          <span style="font-size: 11px; color: rgba(255,255,255,0.3); display: block">{{ nodeUrl }}</span>
        </div>
      </div>

      <!-- Stats Grid -->
      <div v-if="nodeData" class="node-stats-grid">
        <!-- Status + Version -->
        <div class="node-stat liquid-glass-compact stat-wide">
          <div class="stat-row">
            <div class="stat-item">
              <v-icon size="12" :color="connected ? '#75E0A7' : '#FDA29B'">{{ connected ? 'mdi-check-circle' : 'mdi-close-circle' }}</v-icon>
              <span class="ns-value-sm" :class="connected ? 'text-ok' : 'text-err'">{{ connected ? $t('poolOperator.online') : $t('poolOperator.offline') }}</span>
            </div>
            <div class="stat-item">
              <v-icon size="12" color="rgba(255,255,255,0.3)">mdi-tag</v-icon>
              <span class="ns-value-sm">{{ nodeData.nodeVersion }}</span>
            </div>
            <div class="stat-item">
              <v-icon size="12" color="rgba(255,255,255,0.3)">mdi-clock-outline</v-icon>
              <span class="ns-value-sm">{{ formatUptime(nodeData.uptimeSeconds) }}</span>
            </div>
          </div>
        </div>

        <!-- Block Height -->
        <div class="node-stat liquid-glass-compact">
          <v-icon size="14" color="#2DF0F7">mdi-cube-outline</v-icon>
          <div class="ns-content">
            <span class="ns-label">{{ $t('poolOperator.nodeTip') }}</span>
            <span class="ns-value">{{ nodeData.blockHeight?.toLocaleString() }}</span>
          </div>
        </div>

        <!-- KES Remaining -->
        <div class="node-stat liquid-glass-compact" :class="{ 'stat-critical': isKesCritical }">
          <v-icon size="14" :color="kesColor">mdi-key-chain</v-icon>
          <div class="ns-content">
            <span class="ns-label">{{ $t('poolOperator.kesRemaining') }}</span>
            <span class="ns-value" :class="kesTextClass">{{ nodeData.kesRemaining ?? '--' }}</span>
            <span v-if="isKesCritical" class="ns-warn">{{ $t('poolOperator.kesRotationNeeded') }}</span>
          </div>
        </div>

        <!-- Peers -->
        <div class="node-stat liquid-glass-compact">
          <v-icon size="14" color="#A078FF">mdi-account-group</v-icon>
          <div class="ns-content">
            <span class="ns-label">{{ $t('poolOperator.peers') }}</span>
            <span class="ns-value">{{ nodeData.peers }}</span>
          </div>
        </div>

        <!-- Memory -->
        <div class="node-stat liquid-glass-compact">
          <v-icon size="14" color="#00ffd1">mdi-memory</v-icon>
          <div class="ns-content">
            <span class="ns-label">{{ $t('poolOperator.memory') }}</span>
            <span class="ns-value">{{ formatMemory(nodeData.memoryMb) }}</span>
          </div>
        </div>

        <!-- CPU -->
        <div class="node-stat liquid-glass-compact">
          <v-icon size="14" color="#FDB022">mdi-cpu-64-bit</v-icon>
          <div class="ns-content">
            <span class="ns-label">CPU</span>
            <span class="ns-value">{{ nodeData.cpuPercent?.toFixed(1) }}%</span>
          </div>
        </div>

        <!-- Mempool -->
        <div class="node-stat liquid-glass-compact">
          <v-icon size="14" color="#FDA29B">mdi-tray-full</v-icon>
          <div class="ns-content">
            <span class="ns-label">{{ $t('poolOperator.mempool') }}</span>
            <span class="ns-value">{{ nodeData.mempoolTxs }} <span class="ns-unit">txs</span></span>
          </div>
        </div>

        <!-- Epoch Progress -->
        <div class="node-stat liquid-glass-compact stat-wide">
          <div class="ns-content" style="width: 100%">
            <div class="epoch-progress-header">
              <span class="ns-label">{{ $t('poolOperator.epoch') }} {{ nodeData.epoch }}</span>
              <span class="ns-label">{{ epochProgressPct }}%</span>
            </div>
            <div class="epoch-bar-track">
              <div class="epoch-bar-fill" :style="{ width: epochProgressPct + '%' }" />
            </div>
            <div class="epoch-progress-footer">
              <span class="ns-sub">{{ $t('poolOperator.slot') }} {{ nodeData.epochSlot?.toLocaleString() }}</span>
              <span class="ns-sub">{{ formatTimeRemaining(nodeData.epochSlotsRemaining) }} {{ $t('poolOperator.remaining') }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Configuration Dialog -->
    <v-dialog v-model="showConfig" max-width="450px">
      <v-card class="config-card">
        <v-card-title style="border-bottom: 1px solid rgba(255,255,255,0.06)">
          {{ $t('poolOperator.nodeMonitorSetup') }}
          <v-spacer />
          <v-btn icon small @click="showConfig = false"><v-icon small>mdi-close</v-icon></v-btn>
        </v-card-title>
        <v-card-text class="pt-4">
          <div class="config-hint mb-3">{{ $t('poolOperator.nodeMonitorSetupDescription') }}</div>

          <v-text-field
            v-model="nodeUrl"
            :label="$t('poolOperator.nodeEndpoint')"
            placeholder="http://10.0.0.35:12799"
            outlined dense dark hide-details
            class="glass-input"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn text @click="showConfig = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="#75E0A7" class="black--text" :disabled="!nodeUrl" @click="saveConfig" style="text-transform: none">
            {{ $t('poolOperator.connect') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRefs, onMounted, onUnmounted } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { walletStore } from '@/stores/walletStore';
import snackbar from '@/plugins/snackbar';

const { t } = useTranslation();
const { poolId } = toRefs(poolOperatorStore);

const configured = ref(false);
const connected = ref(false);
const nodeUrl = ref('');
const showConfig = ref(false);
const polling = ref(false);
let pollInterval: ReturnType<typeof setInterval> | null = null;

interface NodeData {
  blockHeight: number;
  slotNo: number;
  epoch: number;
  epochSlot: number;
  epochSlotsRemaining: number;
  syncProgress: number;
  kesRemaining: number | null;
  kesPeriod: number | null;
  peers: number;
  mempoolTxs: number;
  mempoolBytes: number;
  memoryMb: number;
  cpuPercent: number;
  uptimeSeconds: number;
  nodeVersion: string;
  timestamp: number;
}

const nodeData = ref<NodeData | null>(null);

const isKesCritical = computed(() => nodeData.value?.kesRemaining != null && nodeData.value.kesRemaining < 50);
const kesColor = computed(() => {
  const r = nodeData.value?.kesRemaining;
  if (r == null) return 'rgba(255,255,255,0.3)';
  if (r < 20) return '#FDA29B';
  if (r < 50) return '#FDB022';
  return '#75E0A7';
});
const kesTextClass = computed(() => {
  const r = nodeData.value?.kesRemaining;
  if (r == null) return '';
  if (r < 20) return 'text-err';
  if (r < 50) return 'text-warn';
  return 'text-ok';
});

const epochProgressPct = computed(() => {
  if (!nodeData.value) return 0;
  const total = nodeData.value.epochSlot + nodeData.value.epochSlotsRemaining;
  if (total === 0) return 0;
  return ((nodeData.value.epochSlot / total) * 100).toFixed(1);
});

function formatUptime(seconds: number): string {
  if (!seconds) return '--';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatMemory(mb: number): string {
  if (!mb) return '--';
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
  return mb + ' MB';
}

function formatTimeRemaining(slots: number): string {
  if (!slots) return '--';
  const hours = Math.floor(slots / 3600);
  const mins = Math.floor((slots % 3600) / 60);
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${hours}h ${mins}m`;
}

async function pollNode() {
  if (!nodeUrl.value) return;
  polling.value = true;
  try {
    const response = await fetch(nodeUrl.value + '/status', { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      nodeData.value = await response.json();
      connected.value = true;
    } else {
      connected.value = false;
    }
  } catch {
    connected.value = false;
  } finally {
    polling.value = false;
  }
}

async function saveConfig() {
  if (!nodeUrl.value) return;

  const walletId = walletStore.loggedWallet?.id;
  if (walletId) {
    const { setWalletConfiguration } = await import('@/db/wallet-db');
    await setWalletConfiguration(walletId, 'spo_nodeMonitorUrl', nodeUrl.value);
  }

  configured.value = true;
  showConfig.value = false;
  await pollNode();

  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(pollNode, 30_000);

  snackbar.fireSuccess(t('poolOperator.nodeConnected'));
}

async function loadConfig() {
  const walletId = walletStore.loggedWallet?.id;
  if (!walletId) return;

  try {
    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(walletId);
    const entry = await db.table('config').where({ key: 'spo_nodeMonitorUrl' }).first();
    if (entry?.value) {
      nodeUrl.value = entry.value;
      configured.value = true;
      await pollNode();
      pollInterval = setInterval(pollNode, 30_000);
    }
  } catch (e) {
    console.warn('Failed to load node monitor config:', e);
  }
}

onMounted(() => { if (poolId.value) loadConfig(); });
onUnmounted(() => { if (pollInterval) clearInterval(pollInterval); });
</script>

<style scoped>
.node-monitor {
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
  gap: 4px;
}

.header-actions {
  display: flex;
  gap: 2px;
}

.action-btn {
  text-transform: none !important;
  letter-spacing: normal !important;
  color: rgba(255,255,255,0.3) !important;
  min-width: 28px !important;
  padding: 0 4px !important;
}

.live-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #75E0A7;
  text-transform: none;
  letter-spacing: normal;
  font-weight: 500;
}

.live-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #75E0A7;
  box-shadow: 0 0 6px rgba(117,224,167,0.6);
  animation: livePulse 2s ease-in-out infinite;
}

@keyframes livePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* Setup */
.node-setup {
  text-align: center;
  padding: 24px;
}

.setup-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255,255,255,0.6);
}

.setup-text {
  font-size: 11px;
  color: rgba(255,255,255,0.3);
  line-height: 1.5;
  max-width: 360px;
  margin: 4px auto 0;
}

/* Error */
.node-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  margin-bottom: 8px;
  border-color: rgba(253,162,155,0.15) !important;
}

/* Stats Grid */
.node-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

@media (max-width: 500px) {
  .node-stats-grid { grid-template-columns: repeat(2, 1fr); }
}

.stat-wide {
  grid-column: 1 / -1;
}

.node-stat {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  transition: border-color 0.2s;
}

.node-stat:hover { border-color: rgba(255,255,255,0.12) !important; }
.node-stat.stat-critical { border-color: rgba(253,162,155,0.2) !important; }

/* Status row */
.stat-row {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ns-value-sm {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255,255,255,0.7);
}

.ns-content { display: flex; flex-direction: column; }

.ns-label {
  font-size: 10px;
  color: rgba(255,255,255,0.35);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.ns-value {
  font-size: 15px;
  font-weight: 700;
  color: rgba(255,255,255,0.9);
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
}

.ns-unit {
  font-size: 10px;
  font-weight: 400;
  color: rgba(255,255,255,0.3);
}

.ns-warn {
  font-size: 9px;
  color: #FDA29B;
  font-weight: 600;
  margin-top: 2px;
}

.ns-sub {
  font-size: 10px;
  color: rgba(255,255,255,0.25);
}

.text-ok { color: #75E0A7; }
.text-warn { color: #FDB022; }
.text-err { color: #FDA29B; }

/* Epoch progress */
.epoch-progress-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
}

.epoch-bar-track {
  height: 4px;
  background: rgba(255,255,255,0.06);
  border-radius: 2px;
  overflow: hidden;
}

.epoch-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #00c7f3, #00ffd1);
  border-radius: 2px;
  transition: width 0.6s ease;
}

.epoch-progress-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
}

/* Config dialog */
.config-card {
  background: #13161b !important;
  border: 1px solid rgba(255,255,255,0.08);
}

.config-hint {
  font-size: 12px;
  color: rgba(255,255,255,0.4);
  line-height: 1.5;
}

.glass-input >>> .v-input__slot {
  background: rgba(255,255,255,0.04) !important;
  border-color: rgba(255,255,255,0.08) !important;
}
</style>
