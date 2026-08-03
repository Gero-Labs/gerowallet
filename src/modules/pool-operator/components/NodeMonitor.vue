<template>
  <div class="node-monitor">
    <!-- When hideCards is true, only render the add button + polling logic (no visible cards) -->
    <template v-if="!hideCards">
      <div class="section-header">
        <div class="section-title t-label">
          <v-icon size="16" color="success" class="mr-2">mdi-server</v-icon>
          {{ $t('poolOperator.nodeMonitor') }}
        </div>
        <v-btn text x-small class="action-btn" @click="showAddNode = true">
          <v-icon x-small class="mr-1">mdi-plus</v-icon>
          {{ $t('poolOperator.addNode') }}
        </v-btn>
      </div>
    </template>

    <!-- No nodes configured — Setup Guide -->
    <div v-if="nodes.length === 0 && !hideCards" class="setup-guide liquid-glass-compact">
      <div class="guide-header">
        <v-icon size="28" color="var(--g-accent)">mdi-rocket-launch-outline</v-icon>
        <div>
          <div class="guide-title">{{ $t('poolOperator.getStarted') }}</div>
          <div class="guide-subtitle">{{ $t('poolOperator.getStartedDescription') }}</div>
        </div>
      </div>

      <div class="guide-steps">
        <div class="guide-step">
          <div class="step-num">1</div>
          <div class="step-content">
            <div class="step-title">{{ $t('poolOperator.step1Title') }}</div>
            <div class="step-text">{{ $t('poolOperator.step1Description') }}</div>
            <div class="step-code">
              <code>pip3 install gero-node-monitor</code>
              <v-btn icon x-small @click="copyText('pip3 install gero-node-monitor')" class="copy-btn">
                <v-icon x-small>mdi-content-copy</v-icon>
              </v-btn>
            </div>
          </div>
        </div>
        <div class="guide-step">
          <div class="step-num">2</div>
          <div class="step-content">
            <div class="step-title">{{ $t('poolOperator.step2Title') }}</div>
            <div class="step-text">{{ $t('poolOperator.step2Description') }}</div>
            <div class="step-code">
              <code>gero-node-monitor --config</code>
              <v-btn icon x-small @click="copyText('gero-node-monitor --config')" class="copy-btn">
                <v-icon x-small>mdi-content-copy</v-icon>
              </v-btn>
            </div>
          </div>
        </div>
        <div class="guide-step">
          <div class="step-num">3</div>
          <div class="step-content">
            <div class="step-title">{{ $t('poolOperator.step3Title') }}</div>
            <div class="step-text">{{ $t('poolOperator.step3Description') }}</div>
            <div class="step-code">
              <code>python3 gero-node-monitor-server.py</code>
              <v-btn icon x-small @click="copyText('python3 gero-node-monitor-server.py')" class="copy-btn">
                <v-icon x-small>mdi-content-copy</v-icon>
              </v-btn>
            </div>
          </div>
        </div>
        <div class="guide-step">
          <div class="step-num">4</div>
          <div class="step-content">
            <div class="step-title">{{ $t('poolOperator.step4Title') }}</div>
            <div class="step-text">{{ $t('poolOperator.step4Description') }}</div>
          </div>
        </div>
      </div>

      <v-btn color="var(--g-accent)" block class="mt-4 black--text font-weight-bold" style="text-transform: none; border-radius: var(--g-r-control)" @click="showAddNode = true">
        <v-icon left small>mdi-plus</v-icon>
        {{ $t('poolOperator.addFirstNode') }}
      </v-btn>
    </div>

    <!-- Node Cards (hidden when dashboard renders them inline) -->
    <div v-else-if="!hideCards" class="node-cards">
      <div v-for="node in nodes" :key="node.id" class="node-card liquid-glass-compact" :class="{ 'node-offline': !node.connected }">
        <!-- Node Header -->
        <div class="nc-header">
          <div class="nc-identity">
            <div class="nc-type-badge" :class="node.type === 'bp' ? 'badge-bp' : 'badge-relay'">
              <v-icon x-small :color="node.type === 'bp' ? 'warning' : 'var(--g-accent)'">
                {{ node.type === 'bp' ? 'mdi-shield-star' : 'mdi-access-point' }}
              </v-icon>
            </div>
            <div>
              <span class="nc-name">{{ node.name }}</span>
              <span class="nc-type">{{ node.type === 'bp' ? $t('poolOperator.blockProducer') : $t('poolOperator.relay') }}</span>
            </div>
          </div>
          <div class="nc-actions">
            <span class="nc-status" :class="node.connected ? 'status-on' : 'status-off'">
              <span class="status-dot" />
              {{ node.connected ? $t('poolOperator.online') : $t('poolOperator.offline') }}
            </span>
            <v-btn icon x-small @click="removeNode(node.id)" class="ml-1">
              <v-icon x-small color="var(--g-text-3)">mdi-close</v-icon>
            </v-btn>
          </div>
        </div>

        <!-- Node Stats (when connected) -->
        <div v-if="node.data" class="nc-stats">
          <div class="nc-stat">
            <span class="ncs-label t-label">{{ $t('poolOperator.nodeTip') }}</span>
            <span class="ncs-value">{{ node.data.blockHeight?.toLocaleString() }}</span>
          </div>
          <div class="nc-stat">
            <span class="ncs-label t-label">{{ $t('poolOperator.peers') }}</span>
            <span class="ncs-value">{{ node.data.peers }}</span>
          </div>
          <div class="nc-stat" v-if="node.type === 'bp'">
            <span class="ncs-label t-label">KES</span>
            <span class="ncs-value" :class="kesClass(node.data.kesRemaining)">{{ node.data.kesRemaining ?? '--' }}</span>
          </div>
          <div class="nc-stat">
            <span class="ncs-label t-label">{{ $t('poolOperator.memory') }}</span>
            <span class="ncs-value">{{ formatMem(node.data.memoryMb) }}</span>
          </div>
          <div class="nc-stat">
            <span class="ncs-label t-label">CPU</span>
            <span class="ncs-value">{{ node.data.cpuPercent?.toFixed(1) }}%</span>
          </div>
          <div class="nc-stat">
            <span class="ncs-label t-label">{{ $t('poolOperator.mempool') }}</span>
            <span class="ncs-value">{{ node.data.mempoolTxs }}</span>
          </div>
        </div>

        <!-- Epoch Progress (BP only) -->
        <div v-if="node.data && node.type === 'bp'" class="nc-epoch">
          <div class="epoch-labels">
            <span>{{ $t('poolOperator.epoch') }} {{ node.data.epoch }}</span>
            <span>{{ epochPct(node.data) }}%</span>
          </div>
          <div class="epoch-track">
            <div class="epoch-fill" :style="{ width: epochPct(node.data) + '%' }" />
          </div>
        </div>

        <!-- KES Warning -->
        <div v-if="node.type === 'bp' && node.data?.kesRemaining != null && node.data.kesRemaining < 50" class="nc-warning">
          <v-icon x-small color="error" class="mr-1">mdi-alert</v-icon>
          {{ $t('poolOperator.kesRotationNeeded') }}
        </div>
      </div>
    </div>

    <!-- Add Node Dialog -->
    <v-dialog v-model="showAddNode" max-width="450px">
      <v-card class="dialog-card">
        <v-card-title style="border-bottom: 1px solid var(--g-hairline-1)">
          {{ editingNodeId ? $t('poolOperator.editNode') : $t('poolOperator.addNode') }}
          <v-spacer />
          <v-btn icon small @click="showAddNode = false"><v-icon small>mdi-close</v-icon></v-btn>
        </v-card-title>
        <v-card-text class="pt-4">
          <v-text-field
            v-model="newNodeName"
            :label="$t('poolOperator.nodeName')"
            placeholder="e.g., Block Producer, Relay EU-1"
            outlined dense dark hide-details
            class="glass-input mb-3"
          />

          <div class="type-selector mb-3">
            <div
              class="type-option" :class="{ 'type-active': newNodeType === 'bp' }"
              @click="newNodeType = 'bp'"
            >
              <v-icon small :color="newNodeType === 'bp' ? 'warning' : 'var(--g-text-3)'">mdi-shield-star</v-icon>
              <span>{{ $t('poolOperator.blockProducer') }}</span>
            </div>
            <div
              class="type-option" :class="{ 'type-active': newNodeType === 'relay' }"
              @click="newNodeType = 'relay'"
            >
              <v-icon small :color="newNodeType === 'relay' ? 'var(--g-accent)' : 'var(--g-text-3)'">mdi-access-point</v-icon>
              <span>{{ $t('poolOperator.relay') }}</span>
            </div>
          </div>

          <!-- Auto-detect -->
          <v-btn
            block outlined dark small class="mb-3"
            style="text-transform: none; border-color: var(--g-hairline-2)"
            :loading="autoDetecting"
            @click="autoDetect"
          >
            <v-icon small left>mdi-magnify</v-icon>
            {{ $t('poolOperator.autoDetect') }}
          </v-btn>

          <div class="config-divider mb-3"><span>{{ $t('common.or') }}</span></div>

          <v-text-field
            v-model="newNodeUrl"
            :label="$t('poolOperator.nodeEndpoint')"
            placeholder="https://your-tunnel.trycloudflare.com"
            outlined dense dark hide-details
            class="glass-input"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn text @click="showAddNode = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="success" class="black--text" :disabled="!newNodeUrl || !newNodeName" @click="addNode" style="text-transform: none">
            {{ editingNodeId ? $t('common.save') : $t('poolOperator.addNode') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, toRefs, onMounted, onUnmounted } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { poolOperatorStore, saveNodes, MonitoredNode } from '@/stores/poolOperatorStore';
import { walletStore } from '@/stores/walletStore';
import { nodeFetch } from '../utils/nodeFetch';
import snackbar from '@/plugins/snackbar';

withDefaults(defineProps<{ hideCards?: boolean }>(), { hideCards: false });

const { t } = useTranslation();
const { poolId, nodes } = toRefs(poolOperatorStore);

const showAddNode = ref(false);
const editingNodeId = ref<string | null>(null);

function openAddDialog() {
  editingNodeId.value = null;
  newNodeName.value = '';
  newNodeUrl.value = '';
  newNodeType.value = 'bp';
  showAddNode.value = true;
}

function openEditDialog(node: MonitoredNode) {
  editingNodeId.value = node.id;
  newNodeName.value = node.name;
  newNodeUrl.value = node.url;
  newNodeType.value = node.type;
  showAddNode.value = true;
}

defineExpose({ openAddDialog, openEditDialog });
const newNodeName = ref('');
const newNodeType = ref<'bp' | 'relay'>('bp');
const newNodeUrl = ref('');
const autoDetecting = ref(false);
let pollInterval: ReturnType<typeof setInterval> | null = null;

function kesClass(remaining: number | null): string {
  if (remaining == null) return '';
  if (remaining < 20) return 'text-err';
  if (remaining < 50) return 'text-warn';
  return 'text-ok';
}

function formatMem(mb: number): string {
  if (!mb) return '--';
  return mb >= 1024 ? (mb / 1024).toFixed(1) + 'G' : mb + 'M';
}

function epochPct(data: any): string {
  if (!data) return '0';
  const total = (data.epochSlot || 0) + (data.epochSlotsRemaining || 0);
  return total ? ((data.epochSlot / total) * 100).toFixed(1) : '0';
}

function copyText(text: string) {
  navigator.clipboard.writeText(text);
  snackbar.fireSuccess(t('common.copied'));
}

async function autoDetect() {
  if (!poolId.value) return;
  autoDetecting.value = true;
  try {
    const { data } = await (await import('axios')).default.get(
      `${import.meta.env['VITE_BACKEND_URL']}/api/spo/monitor-url/${poolId.value}`
    );
    if (data?.tunnelUrl) {
      newNodeUrl.value = data.tunnelUrl;
      snackbar.fireSuccess(t('poolOperator.tunnelDetected'));
    } else {
      snackbar.setError(t('poolOperator.noTunnelFound'));
    }
  } catch {
    snackbar.setError(t('poolOperator.noTunnelFound'));
  } finally {
    autoDetecting.value = false;
  }
}

async function addNode() {
  const url = newNodeUrl.value.trim().replace(/\/+$/, '');
  if (!url || !newNodeName.value) return;

  if (editingNodeId.value) {
    // Edit existing node
    const existing = poolOperatorStore.nodes.find(n => n.id === editingNodeId.value);
    if (existing) {
      existing.name = newNodeName.value;
      existing.type = newNodeType.value;
      existing.url = url;
      existing.connected = false;
      existing.data = null;
      await pollSingleNode(existing);
    }
  } else {
    // Add new node
    const node: MonitoredNode = {
      id: crypto.randomUUID(),
      name: newNodeName.value,
      type: newNodeType.value,
      url,
      connected: false,
      lastSeen: null,
      data: null,
    };
    poolOperatorStore.nodes.push(node);
    await pollSingleNode(node);
  }

  const walletId = walletStore.loggedWallet?.id;
  if (walletId) await saveNodes(walletId);

  showAddNode.value = false;
  editingNodeId.value = null;
  newNodeName.value = '';
  newNodeUrl.value = '';
  newNodeType.value = 'bp';

  snackbar.fireSuccess(t('poolOperator.nodeConnected'));
}

async function removeNode(id: string) {
  poolOperatorStore.nodes = poolOperatorStore.nodes.filter(n => n.id !== id);
  const walletId = walletStore.loggedWallet?.id;
  if (walletId) await saveNodes(walletId);
}

async function pollSingleNode(node: MonitoredNode) {
  try {
    const data = await nodeFetch(node.url + '/status', 8000);
    node.data = data;
    node.connected = true;
    node.lastSeen = Date.now();
  } catch {
    node.connected = false;
  }
}

async function pollAllNodes() {
  await Promise.allSettled(poolOperatorStore.nodes.map(pollSingleNode));
}

onMounted(() => {
  if (poolOperatorStore.nodes.length > 0) {
    pollAllNodes();
    pollInterval = setInterval(pollAllNodes, 30_000);
  }
});

onUnmounted(() => { if (pollInterval) clearInterval(pollInterval); });

// Start polling when first node is added
import { watch } from 'vue';
watch(() => poolOperatorStore.nodes.length, (len) => {
  if (len > 0 && !pollInterval) {
    pollInterval = setInterval(pollAllNodes, 30_000);
  }
  if (len === 0 && pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
});
</script>

<style scoped>
.node-monitor { margin-top: 12px; }

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--g-text-2);
  display: flex;
  align-items: center;
}

