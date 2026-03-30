<template>
  <div class="infra-card liquid-glass">
    <div class="card-header">
      <v-icon size="14" color="white" class="mr-1">mdi-server-network</v-icon>
      <span>{{ $t('poolOperator.infrastructure') }}</span>
      <v-spacer />
      <v-btn text x-small class="add-btn" @click="$emit('add-node')">
        <v-icon x-small class="mr-1">mdi-plus</v-icon>
        {{ $t('poolOperator.addNode') }}
      </v-btn>
    </div>

    <!-- Setup guide when no nodes -->
    <div v-if="nodes.length === 0" class="setup-inline">
      <div class="setup-row">
        <v-icon size="18" color="#2DF0F7">mdi-rocket-launch-outline</v-icon>
        <div>
          <div class="setup-title">{{ $t('poolOperator.getStarted') }}</div>
          <div class="setup-desc">{{ $t('poolOperator.getStartedDescription') }}</div>
        </div>
      </div>
      <div class="setup-steps">
        <div v-for="(step, i) in setupSteps" :key="i" class="setup-step">
          <span class="step-num">{{ i + 1 }}</span>
          <span class="step-text">{{ step.title }}</span>
          <div v-if="step.code" class="step-code" @click="copyText(step.code)">
            <code>{{ step.code }}</code>
            <v-icon x-small color="rgba(255,255,255,0.4)">mdi-content-copy</v-icon>
          </div>
        </div>
      </div>
      <v-btn color="#2DF0F7" block small class="mt-3 black--text font-weight-bold" style="text-transform:none;border-radius:8px" @click="$emit('add-node')">
        <v-icon small left>mdi-plus</v-icon>
        {{ $t('poolOperator.addFirstNode') }}
      </v-btn>
    </div>

    <!-- KES row -->
    <div v-if="kesRemaining != null" class="kes-row" :class="kesClass">
      <v-icon size="14" :color="kesColor">mdi-key-chain</v-icon>
      <span class="kes-text">KES {{ kesPeriod }}</span>
      <span class="kes-badge" :class="kesBadgeClass">{{ kesRemaining }} {{ $t('poolOperator.periodsRemaining') }}</span>
      <span class="kes-days">{{ kesDays }}</span>
      <v-spacer />
      <v-btn v-if="kesRemaining < 50" x-small :color="kesRemaining < 20 ? '#FDA29B' : '#FDB022'" class="black--text" style="text-transform:none;font-weight:700;border-radius:6px;letter-spacing:normal" @click="$emit('rotate-kes')">
        <v-icon x-small left>mdi-key-change</v-icon>
        {{ $t('poolOperator.rotateNow') }}
      </v-btn>
    </div>

    <!-- Node cards -->
    <div v-if="nodes.length > 0" class="node-grid">
      <div v-for="node in nodes" :key="node.id" class="node-row" :class="{ 'node-off': !node.connected }">
        <div class="nr-top">
          <div class="nr-badge" :class="node.type === 'bp' ? 'nr-bp' : 'nr-relay'">
            <v-icon size="11" :color="node.type === 'bp' ? '#FDB022' : '#2DF0F7'">{{ node.type === 'bp' ? 'mdi-shield-star' : 'mdi-access-point' }}</v-icon>
          </div>
          <span class="nr-name nrs-clickable" @click.stop="$emit('show-live', node)">{{ node.name }} <v-icon x-small color="rgba(255,255,255,0.3)">mdi-monitor-dashboard</v-icon></span>
          <span v-if="node.connected" class="nr-dot" />
          <span v-else class="nr-offline">{{ $t('poolOperator.offline') }}</span>
          <v-spacer />
          <v-btn icon x-small class="nr-action" @click="$emit('edit-node', node)"><v-icon x-small color="rgba(255,255,255,0.3)">mdi-pencil</v-icon></v-btn>
          <v-btn icon x-small class="nr-action" @click="$emit('remove-node', node.id)"><v-icon x-small color="rgba(255,255,255,0.3)">mdi-close</v-icon></v-btn>
        </div>
        <div v-if="node.data && node.connected" class="nr-stats">
          <span class="nrs"><strong>{{ node.data.blockHeight?.toLocaleString() }}</strong> Block</span>
          <span class="nrs nrs-clickable" @click.stop="$emit('show-peers', node)"><strong>{{ node.data.peers }}</strong> Peers <v-icon x-small color="rgba(255,255,255,0.3)">mdi-open-in-new</v-icon></span>
          <span class="nrs"><strong>{{ fmtMem(node.data.memoryMb) }}</strong> RAM</span>
          <span class="nrs"><strong>{{ node.data.cpuPercent?.toFixed(0) }}%</strong> CPU</span>
          <span class="nrs"><strong>{{ node.data.mempoolTxs }}</strong> Mempool</span>
        </div>
        <div v-if="node.data && node.connected && node.type === 'bp'" class="nr-epoch">
          <span>Epoch {{ node.data.epoch }}</span>
          <div class="nr-epoch-bar"><div class="nr-epoch-fill" :style="{ width: epochPct(node.data) + '%' }" /></div>
          <span>{{ epochPct(node.data) }}%</span>
        </div>
        <div v-if="versions[node.id]" class="nr-versions">
          <span v-if="versions[node.id].versions?.cardanoNode">node <strong>{{ versions[node.id].versions.cardanoNode }}</strong></span>
          <span v-if="versions[node.id].versions?.cncli">cncli <strong>{{ versions[node.id].versions.cncli }}</strong></span>
          <span v-if="versions[node.id].versions?.geroNodeMonitor">agent <strong>{{ versions[node.id].versions.geroNodeMonitor }}</strong></span>
        </div>
        <div v-if="versions[node.id]?.updates && Object.keys(versions[node.id].updates).length" class="nr-update">
          <v-icon x-small color="#FDB022" class="mr-1">mdi-arrow-up-circle</v-icon>
          <span v-for="(u, k) in versions[node.id].updates" :key="k">{{ k === 'cardanoNode' ? 'Node' : k }} {{ u.current }} → {{ u.latest }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import snackbar from '@/plugins/snackbar';

const { t } = useTranslation();

defineProps<{
  nodes: any[];
  versions: Record<string, any>;
  kesRemaining?: number;
  kesPeriod?: number;
  kesColor: string;
  kesClass: string;
  kesBadgeClass: string;
  kesDays: string;
  setupSteps: { title: string; code?: string }[];
}>();

defineEmits(['add-node', 'edit-node', 'remove-node', 'rotate-kes', 'show-peers', 'show-live']);

function fmtMem(mb: number): string {
  if (!mb) return '--';
  return mb >= 1024 ? (mb / 1024).toFixed(1) + 'G' : mb + 'M';
}

function epochPct(d: any): string {
  const total = (d.epochSlot || 0) + (d.epochSlotsRemaining || 0);
  return total ? ((d.epochSlot / total) * 100).toFixed(1) : '0';
}

function copyText(text: string) {
  navigator.clipboard.writeText(text);
  snackbar.fireSuccess(t('common.copied'));
}
</script>

<style scoped>
.infra-card { padding: 14px; }

.card-header {
  font-size: 11px; font-weight: 600; color: white;
  text-transform: uppercase; letter-spacing: 0.5px;
  display: flex; align-items: center; margin-bottom: 10px;
}

.add-btn { text-transform: none !important; letter-spacing: normal !important; font-size: 12px !important; color: #2DF0F7 !important; }

/* Setup */
.setup-inline { padding: 10px; background: rgba(0,0,0,0.1); border: 1px solid rgba(45,240,247,0.08); border-radius: 10px; }
.setup-row { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 10px; }
.setup-title { font-size: 14px; font-weight: 700; color: rgba(255,255,255,0.9); }
.setup-desc { font-size: 12px; color: rgba(255,255,255,0.5); line-height: 1.5; margin-top: 2px; }
.setup-steps { display: flex; flex-direction: column; gap: 6px; }
.setup-step { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.step-num { width: 18px; height: 18px; min-width: 18px; border-radius: 50%; background: rgba(45,240,247,0.1); color: #2DF0F7; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.step-text { font-size: 12px; color: rgba(255,255,255,0.7); }
.step-code { display: flex; align-items: center; gap: 4px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 4px; padding: 2px 8px; cursor: pointer; }
.step-code code { font-family: 'Roboto Mono', monospace; font-size: 10px; color: #75E0A7; }

/* KES */
.kes-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); margin-bottom: 8px; flex-wrap: wrap; }
.kes-row.kes-critical { border-color: rgba(253,162,155,0.2); background: rgba(253,162,155,0.03); }
.kes-row.kes-warning { border-color: rgba(253,176,34,0.15); }
.kes-text { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.7); }
.kes-badge { font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 4px; }
.kes-badge.text-critical { background: rgba(253,162,155,0.15); color: #FDA29B; }
.kes-badge.text-warning { background: rgba(253,176,34,0.12); color: #FDB022; }
.kes-badge.text-healthy { background: rgba(117,224,167,0.1); color: #75E0A7; }
.kes-days { font-size: 12px; color: rgba(255,255,255,0.45); }

/* Node cards */
.node-grid { display: flex; flex-direction: column; gap: 6px; }

.node-row { background: rgba(0,0,0,0.12); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; padding: 10px; transition: border-color 0.2s; }
.node-row:hover { border-color: rgba(255,255,255,0.1); }
.node-off { opacity: 0.45; }

.nr-top { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.nr-badge { width: 22px; height: 22px; border-radius: 6px; display: flex; align-items: center; justify-content: center; }
.nr-bp { background: rgba(253,176,34,0.1); }
.nr-relay { background: rgba(45,240,247,0.1); }
.nr-name { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.85); }
.nr-dot { width: 5px; height: 5px; border-radius: 50%; background: #75E0A7; box-shadow: 0 0 6px rgba(117,224,167,0.6); animation: pulse 2s ease-in-out infinite; }
.nr-offline { font-size: 11px; color: #FDA29B; font-weight: 600; }
.nr-action { opacity: 0; transition: opacity 0.15s; }
.node-row:hover .nr-action { opacity: 1; }

@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }

.nr-stats { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; color: rgba(255,255,255,0.6); margin-bottom: 4px; }
.nr-stats strong { color: rgba(255,255,255,0.9); font-weight: 700; font-variant-numeric: tabular-nums; }
.nrs-clickable { cursor: pointer; transition: color 0.15s; border-bottom: 1px dashed rgba(255,255,255,0.15); padding-bottom: 1px; }
.nrs-clickable:hover { color: #A078FF; }

.nr-epoch { display: flex; align-items: center; gap: 6px; font-size: 11px; color: rgba(255,255,255,0.45); margin-top: 4px; }
.nr-epoch-bar { flex: 1; height: 3px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; }
.nr-epoch-fill { height: 100%; background: linear-gradient(90deg, #00c7f3, #00ffd1); border-radius: 2px; }

.nr-versions { display: flex; gap: 10px; font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 4px; }
.nr-versions strong { color: rgba(255,255,255,0.65); font-weight: 600; }

.nr-update { margin-top: 4px; padding: 4px 8px; background: rgba(253,176,34,0.06); border: 1px solid rgba(253,176,34,0.12); border-radius: 4px; font-size: 11px; color: #FDB022; font-weight: 600; display: flex; align-items: center; gap: 4px; }
</style>
