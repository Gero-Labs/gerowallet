<template>
  <div class="pool-dashboard">
    <!-- Empty State -->
    <div v-if="!poolId" class="empty-state">
      <div class="empty-icon-wrap">
        <v-icon size="40" color="var(--g-text-3)">mdi-server-network-off</v-icon>
      </div>
      <h3 class="empty-title">{{ $t('poolOperator.noPoolConfigured') }}</h3>
      <p class="empty-subtitle">{{ $t('poolOperator.setupColdKeyFirst') }}</p>
    </div>

    <div v-else>
      <!-- Hero Card -->
      <div class="pool-hero liquid-glass">
        <div class="hero-glow" />

        <!-- Top Row: Avatar + Identity + Status -->
        <div class="hero-top">
          <div class="hero-identity">
            <v-avatar size="48" class="pool-avatar" :class="{ 'avatar-placeholder': !poolIcon }">
              <v-img v-if="poolIcon" :src="poolIcon" />
              <v-icon v-else size="24" color="var(--g-text-3)">mdi-shield-star-outline</v-icon>
            </v-avatar>
            <div>
              <div class="hero-ticker-row">
                <span v-if="poolInfo?.ticker" class="hero-ticker">[{{ poolInfo.ticker }}]</span>
                <span class="hero-name">{{ poolInfo?.name || $t('poolOperator.title') }}</span>
              </div>
              <div class="hero-id" @click="copyPoolId">
                <span>{{ truncatePoolId }}</span>
                <v-icon x-small color="var(--g-text-3)" class="ml-1">mdi-content-copy</v-icon>
              </div>
            </div>
          </div>

          <div class="hero-actions">
            <div class="status-badge" :class="statusClass">
              <span class="status-dot" />
              <span>{{ statusText }}</span>
            </div>
            <v-tooltip v-if="isRegistered" bottom content-class="custom-tooltip">
              <template v-slot:activator="{ on }">
                <v-btn icon x-small class="hero-icon-btn update-btn" v-on="on" @click="$emit('update')">
                  <v-icon size="16" color="var(--g-accent)">mdi-pencil-outline</v-icon>
                </v-btn>
              </template>
              <span>{{ $t('poolOperator.updatePool') }}</span>
            </v-tooltip>
            <v-tooltip v-if="isRegistered && !isRetiring" bottom content-class="custom-tooltip">
              <template v-slot:activator="{ on }">
                <v-btn icon x-small class="hero-icon-btn retire-btn" v-on="on" @click="$emit('retire')">
                  <v-icon size="16" color="error">mdi-power</v-icon>
                </v-btn>
              </template>
              <span>{{ $t('poolOperator.retirePool') }}</span>
            </v-tooltip>
          </div>
        </div>

        <!-- Description -->
        <div v-if="poolInfo?.description" class="hero-desc">{{ poolInfo.description }}</div>

        <!-- Leader Schedule (Current + Next) -->
        <div v-if="bpNode" class="leader-section">
          <div class="leader-header">
            <v-icon size="14" color="var(--g-text-1)" class="mr-1">mdi-calendar-clock</v-icon>
            <span>{{ $t('poolOperator.leaderSchedule') }}</span>
            <v-progress-circular v-if="scheduleLoading" indeterminate size="12" width="1" color="warning" class="ml-2" />
          </div>

          <div class="leader-epochs">
            <!-- Current Epoch -->
            <div class="leader-epoch-card">
              <div class="le-header">
                <span class="le-label">{{ $t('poolOperator.currentEpoch') }}</span>
                <span class="le-epoch" v-if="currentSchedule">{{ $t('poolOperator.epoch') }} {{ currentSchedule.epoch }}</span>
              </div>
              <div v-if="currentSchedule" class="le-body">
                <div class="le-stat-row">
                  <div class="le-stat">
                    <span class="le-val">{{ currentSchedule.totalSlots }}</span>
                    <span class="le-lbl">{{ $t('poolOperator.assignedSlots') }}</span>
                  </div>
                  <div class="le-stat">
                    <span class="le-val text-ok">{{ currentSchedule.producedCount }}</span>
                    <span class="le-lbl">{{ $t('poolOperator.produced') }}</span>
                  </div>
                  <div class="le-stat" v-if="currentSchedule.missedCount > 0">
                    <span class="le-val text-err">{{ currentSchedule.missedCount }}</span>
                    <span class="le-lbl">{{ $t('poolOperator.missed') }}</span>
                  </div>
                  <div class="le-stat" v-if="currentNextSlot">
                    <span class="le-val text-accent">{{ currentNextCountdown }}</span>
                    <span class="le-lbl">{{ $t('poolOperator.nextBlock') }}</span>
                  </div>
                </div>
              </div>
              <div v-else-if="!scheduleLoading" class="le-empty">--</div>
            </div>

            <!-- Next Epoch -->
            <div class="leader-epoch-card">
              <div class="le-header">
                <span class="le-label">{{ $t('poolOperator.nextEpoch') }}</span>
                <span class="le-epoch" v-if="nextSchedule">{{ $t('poolOperator.epoch') }} {{ nextSchedule.epoch }}</span>
              </div>
              <div v-if="nextSchedule" class="le-body">
                <div class="le-stat-row">
                  <div class="le-stat">
                    <span class="le-val">{{ nextSchedule.totalSlots }}</span>
                    <span class="le-lbl">{{ $t('poolOperator.assignedSlots') }}</span>
                  </div>
                </div>
              </div>
              <div v-else-if="!scheduleLoading" class="le-empty">--</div>
            </div>
          </div>
        </div>

        <!-- Stats Strip -->
        <div v-if="isRegistered" class="hero-stats">
          <div class="hs-item">
            <span class="hs-value">{{ formatAda(registeredParams?.pledge) }}</span>
            <span class="hs-label">{{ $t('poolOperator.pledge') }}</span>
            <span v-if="poolInfo?.live_pledge != null" class="hs-sub" :class="pledgeMet ? 'hs-ok' : 'hs-err'">
              {{ $t('poolOperator.live') }}: {{ formatAda(poolInfo.live_pledge) }}
            </span>
          </div>
          <div class="hs-divider" />
          <div class="hs-item">
            <span class="hs-value">{{ formatAda(registeredParams?.cost) }}</span>
            <span class="hs-label">{{ $t('poolOperator.cost') }}</span>
          </div>
          <div class="hs-divider" />
          <div class="hs-item">
            <span class="hs-value">{{ formatMargin(registeredParams?.margin) }}%</span>
            <span class="hs-label">{{ $t('poolOperator.margin') }}</span>
          </div>
          <div class="hs-divider" />
          <div class="hs-item">
            <span class="hs-value">{{ saturationDisplay }}%</span>
            <span class="hs-label">{{ $t('poolOperator.saturation') }}</span>
            <div class="sat-mini-bar">
              <div class="sat-mini-fill" :style="{ width: Math.min(poolInfo?.live_saturation || 0, 100) + '%' }" />
            </div>
          </div>
          <div class="hs-divider" />
          <div class="hs-item">
            <span class="hs-value">{{ registeredParams?.relays?.length || 0 }}</span>
            <span class="hs-label">{{ $t('poolOperator.relays') }}</span>
          </div>
        </div>

        <!-- Live Metrics Bar (from API) -->
        <div v-if="isRegistered && poolInfo" class="hero-metrics">
          <div class="hm-item">
            <v-icon x-small color="var(--g-text-3)" class="mr-1">mdi-chart-bar</v-icon>
            <span class="hm-value">{{ formatAdaShort(poolInfo.live_stake) }}</span>
            <span class="hm-label">{{ $t('poolOperator.liveStake') }}</span>
          </div>
          <div class="hm-item">
            <v-icon x-small color="var(--g-text-3)" class="mr-1">mdi-account-group</v-icon>
            <span class="hm-value">{{ (poolInfo.live_delegators || 0).toLocaleString() }}</span>
            <span class="hm-label">{{ $t('poolOperator.delegators') }}</span>
          </div>
          <div class="hm-item">
            <v-icon x-small color="var(--g-text-3)" class="mr-1">mdi-cube-outline</v-icon>
            <span class="hm-value">{{ (poolInfo.block_count || 0).toLocaleString() }}</span>
            <span class="hm-label">{{ $t('poolOperator.blocksProduced') }}</span>
          </div>
          <div class="hm-item">
            <v-icon x-small color="var(--g-text-3)" class="mr-1">mdi-trending-up</v-icon>
            <span class="hm-value">{{ (poolInfo.ros || 0).toFixed(2) }}%</span>
            <span class="hm-label">{{ $t('poolOperator.ros') }}</span>
          </div>
        </div>

        <!-- ═══ Infrastructure Section (inside hero card) ═══ -->
        <div class="infra-section">
          <!-- Infra Header -->
          <div class="infra-header">
            <span class="infra-title">
              <v-icon size="14" color="var(--g-text-1)" class="mr-1">mdi-server-network</v-icon>
              {{ $t('poolOperator.infrastructure') }}
            </span>
            <v-btn text x-small class="infra-add-btn" @click="$emit('add-node')">
              <v-icon x-small class="mr-1">mdi-plus</v-icon>
              {{ $t('poolOperator.addNode') }}
            </v-btn>
          </div>

          <!-- No nodes — setup guide -->
          <div v-if="allNodes.length === 0" class="setup-inline">
            <div class="setup-inline-header">
              <v-icon size="20" color="var(--g-accent)">mdi-rocket-launch-outline</v-icon>
              <div>
                <div class="setup-inline-title">{{ $t('poolOperator.getStarted') }}</div>
                <div class="setup-inline-desc">{{ $t('poolOperator.getStartedDescription') }}</div>
              </div>
            </div>
            <div class="setup-steps-compact">
              <div class="ssc-step" v-for="(step, i) in setupSteps" :key="i">
                <span class="ssc-num">{{ i + 1 }}</span>
                <span class="ssc-text">{{ step.title }}</span>
                <div v-if="step.code" class="ssc-code" @click="copyText(step.code)">
                  <code>{{ step.code }}</code>
                  <v-icon x-small color="var(--g-text-3)">mdi-content-copy</v-icon>
                </div>
              </div>
            </div>
            <v-btn color="var(--g-accent)" block small class="mt-3 black--text font-weight-bold" style="text-transform: none; border-radius: var(--g-r-control)" @click="$emit('add-node')">
              <v-icon small left>mdi-plus</v-icon>
              {{ $t('poolOperator.addFirstNode') }}
            </v-btn>
          </div>

          <!-- KES Status -->
          <div v-if="bpNode?.data?.kesRemaining != null" class="kes-row" :class="kesUrgencyClass">
            <div class="kes-row-left">
              <v-icon size="16" :color="kesColor">mdi-key-chain</v-icon>
              <span class="kes-row-text">
                KES {{ bpNode.data.kesPeriod }}
              </span>
              <span class="kes-badge" :class="kesTextClass">{{ bpNode.data.kesRemaining }} {{ $t('poolOperator.periodsRemaining') }}</span>
              <span class="kes-days">{{ kesDaysLeft }}</span>
            </div>
            <v-btn
              v-if="bpNode.data.kesRemaining < 50"
              x-small
              :color="bpNode.data.kesRemaining < 20 ? 'error' : 'warning'"
              class="black--text"
              style="text-transform: none; font-weight: 700; border-radius: var(--g-r-control); letter-spacing: normal"
              @click="openKesDialog()"
            >
              <v-icon x-small left>mdi-key-change</v-icon>
              {{ $t('poolOperator.rotateNow') }}
            </v-btn>
          </div>

          <!-- Node Cards -->
          <div class="node-grid">
            <div v-for="node in allNodes" :key="node.id" class="node-card" :class="{ 'node-off': !node.connected }">
              <!-- Node identity row -->
              <div class="nd-top">
                <div class="nd-badge" :class="node.type === 'bp' ? 'nd-bp' : 'nd-relay'">
                  <v-icon size="12" :color="node.type === 'bp' ? 'warning' : 'var(--g-accent)'">
                    {{ node.type === 'bp' ? 'mdi-shield-star' : 'mdi-access-point' }}
                  </v-icon>
                </div>
                <span class="nd-name">{{ node.name }}</span>
                <span v-if="node.connected" class="nd-dot" />
                <span v-else class="nd-offline-label">{{ $t('poolOperator.offline') }}</span>
                <v-btn icon x-small class="nd-action" @click.stop="$emit('edit-node', node)">
                  <v-icon x-small color="var(--g-text-3)">mdi-pencil</v-icon>
                </v-btn>
                <v-btn icon x-small class="nd-action" @click.stop="$emit('remove-node', node.id)">
                  <v-icon x-small color="var(--g-text-3)">mdi-close</v-icon>
                </v-btn>
              </div>

              <!-- Stats -->
              <div v-if="node.data && node.connected" class="nd-stats">
                <div class="nd-stat">
                  <span class="nd-val">{{ node.data.blockHeight?.toLocaleString() }}</span>
                  <span class="nd-lbl">Block</span>
                </div>
                <div class="nd-divider" />
                <div class="nd-stat">
                  <span class="nd-val">{{ node.data.peers }}</span>
                  <span class="nd-lbl">{{ $t('poolOperator.peers') }}</span>
                </div>
                <div class="nd-divider" />
                <div class="nd-stat">
                  <span class="nd-val">{{ formatMem(node.data.memoryMb) }}</span>
                  <span class="nd-lbl">RAM</span>
                </div>
                <div class="nd-divider" />
                <div class="nd-stat">
                  <span class="nd-val">{{ node.data.cpuPercent?.toFixed(0) }}%</span>
                  <span class="nd-lbl">CPU</span>
                </div>
                <div class="nd-divider" />
                <div class="nd-stat">
                  <span class="nd-val">{{ node.data.mempoolTxs }}</span>
                  <span class="nd-lbl">Mempool</span>
                </div>
              </div>

              <!-- Epoch progress (BP only) -->
              <div v-if="node.data && node.connected && node.type === 'bp'" class="nd-epoch">
                <span class="nd-epoch-label">{{ $t('poolOperator.epoch') }} {{ node.data.epoch }}</span>
                <div class="nd-epoch-track">
                  <div class="nd-epoch-fill" :style="{ width: epochPct(node.data) + '%' }" />
                </div>
                <span class="nd-epoch-pct">{{ epochPct(node.data) }}%</span>
              </div>

              <!-- Versions -->
              <div v-if="nodeVersions[node.id]" class="nd-versions">
                <span class="ndv-item">
                  <span class="ndv-label">node</span>
                  <span class="ndv-val">{{ nodeVersions[node.id].versions?.cardanoNode || '--' }}</span>
                </span>
                <span class="ndv-item">
                  <span class="ndv-label">cncli</span>
                  <span class="ndv-val">{{ nodeVersions[node.id].versions?.cncli || '--' }}</span>
                </span>
                <span class="ndv-item">
                  <span class="ndv-label">agent</span>
                  <span class="ndv-val">{{ nodeVersions[node.id].versions?.geroNodeMonitor || '--' }}</span>
                </span>
              </div>

              <!-- Update alerts -->
              <div v-if="nodeVersions[node.id]?.updates && Object.keys(nodeVersions[node.id].updates).length > 0" class="nd-update-alert">
                <v-icon x-small color="warning" class="mr-1">mdi-arrow-up-circle</v-icon>
                <span v-for="(upd, key) in nodeVersions[node.id].updates" :key="key">
                  {{ key === 'cardanoNode' ? 'Node' : key }} {{ upd.current }} → {{ upd.latest }}
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="text-center py-4">
        <v-progress-circular indeterminate color="primary" size="20" />
      </div>

      <!-- KES Rotation Dialog -->
      <v-dialog v-model="showKesRotation" max-width="550px" persistent>
        <v-card class="kes-dialog">
          <v-card-title class="kes-dialog-title">
            <v-icon color="warning" class="mr-2">mdi-key-change</v-icon>
            {{ $t('poolOperator.kesRotation') }}
            <v-spacer />
            <v-btn icon small @click="showKesRotation = false"><v-icon small>mdi-close</v-icon></v-btn>
          </v-card-title>
          <v-card-text class="pt-4">
            <!-- Current Status -->
            <div class="kes-status-card">
              <div class="ksc-row">
                <span class="ksc-label">{{ $t('poolOperator.currentKesPeriod') }}</span>
                <span class="ksc-value">{{ bpNode?.data?.kesPeriod || '--' }}</span>
              </div>
              <div class="ksc-row">
                <span class="ksc-label">{{ $t('poolOperator.periodsRemaining') }}</span>
                <span class="ksc-value" :class="kesTextClass">{{ bpNode?.data?.kesRemaining || '--' }}</span>
              </div>
              <div class="ksc-row">
                <span class="ksc-label">{{ $t('poolOperator.timeRemaining') }}</span>
                <span class="ksc-value">{{ kesDaysLeft }}</span>
              </div>
            </div>

            <!-- Remote Rotation -->
            <div class="mt-4" v-if="!kesRotateSuccess">
              <p class="kes-step-desc">{{ $t('poolOperator.remoteRotatePassKeyDescription') }}</p>

              <v-alert v-if="kesRotateError" type="error" dense outlined class="mt-3" style="font-size: 13px">
                {{ kesRotateError }}
              </v-alert>

              <!-- Rotation steps progress -->
              <div v-if="kesRotateSteps.length" class="rotate-steps mt-3">
                <div v-for="(step, i) in kesRotateSteps" :key="i" class="rotate-step">
                  <v-icon x-small color="success" class="mr-1">mdi-check</v-icon>
                  <span>{{ step }}</span>
                </div>
              </div>
            </div>

            <!-- Success -->
            <div v-else class="text-center py-4">
              <v-icon size="48" color="success">mdi-check-circle</v-icon>
              <div class="mt-3" style="font-size: 14px; font-weight: 600; color: var(--g-success)">{{ $t('poolOperator.kesRotated') }}</div>
              <div class="mt-1" style="font-size: 13px; color: var(--g-text-3)">{{ $t('poolOperator.kesRotatedDescription') }}</div>
            </div>
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn v-if="kesRotateSuccess" text @click="closeKesDialog">{{ $t('common.close') }}</v-btn>
            <template v-else>
              <v-btn text @click="closeKesDialog">{{ $t('common.cancel') }}</v-btn>
              <v-btn
                color="warning"
                class="black--text"
                style="text-transform: none; font-weight: 700; border-radius: var(--g-r-control)"
                :loading="kesRotating"
                @click="rotateKesRemote"
              >
                <v-icon left small>{{ coldKeyEncryption === 'prf' ? 'mdi-fingerprint' : 'mdi-key-change' }}</v-icon>
                {{ $t('poolOperator.rotateNow') }}
              </v-btn>
            </template>
          </v-card-actions>
        </v-card>
      </v-dialog>
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