.action-btn {
  text-transform: none !important;
  letter-spacing: normal !important;
  color: var(--g-text-3) !important;
  font-size: 11px !important;
}

/* Setup Guide */
.setup-guide { padding: 20px; }

.guide-header {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  margin-bottom: 20px;
}

.guide-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--g-text-1);
}

.guide-subtitle {
  font-size: 12px;
  color: var(--g-text-3);
  margin-top: 2px;
  line-height: 1.5;
}

.guide-steps {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.guide-step {
  display: flex;
  gap: 12px;
}

.step-num {
  width: 24px;
  height: 24px;
  min-width: 24px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--g-accent) 10%, transparent);
  color: var(--g-accent);
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.step-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--g-text-2);
}

.step-text {
  font-size: 11px;
  color: var(--g-text-3);
  line-height: 1.5;
  margin-top: 1px;
}

.step-code {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  background: rgba(0,0,0,0.3);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 6px 10px;
}

.step-code code {
  font-family: var(--g-font-mono);
  font-size: 11px;
  color: var(--g-success);
  flex: 1;
}

.copy-btn {
  color: var(--g-text-3) !important;
}

/* Node Cards */
.node-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.node-card {
  padding: 14px;
  transition: border-color var(--g-dur-base);
}

.node-card:hover { border-color: var(--g-hairline-2) !important; }
.node-card.node-offline { opacity: 0.6; }

