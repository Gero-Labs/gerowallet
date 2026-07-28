<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" class="spo-page">
        <!-- Loading -->
        <div v-if="!loaded" class="text-center py-8">
          <v-progress-circular indeterminate color="primary" size="32" />
        </div>

        <!-- State 1: No cold key — show setup -->
        <ColdKeySetup v-else-if="!coldKeyConfigured" @configured="onColdKeyConfigured" />

        <!-- State 2: Grid Dashboard -->
        <template v-else>
          <!-- Node Monitor (invisible, polling only) -->
          <NodeMonitor ref="nodeMonitorRef" :hide-cards="true" />

          <!-- ═══ GRID LAYOUT ═══ -->
          <div class="spo-grid">
            <!-- Row 1: Pool Identity (full width) -->
            <PoolIdentityCard
              class="grid-full"
              :pool-icon="poolIcon"
              :ticker="poolInfo?.ticker || undefined"
              :name="poolInfo?.name || $t('poolOperator.title')"
              :truncated-id="truncatePoolId"
              :description="poolInfo?.description || undefined"
              :status-class="statusClass"
              :status-text="statusText"
              :is-registered="isRegistered"
              :is-retiring="isRetiring"
              :live-stake="poolInfo?.live_stake"
              :delegators="poolInfo?.live_delegators || 0"
              :blocks="poolInfo?.block_count || 0"
              :ros="(poolInfo?.ros || 0).toFixed(2)"
              @copy-id="copyPoolId"
              @update="showUpdateDialog = true"
              @retire="showRetireDialog = true"
            />

            <!-- Register button (full width, only when not registered) -->
            <div v-if="!isRegistered" class="grid-full action-bar">
              <v-btn small color="primary" class="black--text action-btn-primary" @click="showUpdateDialog = true">
                <v-icon small left>mdi-plus-circle-outline</v-icon>
                {{ $t('poolOperator.registerPool') }}
              </v-btn>
            </div>

            <!-- Row 2: Leader Schedule + Pool Params -->
            <template v-if="isRegistered">
              <LeaderScheduleCard
                class="grid-full"
                :connected="!!bpNode"
                :loading="scheduleLoading"
                :current="currentSchedule"
                :next="nextSchedule"
                :next-countdown="currentNextCountdown"
              />

              <PoolParamsCard
                class="grid-full"
                :pledge="registeredParams?.pledge"
                :cost="registeredParams?.cost"
                :margin="formatMargin(registeredParams?.margin)"
                :saturation="saturationDisplay"
                :relays="registeredParams?.relays || []"
                :ros="(poolInfo?.ros || 0).toFixed(2)"
                :live-pledge="poolInfo?.live_pledge"
                :pledge-met="pledgeMet"
                :metadata-url="registeredParams?.metadataUrl"
                :metadata-hash="registeredParams?.metadataHash"
                :reward-addr="registeredParams?.rewardAddr"
                :owners="registeredParams?.owners || []"
              />

              <!-- Row 3: Infrastructure (full width) -->
              <InfrastructureCard
                class="grid-full"
                :nodes="allNodes"
                :versions="nodeVersions"
                :kes-remaining="kesRemaining"
                :kes-period="bpNode?.data?.kesPeriod || undefined"
                :kes-color="kesColor"
                :kes-class="kesUrgencyClass"
                :kes-badge-class="kesTextClass"
                :kes-days="kesDaysLeft"
                :setup-steps="setupSteps"
                @add-node="openAddNode"
                @edit-node="editNode"
                @remove-node="removeNode"
                @rotate-kes="openKesDialog"
                @show-peers="showPeersForNode"
                @show-live="showLiveForNode"
              />

              <!-- Row 4: Epoch History (full width) -->
              <div class="grid-full epoch-card-wrap liquid-glass">
                <EpochHistory />
              </div>
            </template>
          </div>

          <!-- Node Live View Dialog -->
          <v-dialog v-model="showLiveDialog" max-width="700px">
            <v-card class="spo-dialog">
              <v-card-title class="spo-dialog-title glv-dialog-title">
                <v-icon size="16" :color="liveNode?.type === 'bp' ? 'warning' : 'primary'" class="mr-2">{{ liveNode?.type === 'bp' ? 'mdi-shield-star' : 'mdi-access-point' }}</v-icon>
                <span class="glv-title-name">{{ liveNode?.name }}</span>
                <span class="glv-title-tag">{{ liveNode?.type === 'bp' ? 'Core' : 'Relay' }}</span>
                <span v-if="liveNode?.data?.nodeVersion" class="glv-title-dim">{{ liveNode.data.nodeVersion }}</span>
                <span v-if="nodeVersions[liveNode?.id]?.versions?.cardanoNode" class="glv-title-dim">v{{ nodeVersions[liveNode.id].versions.cardanoNode }}</span>
                <span v-if="liveNode?.data?.uptimeSeconds" class="glv-title-dim">up {{ Math.floor(liveNode.data.uptimeSeconds / 86400) }}d {{ Math.floor((liveNode.data.uptimeSeconds % 86400) / 3600) }}h</span>
                <span v-if="liveNode?.data?.tipHash" class="glv-title-hash">{{ liveNode.data.tipHash }}</span>
                <v-spacer />
                <v-btn icon small @click="showLiveDialog = false"><v-icon small>mdi-close</v-icon></v-btn>
              </v-card-title>
              <v-card-text class="pa-0">
                <NodeLiveView
                  v-if="liveNode"
                  :node="liveNode"
                  :visible="showLiveDialog"
                  :versions="nodeVersions[liveNode.id]"
                  :schedule="liveNode.type === 'bp' ? currentSchedule : undefined"
                  :next-countdown="liveNode.type === 'bp' ? currentNextCountdown : undefined"
                />
              </v-card-text>
            </v-card>
          </v-dialog>

          <!-- Peers Dialog -->
          <v-dialog v-model="showPeersDialog" max-width="650px">
            <v-card class="spo-dialog">
              <v-card-title class="spo-dialog-title">
                <v-icon color="info" class="mr-2">mdi-lan</v-icon>
                {{ $t('poolOperator.networkPeers') }} — {{ peersNode?.name }}
                <v-spacer />
                <v-btn icon small @click="showPeersDialog = false"><v-icon small>mdi-close</v-icon></v-btn>
              </v-card-title>
              <v-card-text class="pa-0">
                <PeersCard
                  :connected="!!peersNode?.connected"
                  :node-url="peersNode?.url"
                  :node-data="peersNode?.data"
                />
              </v-card-text>
            </v-card>
          </v-dialog>

          <!-- KES Rotation Dialog (from PoolDashboard) -->
          <v-dialog v-model="showKesRotation" max-width="550px" persistent>
            <v-card class="spo-dialog">
              <v-card-title class="spo-dialog-title">
                <v-icon color="warning" class="mr-2">mdi-key-change</v-icon>
                {{ $t('poolOperator.kesRotation') }}
                <v-spacer />
                <v-btn icon small @click="showKesRotation = false"><v-icon small>mdi-close</v-icon></v-btn>
              </v-card-title>
              <v-card-text class="pt-4">
                <div v-if="!kesRotateSuccess">
                  <p style="font-size: 13px; color: var(--g-text-3)">{{ $t('poolOperator.remoteRotatePassKeyDescription') }}</p>
                  <v-alert v-if="kesRotateError" type="error" dense outlined class="mt-3" style="font-size: 13px">{{ kesRotateError }}</v-alert>
                  <div v-if="kesRotateSteps.length" class="mt-3">
                    <div v-for="(step, i) in kesRotateSteps" :key="i" style="font-size: 12px; color: var(--g-text-2); padding: 2px 0">
                      <v-icon x-small color="success" class="mr-1">mdi-check</v-icon> {{ step }}
                    </div>
                  </div>
                </div>
                <div v-else class="text-center py-4">
                  <v-icon size="48" color="success">mdi-check-circle</v-icon>
                  <div class="mt-3" style="font-size: 14px; font-weight: 600; color: var(--g-success)">{{ $t('poolOperator.kesRotated') }}</div>
                </div>
              </v-card-text>
              <v-card-actions>
                <v-spacer />
                <v-btn v-if="kesRotateSuccess" text @click="showKesRotation = false">{{ $t('common.close') }}</v-btn>
                <template v-else>
                  <v-btn text @click="showKesRotation = false">{{ $t('common.cancel') }}</v-btn>
                  <v-btn color="warning" class="black--text" style="text-transform:none;font-weight:700;border-radius:var(--g-r-control)" :loading="kesRotating" @click="rotateKesRemote">
                    <v-icon left small>mdi-fingerprint</v-icon>
                    {{ $t('poolOperator.rotateNow') }}
                  </v-btn>
                </template>
              </v-card-actions>
            </v-card>
          </v-dialog>
        </template>

        <!-- Update / Register Dialog -->
        <v-dialog v-model="showUpdateDialog" max-width="600px" scrollable>
          <v-card class="spo-dialog">
            <v-card-title class="spo-dialog-title">
              <v-icon color="primary" class="mr-2">{{ isRegistered ? 'mdi-pencil-outline' : 'mdi-plus-circle-outline' }}</v-icon>
              {{ isRegistered ? $t('poolOperator.updatePool') : $t('poolOperator.registerPool') }}
              <v-spacer />
              <v-btn icon small @click="showUpdateDialog = false"><v-icon small>mdi-close</v-icon></v-btn>
            </v-card-title>
            <v-card-text class="pt-4">
              <PoolRegistrationForm @close="showUpdateDialog = false" />
            </v-card-text>
          </v-card>
        </v-dialog>

        <!-- Retire Dialog -->
        <v-dialog v-model="showRetireDialog" max-width="500px">
          <v-card class="spo-dialog">
            <v-card-title class="spo-dialog-title">
              <v-icon color="error" class="mr-2">mdi-power</v-icon>
              {{ $t('poolOperator.retirePool') }}
              <v-spacer />
              <v-btn icon small @click="showRetireDialog = false"><v-icon small>mdi-close</v-icon></v-btn>
            </v-card-title>
            <v-card-text class="pt-4">
              <PoolRetirementForm @close="showRetireDialog = false" />
            </v-card-text>
          </v-card>
        </v-dialog>
      </v-col>
    </v-row>
  </v-layout>