defineEmits(['add-node', 'remove-node', 'edit-node', 'retire', 'update']);

const loading = ref(false);
const poolInfo = ref<any>(null);
const pledgeMet = ref(true);
const poolIcon = ref<string | null>(null);
const showKesRotation = ref(false);
const nodeVersions = ref<Record<string, any>>({});
const kesRotating = ref(false);
const coldKeyEncryption = ref('prf'); // Will be loaded from DB
const kesRotateError = ref('');
const kesRotateSteps = ref<string[]>([]);
const kesRotateSuccess = ref(false);

// Leader schedule
const scheduleLoading = ref(false);
const currentSchedule = ref<any>(null);
const nextSchedule = ref<any>(null);

const currentNextSlot = computed(() => {
  if (!currentSchedule.value?.slots) return null;
  const now = Date.now() / 1000;
  return currentSchedule.value.slots.find((s: any) => s.timestamp > now && s.produced === null);
});

const currentNextCountdown = computed(() => {
  if (!currentNextSlot.value) return '--';
  const diff = currentNextSlot.value.timestamp - Date.now() / 1000;
  if (diff <= 0) return t('poolOperator.now');
  const hours = Math.floor(diff / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
});

// Find connected nodes
const bpNode = computed(() => poolOperatorStore.nodes.find(n => n.type === 'bp' && n.connected));
const allNodes = computed(() => poolOperatorStore.nodes);
const _connectedNodes = computed(() => poolOperatorStore.nodes.filter(n => n.connected && n.data));

const setupSteps = [
  { title: t('poolOperator.step1Title'), code: 'curl -sSL https://raw.githubusercontent.com/Gero-Labs/gero-node-monitor/main/gero-node-monitor-server.py -o ~/gero-node-monitor-server.py' },
  { title: t('poolOperator.step2Title'), code: 'mkdir -p ~/.gero-node-monitor/cache && python3 ~/gero-node-monitor-server.py --config' },
  { title: t('poolOperator.step3Title'), code: 'sudo -E python3 ~/gero-node-monitor-server.py' },
  { title: t('poolOperator.step4Title'), code: null },
];

function copyText(text: string) {
  navigator.clipboard.writeText(text);
  snackbar.fireSuccess(t('common.copied'));
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

// KES computations
const kesRemaining = computed(() => bpNode.value?.data?.kesRemaining ?? null);
const kesDaysLeft = computed(() => {
  if (kesRemaining.value == null) return '--';
  // Each KES period ≈ 129600 slots ≈ 1.5 days (36 hours)
  const days = Math.floor((kesRemaining.value * 36) / 24);
  if (days > 30) return `~${Math.floor(days / 30)} months`;
  return `~${days} days`;
});

const _kesBarPct = computed(() => {
  if (kesRemaining.value == null) return 0;
  // Max KES periods = 62 (for standard config)
  return Math.min((kesRemaining.value / 62) * 100, 100);
});

const kesColor = computed(() => {
  const r = kesRemaining.value;
  if (r == null) return 'var(--g-text-3)';
  if (r < 20) return 'error';
  if (r < 50) return 'warning';
  return 'success';
});

const kesTextClass = computed(() => {
  const r = kesRemaining.value;
  if (r == null) return '';
  if (r < 20) return 'text-critical';
  if (r < 50) return 'text-warning';
  return 'text-healthy';
});

const kesUrgencyClass = computed(() => {
  const r = kesRemaining.value;
  if (r == null) return '';
  if (r < 20) return 'kes-critical';
  if (r < 50) return 'kes-warning';
  return 'kes-healthy';
});

const _bpNodeHost = computed(() => {
  try {
    return bpNode.value?.url ? new globalThis.URL(bpNode.value.url).hostname : 'your-node';
  } catch {
    return 'your-node';
  }
});

const _kesBarClass = computed(() => {
  const r = kesRemaining.value;
  if (r == null) return '';
  if (r < 20) return 'bar-critical';
  if (r < 50) return 'bar-warning';
  return 'bar-healthy';
});

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

const truncatePoolId = computed(() => {
  if (!poolId.value) return '';
  return poolId.value.length > 40
    ? poolId.value.slice(0, 20) + '...' + poolId.value.slice(-12)
    : poolId.value;
});

const saturationDisplay = computed(() => {
  return (poolInfo.value?.live_saturation || 0).toFixed(1);
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

async function rotateKesRemote() {
  if (!bpNode.value?.url) return;
  kesRotating.value = true;
  kesRotateError.value = '';
  kesRotateSteps.value = [];

  try {
    // Step 1: Decrypt cold key from wallet DB
    kesRotateSteps.value.push('Decrypting cold key...');

    const walletId = walletStore.loggedWallet?.id;
    if (!walletId) throw new Error('No wallet logged in');

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(walletId);
    const configTable = db.table('config');
    const encryptedEntry = await configTable.where({ key: 'spo_encryptedColdKey' }).first();
    const encryptionEntry = await configTable.where({ key: 'spo_coldKeyEncryption' }).first();
    const credentialEntry = await configTable.where({ key: 'spo_coldKeyCredentialId' }).first();

    console.log('[KES] spo_encryptedColdKey:', !!encryptedEntry?.value, 'encryption:', encryptionEntry?.value, 'credId:', !!credentialEntry?.value);
    if (!encryptedEntry?.value) throw new Error('No cold key imported. Import your cold key first.');

    const encMethod = encryptionEntry?.value || 'password';
    let coldKeyHex: string;

    if (encMethod === 'prf') {
      // Decrypt with PassKey (triggers biometric)
      const { decryptPrivateKeyWithPrf } = await import('@/shared/utils/webauthn-prf');
      const wallet = walletStore.loggedWallet;
      const credId = credentialEntry?.value || wallet?.webAuthnCredentialId;
      if (!credId) throw new Error('No PassKey credential found');

      const coldKeyBytes = await decryptPrivateKeyWithPrf(encryptedEntry.value, credId, String(walletId));
      coldKeyHex = Array.from(coldKeyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
      // Decrypt with spending password — prompt needed
      // For now, throw — we should add a password input fallback
      throw new Error('Password-encrypted cold keys not yet supported for remote rotation. Use PassKey.');
    }

    kesRotateSteps.value[0] = 'Cold key decrypted';

    // Step 2: Send cold key to node for signing
    console.log('[KES] coldKeyHex length:', coldKeyHex?.length, 'sending to:', bpNode.value.url);
    kesRotateSteps.value.push('Sending to node for KES rotation...');

    const { Messaging } = await import('@/chrome/messaging');
    const { MessageTypes } = await import('@/models/MessageTypes');

    const result = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SPO_NODE_FETCH,
      data: {
        url: bpNode.value.url + '/kes-rotate',
        timeout: 60000,
        method: 'POST',
        body: JSON.stringify({ coldKeyHex }),
      },
    }) as any;

    const data = result?.data?.body || result?.data;

    if (data?.error) {
      kesRotateError.value = data.error;
    } else if (data?.success) {
      kesRotateSteps.value = ['Cold key decrypted', ...(data.steps || [])];
      kesRotateSuccess.value = true;
      await refreshAfterRotation();
    } else {
      kesRotateError.value = 'Unexpected response from node';
    }
  } catch (e: any) {
    kesRotateError.value = e.message || 'Failed to rotate KES';
  } finally {
    kesRotating.value = false;
  }
}

function openKesDialog() {
  kesRotating.value = false;
  kesRotateError.value = '';
  kesRotateSteps.value = [];
  kesRotateSuccess.value = false;
  showKesRotation.value = true;
}

function closeKesDialog() {
  showKesRotation.value = false;
  kesRotateError.value = '';
  kesRotateSteps.value = [];
  kesRotateSuccess.value = false;
}

function _copyCmd(cmd: string) {
  navigator.clipboard.writeText(cmd);
  snackbar.fireSuccess(t('common.copied'));
}

async function refreshAfterRotation() {
  showKesRotation.value = false;
  // Re-poll the BP node to get updated KES data
  const bp = poolOperatorStore.nodes.find(n => n.type === 'bp');
  if (bp) {
    try {
      const { nodeFetch } = await import('../utils/nodeFetch');
      bp.data = await nodeFetch(bp.url + '/status', 8000);
      bp.connected = true;
      snackbar.fireSuccess(t('poolOperator.kesRefreshed'));
    } catch {
      snackbar.setError(t('poolOperator.kesRefreshFailed'));
    }
  }
}

function copyPoolId() {
  if (poolId.value) {
    navigator.clipboard.writeText(poolId.value);
    snackbar.fireSuccess(t('poolOperator.poolIdCopied'));
  }
}

function parsePoolExtendedInfo(data: any) {
  try {
    if (data?.pool_extended_info) {
      const parsed = JSON.parse(data.pool_extended_info);
      const icon = parsed?.info?.url_png_icon_64x64;
      if (icon && typeof icon === 'string' && icon.startsWith('http')) {
        poolIcon.value = icon;
      }
    }
  } catch { /* ignore parse errors */ }
}

async function fetchPoolData() {
  if (!poolId.value || !loggedWallet.value) return;
  loading.value = true;
  try {
    const data = await blockchainApi.getPoolById(poolId.value, loggedWallet.value.chain, loggedWallet.value.network);
    if (data) {
      poolInfo.value = data;
      poolOperatorStore.isRegistered = true;

      parsePoolExtendedInfo(data);

      if (data.live_pledge != null && data.pledge != null) {
        pledgeMet.value = Number(data.live_pledge) >= Number(data.pledge);
      }

      if (data.pledge != null) {
        poolOperatorStore.registeredParams = {
          pledge: data.pledge,
          cost: data.fixed_cost || data.cost,
          margin: data.margin_of_cost != null
            ? { numerator: Math.round(data.margin_of_cost * 10000), denominator: 10000 }
            : typeof data.margin === 'number'
              ? { numerator: Math.round(data.margin * 10000), denominator: 10000 }
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

async function fetchNodeVersions() {
  for (const node of poolOperatorStore.nodes) {
    if (!node.connected || !node.url) continue;
    try {
      const { nodeFetch } = await import('../utils/nodeFetch');
      const data = await nodeFetch(`${node.url}/versions`, 10000);
      nodeVersions.value = { ...nodeVersions.value, [node.id]: data };
    } catch { /* skip */ }
  }
}

async function fetchLeaderSchedule() {
  const bp = poolOperatorStore.nodes.find(n => n.type === 'bp' && n.connected);
  if (!bp?.url) return;

  scheduleLoading.value = true;
  try {
    const { nodeFetch } = await import('../utils/nodeFetch');
    const [current, next] = await Promise.allSettled([
      nodeFetch(`${bp.url}/leader-schedule?epoch=current`, 30000),
      nodeFetch(`${bp.url}/leader-schedule?epoch=next`, 30000),
    ]);
    if (current.status === 'fulfilled' && !current.value.error) {
      currentSchedule.value = current.value;
    }
    if (next.status === 'fulfilled' && !next.value.error) {
      nextSchedule.value = next.value;
    }
  } catch (e) {
    console.warn('Failed to fetch leader schedule:', e);
  } finally {
    scheduleLoading.value = false;
  }
}

onMounted(() => { if (poolId.value) fetchPoolData(); });
watch(poolId, (id) => { if (id) fetchPoolData(); });

// Fetch leader schedule + versions when BP node connects
watch(bpNode, (bp) => {
  if (bp?.connected) {
    fetchLeaderSchedule();
    fetchNodeVersions();
  }
}, { immediate: true });
</script>

<style scoped>
.pool-dashboard { padding: 4px; }

/* Empty state */
.empty-state { text-align: center; padding: 56px 16px; }
.empty-icon-wrap {
  width: 72px; height: 72px; border-radius: 50%;
  background: var(--g-hairline-1); border: 1px solid var(--g-hairline-1);
  display: flex; align-items: center; justify-content: center; margin: 0 auto;
}
.empty-title { color: var(--g-text-3); font-size: 16px; font-weight: 600; }
.empty-subtitle { color: var(--g-text-3); font-size: 13px; }

/* Hero Card */
.pool-hero { position: relative; padding: 16px; overflow: hidden; }

.hero-glow {
  position: absolute; top: -40px; right: -40px; width: 160px; height: 160px;
  border-radius: 50%;
  pointer-events: none;
}

/* Top Row */
.hero-top {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 12px; position: relative; z-index: 1;
}

.hero-identity { display: flex; align-items: center; gap: 12px; }

.pool-avatar {
  border: 2px solid var(--g-hairline-2);
  background: var(--g-hairline-1);
}
.avatar-placeholder {
  border-style: dashed;
}

.hero-ticker-row { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }

.hero-ticker {
  font-size: 20px; font-weight: 800;
  color: var(--g-accent);
}

.hero-name { font-size: 16px; font-weight: 600; color: var(--g-text-1); }

.hero-id {
  display: inline-flex; align-items: center; margin-top: 2px; cursor: pointer;
  font-family: var(--g-font-mono); font-size: 11px; color: var(--g-text-3);
  transition: color var(--g-dur-fast);
}
.hero-id:hover { color: var(--g-text-3); }

.hero-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.hero-icon-btn {
  width: 28px !important;
  height: 28px !important;
  transition: background-color var(--g-dur-fast), border-color var(--g-dur-fast);
}

.update-btn {
  background: var(--g-hairline-1) !important;
  border: 1px solid var(--g-hairline-3);
}

.update-btn:hover {
  background: var(--g-hairline-3) !important;
  border-color: var(--g-hairline-3);
}

.retire-btn {
  background: var(--g-error-fill) !important;
  border: 1px solid var(--g-error-line);
}

.retire-btn:hover {
  background: var(--g-error-fill) !important;
  border-color: var(--g-error-line);
}

/* Status badge */
.status-badge {
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px;
  border-radius: var(--g-r-pill); font-size: 11px; font-weight: 600; white-space: nowrap;
}
.status-dot { width: 5px; height: 5px; border-radius: 50%; }
.status--active { background: var(--g-success-fill); color: var(--g-success); }
.status--active .status-dot { background: var(--g-success); animation: livePulse 2s ease-in-out infinite; }
.status--retiring { background: var(--g-error-fill); color: var(--g-error); }
.status--retiring .status-dot { background: var(--g-error); }
.status--inactive { background: var(--g-hairline-1); color: var(--g-text-3); }
.status--inactive .status-dot { background: var(--g-text-3); }

@keyframes livePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

.hero-desc {
  font-size: 12px; color: var(--g-text-3); margin-top: 8px; line-height: 1.5;
  position: relative; z-index: 1;
}

/* Stats Strip — compact horizontal */
.hero-stats {
  display: flex; align-items: flex-start; gap: 0;
  margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--g-hairline-1);
  position: relative; z-index: 1; overflow-x: auto;
}

.hs-item { flex: 1; text-align: center; min-width: 60px; padding: 0 4px; }
.hs-divider { width: 1px; min-height: 30px; background: var(--g-hairline-1); align-self: stretch; }

.hs-value {
  display: block; font-size: 16px; font-weight: 700; color: var(--g-text-1);
  font-variant-numeric: tabular-nums; line-height: 1.2;
}

.hs-label {
  display: block; font-size: 11px; color: var(--g-text-3);
  text-transform: uppercase; letter-spacing: 0.3px; margin-top: 1px;
}

.hs-sub { display: block; font-size: 11px; margin-top: 1px; }
.hs-ok { color: var(--g-success); }
.hs-err { color: var(--g-error); }

.sat-mini-bar { height: 2px; background: var(--g-hairline-1); border-radius: 1px; margin-top: 4px; overflow: hidden; width: 80%; margin-left: auto; margin-right: auto; }
.sat-mini-fill { height: 100%; background: var(--g-accent); border-radius: 1px; transition: width var(--g-dur-slow) ease; }

/* Metrics Bar — tight inline */
.hero-metrics {
  display: flex; gap: 14px; flex-wrap: wrap;
  margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--g-hairline-1);
  position: relative; z-index: 1;
}

.hm-item { display: flex; align-items: center; gap: 2px; }

.hm-value {
  font-size: 13px; font-weight: 600; color: var(--g-text-2);
  font-variant-numeric: tabular-nums;
}

.hm-label {
  font-size: 11px; color: var(--g-text-3); margin-left: 2px;
}

/* ═══ Infrastructure Section ═══ */
.infra-section {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--g-hairline-1);
  position: relative;
  z-index: 1;
}

/* Versions row */
.nd-versions {
  display: flex;
  gap: 10px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--g-hairline-1);
}

.ndv-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ndv-label {
  font-size: 11px;
  color: var(--g-text-3);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.ndv-val {
  font-size: 12px;
  font-weight: 600;
  color: var(--g-text-2);
  font-variant-numeric: tabular-nums;
}

/* Update alert */
.nd-update-alert {
  margin-top: 6px;
  padding: 5px 10px;
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
  border-radius: var(--g-r-control);
  font-size: 11px;
  font-weight: 600;
  color: var(--g-warning);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

/* Setup guide inline */
.setup-inline {
  padding: 14px;
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  margin-bottom: 10px;
}

.setup-inline-header {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.setup-inline-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--g-text-1);
}

.setup-inline-desc {
  font-size: 12px;
  color: var(--g-text-3);
  line-height: 1.5;
  margin-top: 2px;
}

.setup-steps-compact {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ssc-step {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ssc-num {
  width: 20px;
  height: 20px;
  min-width: 20px;
  border-radius: 50%;
  background: var(--g-hairline-2);
  color: var(--g-accent);
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ssc-text {
  font-size: 13px;
  color: var(--g-text-2);
  font-weight: 500;
}

.ssc-code {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--g-canvas);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-chip);
  padding: 3px 8px;
  cursor: pointer;
  transition: border-color var(--g-dur-fast);
}

.ssc-code:hover {
  border-color: var(--g-hairline-3);
}

.ssc-code code {
  font-family: var(--g-font-mono);
  font-size: 11px;
  color: var(--g-success);
}

.infra-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.infra-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--g-text-1);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
}

.infra-add-btn {
  text-transform: none !important;
  letter-spacing: normal !important;
  font-size: 12px !important;
  color: var(--g-accent) !important;
}

/* KES row */
.kes-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  margin-bottom: 8px;
}

.kes-row.kes-critical { border-color: var(--g-error-line); background: var(--g-error-fill); }
.kes-row.kes-warning { border-color: var(--g-warning-line); background: var(--g-warning-fill); }

.kes-row-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.kes-row-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-2);
}

.kes-badge {
  font-size: 12px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: var(--g-r-chip);
}

.kes-badge.text-critical { background: var(--g-error-fill); color: var(--g-error); }
.kes-badge.text-warning { background: var(--g-warning-fill); color: var(--g-warning); }
.kes-badge.text-healthy { background: var(--g-success-fill); color: var(--g-success); }

.kes-days {
  font-size: 12px;
  color: var(--g-text-3);
}

/* Node Grid */
.node-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 8px;
}

