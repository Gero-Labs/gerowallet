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
      <v-btn v-if="!configured" text x-small class="configure-btn" @click="showConfig = true">
        <v-icon x-small class="mr-1">mdi-cog</v-icon>
        {{ $t('poolOperator.configure') }}
      </v-btn>
      <v-btn v-else text x-small class="refresh-btn" @click="pollNode" :loading="polling">
        <v-icon x-small class="mr-1">mdi-refresh</v-icon>
      </v-btn>
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
    <div v-else class="node-stats-grid">
      <div class="node-stat liquid-glass-compact" :class="{ 'stat-error': !connected }">
        <v-icon size="14" :color="connected ? '#75E0A7' : '#FDA29B'">{{ connected ? 'mdi-check-network' : 'mdi-close-network' }}</v-icon>
        <div class="ns-content">
          <span class="ns-label">{{ $t('poolOperator.nodeStatus') }}</span>
          <span class="ns-value" :class="connected ? 'text-ok' : 'text-err'">{{ connected ? $t('poolOperator.online') : $t('poolOperator.offline') }}</span>
        </div>
      </div>

      <div class="node-stat liquid-glass-compact">
        <v-icon size="14" color="#2DF0F7">mdi-cube-outline</v-icon>
        <div class="ns-content">
          <span class="ns-label">{{ $t('poolOperator.nodeTip') }}</span>
          <span class="ns-value">{{ nodeData?.blockHeight?.toLocaleString() || '--' }}</span>
        </div>
      </div>

      <div class="node-stat liquid-glass-compact">
        <v-icon size="14" color="#FDB022">mdi-key-chain</v-icon>
        <div class="ns-content">
          <span class="ns-label">{{ $t('poolOperator.kesRemaining') }}</span>
          <span class="ns-value" :class="kesRemainingClass">{{ nodeData?.kesRemaining ?? '--' }}</span>
        </div>
      </div>

      <div class="node-stat liquid-glass-compact">
        <v-icon size="14" color="#A078FF">mdi-account-group</v-icon>
        <div class="ns-content">
          <span class="ns-label">{{ $t('poolOperator.peers') }}</span>
          <span class="ns-value">{{ nodeData?.peers ?? '--' }}</span>
        </div>
      </div>

      <div class="node-stat liquid-glass-compact">
        <v-icon size="14" color="#00ffd1">mdi-memory</v-icon>
        <div class="ns-content">
          <span class="ns-label">{{ $t('poolOperator.memory') }}</span>
          <span class="ns-value">{{ nodeData?.memoryMb ? nodeData.memoryMb + ' MB' : '--' }}</span>
        </div>
      </div>

      <div class="node-stat liquid-glass-compact">
        <v-icon size="14" color="#FDA29B">mdi-email-outline</v-icon>
        <div class="ns-content">
          <span class="ns-label">{{ $t('poolOperator.mempool') }}</span>
          <span class="ns-value">{{ nodeData?.mempoolTxs ?? '--' }} txs</span>
        </div>
      </div>
    </div>

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
            placeholder="http://your-node-ip:12798"
            outlined dense dark hide-details
            class="glass-input"
          />

          <div class="config-code mt-4">
            <div class="code-label">{{ $t('poolOperator.quickSetup') }}</div>
            <pre class="code-block">curl -sSL https://gerowallet.io/node-monitor.sh | bash</pre>
          </div>
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
  kesRemaining: number;
  peers: number;
  memoryMb: number;
  mempoolTxs: number;
  uptime: number;
}

const nodeData = ref<NodeData | null>(null);

const kesRemainingClass = computed(() => {
  if (!nodeData.value?.kesRemaining) return '';
  if (nodeData.value.kesRemaining < 50) return 'text-err';
  if (nodeData.value.kesRemaining < 200) return 'text-warn';
  return 'text-ok';
});

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

  // Save to wallet DB
  const walletId = walletStore.loggedWallet?.id;
  if (walletId) {
    const { setWalletConfiguration } = await import('@/db/wallet-db');
    await setWalletConfiguration(walletId, 'spo_nodeMonitorUrl', nodeUrl.value);
  }

  configured.value = true;
  showConfig.value = false;
  await pollNode();

  // Start polling every 30s
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

.configure-btn, .refresh-btn {
  text-transform: none !important;
  letter-spacing: normal !important;
  color: rgba(255,255,255,0.3) !important;
  font-size: 11px !important;
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

/* Stats Grid */
.node-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

@media (max-width: 500px) {
  .node-stats-grid { grid-template-columns: repeat(2, 1fr); }
}

.node-stat {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  transition: border-color 0.2s;
}

.node-stat:hover { border-color: rgba(255,255,255,0.12) !important; }
.node-stat.stat-error { border-color: rgba(253,162,155,0.15) !important; }

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

.text-ok { color: #75E0A7; }
.text-warn { color: #FDB022; }
.text-err { color: #FDA29B; }

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

.config-code {
  background: rgba(0,0,0,0.3);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  padding: 12px;
}

.code-label {
  font-size: 10px;
  color: rgba(255,255,255,0.35);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  margin-bottom: 6px;
}

.code-block {
  font-family: 'Roboto Mono', monospace;
  font-size: 11px;
  color: #75E0A7;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}

.glass-input >>> .v-input__slot {
  background: rgba(255,255,255,0.04) !important;
  border-color: rgba(255,255,255,0.08) !important;
}
</style>