</template>

<script setup lang="ts">
import { ref, computed, toRefs, onMounted, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { poolOperatorStore, loadPoolOperatorConfig } from '@/stores/poolOperatorStore';
import { walletStore } from '@/stores/walletStore';
import blockchainApi from '@/api/blockchain-api';
import snackbar from '@/plugins/snackbar';

import ColdKeySetup from './components/ColdKeySetup.vue';
import PoolRegistrationForm from './components/PoolRegistrationForm.vue';
import PoolRetirementForm from './components/PoolRetirementForm.vue';
import EpochHistory from './components/EpochHistory.vue';
import NodeMonitor from './components/NodeMonitor.vue';
import PoolIdentityCard from './components/PoolIdentityCard.vue';
import LeaderScheduleCard from './components/LeaderScheduleCard.vue';
import PoolParamsCard from './components/PoolParamsCard.vue';
import InfrastructureCard from './components/InfrastructureCard.vue';
import PeersCard from './components/PeersCard.vue';
import NodeLiveView from './components/NodeLiveView.vue';

const { t } = useTranslation();
const { coldKeySource, vrfKeyHash, isRegistered, isRetiring, retirementEpoch, registeredParams, nodes, poolId } = toRefs(poolOperatorStore);
const { loggedWallet } = toRefs(walletStore);
const loaded = ref(false);
const showUpdateDialog = ref(false);
const showRetireDialog = ref(false);
const showPeersDialog = ref(false);
const peersNode = ref<any>(null);
const showLiveDialog = ref(false);
const liveNode = ref<any>(null);

function showPeersForNode(node: any) {
  peersNode.value = node;
  showPeersDialog.value = true;
}

function showLiveForNode(node: any) {
  liveNode.value = node;
  showLiveDialog.value = true;
}

const showKesRotation = ref(false);
const nodeMonitorRef = ref<any>(null);

// Pool data
const poolInfo = ref<any>(null);
const poolIcon = ref<string | undefined>(undefined);
const pledgeMet = ref(true);
const nodeVersions = ref<Record<string, any>>({});

// Leader schedule
const scheduleLoading = ref(false);
const currentSchedule = ref<any>(undefined);
const nextSchedule = ref<any>(undefined);

// KES rotation
const kesRotating = ref(false);
const kesRotateError = ref('');
const kesRotateSteps = ref<string[]>([]);
const kesRotateSuccess = ref(false);

// Setup is only complete once BOTH the cold key AND the VRF key are imported.
// The cold key persists coldKeySource='imported' immediately, so gating on it
// alone would strand a user who left before importing the VRF key — the VRF
// import UI lives only in the setup screen.
const coldKeyConfigured = computed(() => coldKeySource.value !== 'none' && !!vrfKeyHash.value);
const allNodes = computed(() => nodes.value);
const bpNode = computed(() => nodes.value.find(n => n.type === 'bp' && n.connected));

const truncatePoolId = computed(() => {
  if (!poolId.value) return '';
  return poolId.value.length > 40 ? poolId.value.slice(0, 20) + '...' + poolId.value.slice(-12) : poolId.value;
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

const saturationDisplay = computed(() => (poolInfo.value?.live_saturation || 0).toFixed(1));

const kesRemaining = computed(() => bpNode.value?.data?.kesRemaining ?? undefined);
const kesDaysLeft = computed(() => {
  if (kesRemaining.value == null) return '--';
  const days = Math.floor((kesRemaining.value * 36) / 24);
  return days > 30 ? `~${Math.floor(days / 30)}mo` : `~${days}d`;
});
const kesColor = computed(() => {
  const r = kesRemaining.value;
  if (r == null) return 'rgba(255,255,255,0.5)';
  if (r < 20) return '#FDA29B';
  if (r < 50) return '#FDB022';
  return '#75E0A7';
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
  return '';
});

const currentNextSlot = computed(() => {
  if (!currentSchedule.value?.slots) return undefined;
  const now = Date.now() / 1000;
  return currentSchedule.value.slots.find((s: any) => s.timestamp > now && s.produced === null);
});

const currentNextCountdown = computed(() => {
  if (!currentNextSlot.value) return undefined;
  const diff = currentNextSlot.value.timestamp - Date.now() / 1000;
  if (diff <= 0) return t('poolOperator.now');
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
});

const setupSteps = computed(() => [
  { title: t('poolOperator.step1Title'), code: 'curl -sSL https://raw.githubusercontent.com/Gero-Labs/gero-node-monitor/main/gero-node-monitor-server.py -o ~/gero-node-monitor-server.py' },
  { title: t('poolOperator.step2Title'), code: 'mkdir -p ~/.gero-node-monitor/cache && python3 ~/gero-node-monitor-server.py --config' },
  { title: t('poolOperator.step3Title'), code: 'sudo -E python3 ~/gero-node-monitor-server.py' },
  { title: t('poolOperator.step4Title'), code: undefined },
]);

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

// Data fetching
async function fetchPoolData() {
  if (!poolId.value || !loggedWallet.value) return;
  try {
    const data = await blockchainApi.getPoolById(poolId.value, loggedWallet.value.chain, loggedWallet.value.network);
    if (data) {
      poolInfo.value = data;
      poolOperatorStore.isRegistered = true;
      // Parse icon
      try {
        if (data.pool_extended_info) {
          const parsed = JSON.parse(data.pool_extended_info);
          const icon = parsed?.info?.url_png_icon_64x64;
          if (icon && typeof icon === 'string' && icon.startsWith('http')) poolIcon.value = icon;
        }
      } catch {}
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
          metadataUrl: data.meta_url || data.metadata_url || '',
          metadataHash: data.meta_hash || data.metadata_hash || '',
          rewardAddr: data.reward_addr || data.rewardAccount || '',
        };
      }
    }
  } catch (e: any) {
    if (e.message?.includes('404') || e.response?.status === 404) {
      poolOperatorStore.isRegistered = false;
    }
  }
}

async function fetchLeaderSchedule() {
  const bp = bpNode.value;
  if (!bp?.url) return;
  scheduleLoading.value = true;
  try {
    const { nodeFetch } = await import('./utils/nodeFetch');
    const [cur, nxt] = await Promise.allSettled([
      nodeFetch(`${bp.url}/leader-schedule?epoch=current`, 30000),
      nodeFetch(`${bp.url}/leader-schedule?epoch=next`, 30000),
    ]);
    if (cur.status === 'fulfilled' && !cur.value.error) currentSchedule.value = cur.value;
    if (nxt.status === 'fulfilled' && !nxt.value.error) nextSchedule.value = nxt.value;
  } catch {} finally { scheduleLoading.value = false; }
}

async function fetchNodeVersions() {
  for (const node of poolOperatorStore.nodes) {
    if (!node.connected || !node.url) continue;
    try {
      const { nodeFetch } = await import('./utils/nodeFetch');
      const data = await nodeFetch(`${node.url}/versions`, 10000);
      nodeVersions.value = { ...nodeVersions.value, [node.id]: data };
    } catch {}
  }
}

// Node management
function openAddNode() { nodeMonitorRef.value?.openAddDialog(); }
function editNode(node: any) { nodeMonitorRef.value?.openEditDialog(node); }
async function removeNode(nodeId: string) {
  poolOperatorStore.nodes = poolOperatorStore.nodes.filter(n => n.id !== nodeId);
  const wid = walletStore.loggedWallet?.id;
  if (wid) { const { saveNodes } = await import('@/stores/poolOperatorStore'); await saveNodes(wid); }
}

// KES rotation
function openKesDialog() {
  kesRotating.value = false;
  kesRotateError.value = '';
  kesRotateSteps.value = [];
  kesRotateSuccess.value = false;
  showKesRotation.value = true;
}

async function rotateKesRemote() {
  if (!bpNode.value?.url) return;
  kesRotating.value = true;
  kesRotateError.value = '';
  kesRotateSteps.value = [];
  try {
    kesRotateSteps.value.push('Decrypting cold key...');
    const wid = walletStore.loggedWallet?.id;
    if (!wid) throw new Error('No wallet');
    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wid);
    const ct = db.table('config');
    const enc = await ct.where({ key: 'spo_encryptedColdKey' }).first();
    const encMethod = await ct.where({ key: 'spo_coldKeyEncryption' }).first();
    const credEntry = await ct.where({ key: 'spo_coldKeyCredentialId' }).first();
    if (!enc?.value) throw new Error('No cold key imported');
    let coldKeyHex: string;
    if ((encMethod?.value || 'password') === 'prf') {
      const { decryptPrivateKeyWithPrf } = await import('@/shared/utils/webauthn-prf');
      const w = walletStore.loggedWallet;
      const cid = credEntry?.value || w?.webAuthnCredentialId;
      if (!cid) throw new Error('No PassKey credential');
      const bytes = await decryptPrivateKeyWithPrf(enc.value, cid, String(wid));
      coldKeyHex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
      throw new Error('Password-encrypted cold keys not supported for remote rotation.');
    }
    kesRotateSteps.value[0] = 'Cold key decrypted';
    kesRotateSteps.value.push('Sending to node...');
    const { Messaging } = await import('@/chrome/messaging');
    const { MessageTypes } = await import('@/models/MessageTypes');
    const result = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SPO_NODE_FETCH,
      data: { url: bpNode.value.url + '/kes-rotate', timeout: 60000, method: 'POST', body: JSON.stringify({ coldKeyHex }) },
    }) as any;
    const data = result?.data?.body || result?.data;
    if (data?.error) { kesRotateError.value = data.error; }
    else if (data?.success) { kesRotateSteps.value = ['Cold key decrypted', ...(data.steps || [])]; kesRotateSuccess.value = true; }
    else { kesRotateError.value = 'Unexpected response'; }
  } catch (e: any) { kesRotateError.value = e.message || 'Failed'; }
  finally { kesRotating.value = false; }
}