.node-card {
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 10px 12px;
  transition: border-color var(--g-dur-base);
}

.node-card:hover { border-color: var(--g-hairline-2); }
.node-card.node-off { opacity: 0.45; }

.nd-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.nd-badge {
  width: 24px;
  height: 24px;
  border-radius: var(--g-r-control);
  display: flex;
  align-items: center;
  justify-content: center;
}

.nd-bp { background: var(--g-warning-fill); }
.nd-relay { background: var(--g-hairline-2); }

.nd-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--g-text-1);
  flex: 1;
}

.nd-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--g-success);
  animation: livePulse 2s ease-in-out infinite;
}

.nd-offline-label {
  font-size: 12px;
  color: var(--g-error);
  font-weight: 600;
}

.nd-action {
  opacity: 0;
  transition: opacity var(--g-dur-fast);
}

.node-card:hover .nd-action {
  opacity: 1;
}

/* Node stats row */
.nd-stats {
  display: flex;
  align-items: center;
  gap: 0;
}

.nd-stat {
  flex: 1;
  text-align: center;
}

.nd-divider {
  width: 1px;
  height: 28px;
  background: var(--g-hairline-1);
}

.nd-val {
  display: block;
  font-size: 14px;
  font-weight: 700;
  color: var(--g-text-1);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.nd-lbl {
  display: block;
  font-size: 11px;
  color: var(--g-text-3);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  margin-top: 1px;
}

/* Epoch progress in node card */
.nd-epoch {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--g-hairline-1);
}