.nc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.nc-identity {
  display: flex;
  align-items: center;
  gap: 10px;
}

.nc-type-badge {
  width: 28px;
  height: 28px;
  border-radius: var(--g-r-control);
  display: flex;
  align-items: center;
  justify-content: center;
}

.badge-bp { background: var(--g-warning-fill); }
.badge-relay { background: color-mix(in srgb, var(--g-accent) 10%, transparent); }

.nc-name {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-1);
}

.nc-type {
  display: block;
  font-size: 11px;
  color: var(--g-text-3);
}

.nc-actions {
  display: flex;
  align-items: center;
}

.nc-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
}

.status-on { color: var(--g-success); }
.status-off { color: var(--g-text-3); }

.status-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
}

.status-on .status-dot {
  background: var(--g-success);
  animation: livePulse 2s ease-in-out infinite;
}

.status-off .status-dot { background: var(--g-text-3); }

@keyframes livePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* Stats Grid */
.nc-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--g-hairline-1);
  border-radius: var(--g-r-control);
  overflow: hidden;
}

@media (max-width: 450px) {
  .nc-stats { grid-template-columns: repeat(2, 1fr); }
}

.nc-stat {
  padding: 8px 10px;
  background: rgba(0,0,0,0.15);
}

.ncs-label {
  display: block;
  font-size: 11px;
  color: var(--g-text-3);
}