function onColdKeyConfigured() {}

// Lifecycle
onMounted(async () => {
  const wid = walletStore.loggedWallet?.id;
  if (wid) await loadPoolOperatorConfig(wid);
  loaded.value = true;
  if (poolId.value) fetchPoolData();
});

watch(poolId, (id) => { if (id) fetchPoolData(); });
watch(bpNode, (bp) => {
  if (bp?.connected) { fetchLeaderSchedule(); fetchNodeVersions(); }
}, { immediate: true });
</script>

<style scoped>
.spo-page { padding: 8px; }

/* ═══ GRID LAYOUT ═══ */
.spo-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.grid-full { grid-column: 1 / -1; }
.grid-half { align-self: start; }

@media (max-width: 700px) {
  .spo-grid { grid-template-columns: 1fr; }
}

.epoch-card-wrap {
  padding: 14px;
  overflow: hidden;
}

/* Action Bar */
.action-bar { display: flex; gap: 8px; }
.action-btn-primary {
  flex: 1; text-transform: none !important; letter-spacing: normal !important;
  font-size: 13px !important; font-weight: 700 !important; border-radius: var(--g-r-control) !important; height: 40px !important;
}

/* Dialogs */
.spo-dialog { background: var(--g-raised) !important; border: 1px solid var(--g-hairline-1); }
.spo-dialog-title { border-bottom: 1px solid var(--g-hairline-1); font-size: 16px !important; }

/* gLiveView dialog title */
.glv-dialog-title { font-size: 13px !important; gap: 6px; font-family: var(--g-font-mono); }
.glv-title-name { font-weight: 700; color: var(--g-text-1); }
.glv-title-tag {
  font-size: 11px; font-weight: 700; padding: 1px 5px;
  border-radius: 4px;
  background: var(--g-hairline-1); color: var(--g-text-3);
}
.glv-title-dim { font-size: 11px; color: var(--g-text-3); }
.glv-title-hash { font-size: 11px; color: var(--g-text-3); font-family: var(--g-font-mono); }
</style>