.nd-epoch-label {
  font-size: 11px;
  color: var(--g-text-3);
  white-space: nowrap;
}

.nd-epoch-track {
  flex: 1;
  height: 3px;
  background: var(--g-hairline-1);
  border-radius: 2px;
  overflow: hidden;
}

.nd-epoch-fill {
  height: 100%;
  background: var(--g-accent);
  border-radius: 2px;
  transition: width var(--g-dur-slow) ease;
}

.nd-epoch-pct {
  font-size: 11px;
  color: var(--g-text-3);
  font-variant-numeric: tabular-nums;
}

/* ═══ Leader Schedule (inside hero) ═══ */
.leader-section {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--g-hairline-1);
}

.leader-header {
  font-size: 11px;
  font-weight: 600;
  color: var(--g-text-3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}

/* Leader epochs — compact inline */
.leader-epochs {
  display: flex;
  gap: 8px;
}

.leader-epoch-card {
  flex: 1;
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 8px 12px;
}

.le-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.le-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--g-text-2);
}

.le-epoch {
  font-size: 11px;
  color: var(--g-text-3);
  font-variant-numeric: tabular-nums;
}

.le-stat-row {
  display: flex;
  gap: 14px;
  align-items: baseline;
}

.le-stat {
  display: flex;
  align-items: baseline;
  gap: 3px;
}