.ncs-value {
  display: block;
  font-size: 14px;
  font-weight: 700;
  color: var(--g-text-1);
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
}

.text-ok { color: var(--g-success); }
.text-warn { color: var(--g-warning); }
.text-err { color: var(--g-error); }

/* Epoch Progress */
.nc-epoch {
  margin-top: 10px;
  padding: 8px 10px;
  background: var(--g-hairline-1);
  border-radius: var(--g-r-control);
}

.epoch-labels {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--g-text-3);
  margin-bottom: 4px;
}

.epoch-track {
  height: 3px;
  background: var(--g-hairline-1);
  border-radius: 2px;
  overflow: hidden;
}

.epoch-fill {
  height: 100%;
  background: var(--g-accent);
  border-radius: 2px;
  transition: width var(--g-dur-slow) ease;
}

/* KES Warning */
.nc-warning {
  margin-top: 8px;
  padding: 6px 10px;
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
  border-radius: var(--g-r-control);
  font-size: 11px;
  color: var(--g-error);
  font-weight: 600;
  display: flex;
  align-items: center;
}

/* Dialog */
.dialog-card {
  background: var(--g-raised) !important;
  border: 1px solid var(--g-hairline-1);
}

.type-selector {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.type-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  cursor: pointer;
  transition: color var(--g-dur-fast), background-color var(--g-dur-fast), border-color var(--g-dur-fast);
  font-size: 12px;
  color: var(--g-text-3);
}

.type-option:hover { border-color: var(--g-hairline-3); }

.type-active {
  border-color: color-mix(in srgb, var(--g-accent) 30%, transparent) !important;
  background: color-mix(in srgb, var(--g-accent) 4%, transparent);
  color: var(--g-text-1);
}

.config-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--g-text-3);
  font-size: 11px;
}
.config-divider::before, .config-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--g-hairline-1);
}

.glass-input >>> .v-input__slot {
  background: var(--g-hairline-1) !important;
  border-color: var(--g-hairline-1) !important;
}
</style>