.le-val {
  font-size: 20px;
  font-weight: 800;
  color: var(--g-text-1);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.le-val.text-ok { color: var(--g-success); }
.le-val.text-err { color: var(--g-error); }
.le-val.text-accent { color: var(--g-warning); }

.le-lbl {
  font-size: 11px;
  color: var(--g-text-3);
}

.le-empty {
  font-size: 16px;
  color: var(--g-text-3);
  text-align: center;
}

/* KES Banner (old, replaced by kes-row above but keeping for dialog trigger) */
.kes-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  padding: 12px 16px;
  border-radius: var(--g-r-control);
  border: 1px solid var(--g-hairline-1);
  background: var(--g-hairline-1);
  transition: background-color var(--g-dur-base), border-color var(--g-dur-base);
}

.kes-banner.kes-critical {
  border-color: var(--g-error-line);
  background: var(--g-error-fill);
}

.kes-banner.kes-warning {
  border-color: var(--g-warning-line);
  background: var(--g-warning-fill);
}

.kes-banner-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.kes-icon-wrap {
  width: 36px;
  height: 36px;
  min-width: 36px;
  border-radius: var(--g-r-control);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--g-hairline-1);
}

.kes-icon-wrap.kes-critical { background: var(--g-error-fill); }
.kes-icon-wrap.kes-warning { background: var(--g-warning-fill); }
.kes-icon-wrap.kes-healthy { background: var(--g-success-fill); }

.kes-info { flex: 1; min-width: 0; }

.kes-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--g-text-2);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.kes-remaining {
  font-size: 12px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: var(--g-r-chip);
}

.kes-remaining.text-critical {
  background: var(--g-error-fill);
  color: var(--g-error);
}

.kes-remaining.text-warning {
  background: var(--g-warning-fill);
  color: var(--g-warning);
}

.kes-remaining.text-healthy {
  background: var(--g-success-fill);
  color: var(--g-success);
}

.kes-bar-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.kes-bar-track {
  flex: 1;
  height: 4px;
  background: var(--g-hairline-1);
  border-radius: 2px;
  overflow: hidden;
}

.kes-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width var(--g-dur-slow) ease;
}

.bar-critical { background: var(--g-error); }
.bar-warning { background: var(--g-warning); }
.bar-healthy { background: var(--g-success); }

.kes-bar-label {
  font-size: 11px;
  color: var(--g-text-3);
  white-space: nowrap;
}

.kes-rotate-btn {
  text-transform: none !important;
  letter-spacing: normal !important;
  font-weight: 700 !important;
  border-radius: var(--g-r-control) !important;
  font-size: 12px !important;
}

/* KES Dialog */
.kes-dialog {
  background: var(--g-overlay) !important;
  border: 1px solid var(--g-hairline-1);
}

.kes-dialog-title {
  border-bottom: 1px solid var(--g-hairline-1);
}

.kes-status-card {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 12px;
}

.ksc-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
}

.ksc-row + .ksc-row { border-top: 1px solid var(--g-hairline-1); }

.ksc-label {
  font-size: 12px;
  color: var(--g-text-3);
}

.ksc-value {
  font-size: 12px;
  font-weight: 700;
  color: var(--g-text-1);
  font-variant-numeric: tabular-nums;
}

.ksc-value.text-critical { color: var(--g-error); }
.ksc-value.text-warning { color: var(--g-warning); }

.kes-steps { }

.kes-step-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-2);
}

.kes-step-desc {
  font-size: 11px;
  color: var(--g-text-3);
  line-height: 1.5;
  margin-top: 2px;
  margin-bottom: 12px;
}

.kes-command {
  margin-bottom: 12px;
}

.cmd-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--g-text-3);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  margin-bottom: 4px;
}

.cmd-code {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--g-canvas);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 8px 12px;
}

.cmd-code code {
  flex: 1;
  font-family: var(--g-font-mono);
  font-size: 11px;
  color: var(--g-success);
}

.cmd-steps-list {
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 10px 14px;
}

.cmd-step {
  font-size: 11px;
  color: var(--g-text-3);
  line-height: 1.8;
}

.kes-or-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 12px 0;
  font-size: 11px;
  color: var(--g-text-3);
}

.kes-or-divider::before, .kes-or-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--g-hairline-1);
}

/* Refresh */
.refresh-btn {
  text-transform: none !important; letter-spacing: normal !important;
  font-size: 11px !important; color: var(--g-text-3) !important;
}
.refresh-btn:hover { color: var(--g-text-2) !important; }
</style>
