<template>
  <div class="peers-card liquid-glass">
    <div class="card-header">
      <v-icon size="14" color="var(--g-info)" class="mr-1">mdi-lan</v-icon>
      <span>{{ $t('poolOperator.networkPeers') }}</span>
      <v-spacer />
      <v-progress-circular v-if="loading" indeterminate size="10" width="1" color="var(--g-info)" class="mr-2" />
      <span v-if="peerData" class="mode-badge" :class="peerData.mode === 'p2p' ? 'mode-p2p' : 'mode-legacy'">
        {{ peerData.mode === 'p2p' ? $t('poolOperator.p2pMode') : $t('poolOperator.legacyMode') }}
      </span>
    </div>

    <div v-if="!connected" class="peers-offline">
      <v-icon small color="var(--g-text-3)">mdi-server-off</v-icon>
      <span>{{ $t('poolOperator.noPeerData') }}</span>
    </div>

    <!-- Fallback -->
    <div v-else-if="!peerData && nodeData" class="peer-summary">
      <div class="peer-count">
        <span class="pc-val pc-total">{{ nodeData.peers || 0 }}</span>
        <span class="pc-lbl">{{ $t('poolOperator.peers') }}</span>
      </div>
      <div v-if="loading" class="peers-loading">
        <v-progress-circular indeterminate size="14" width="1" color="var(--g-text-3)" class="mr-2" />
        <span>{{ $t('poolOperator.loadingPeerDetails') }}</span>
      </div>
      <div v-else-if="fetchFailed" class="peers-hint">
        <v-icon x-small color="var(--g-text-3)" class="mr-1">mdi-information-outline</v-icon>
        <span>{{ $t('poolOperator.peersEndpointUnavailable') }}</span>
      </div>
    </div>

    <template v-else-if="peerData">
      <!-- Summary chips -->
      <div class="peer-chips">
        <span class="chip" :class="{ 'chip-active': filter === 'all' }" @click="filter = 'all'">
          {{ $t('common.all') }} {{ peerData.peers?.length || 0 }}
        </span>
        <span v-if="peerData.inbound" class="chip chip-in" :class="{ 'chip-active': filter === 'in' }" @click="filter = filter === 'in' ? 'all' : 'in'">
          <v-icon size="9" color="var(--g-accent)">mdi-arrow-down-bold</v-icon> {{ peerData.inbound }} {{ $t('poolOperator.inbound') }}
        </span>
        <span v-if="peerData.outbound" class="chip chip-out" :class="{ 'chip-active': filter === 'out' }" @click="filter = filter === 'out' ? 'all' : 'out'">
          <v-icon size="9" color="warning">mdi-arrow-up-bold</v-icon> {{ peerData.outbound }} {{ $t('poolOperator.outbound') }}
        </span>
        <span v-if="peerData.bidirectional" class="chip chip-bi" :class="{ 'chip-active': filter === 'bi' }" @click="filter = filter === 'bi' ? 'all' : 'bi'">
          <v-icon size="9" color="var(--g-info)">mdi-swap-vertical-bold</v-icon> {{ peerData.bidirectional }} Bi
        </span>
        <span v-if="peerData.hotPeers" class="chip chip-hot" :class="{ 'chip-active': filter === 'hot' }" @click="filter = filter === 'hot' ? 'all' : 'hot'">
          <span class="chip-dot dot-hot" /> {{ peerData.hotPeers }} {{ $t('poolOperator.hot') }}
        </span>
        <span v-if="peerData.warmPeers" class="chip chip-warm" :class="{ 'chip-active': filter === 'warm' }" @click="filter = filter === 'warm' ? 'all' : 'warm'">
          <span class="chip-dot dot-warm" /> {{ peerData.warmPeers }} {{ $t('poolOperator.warm') }}
        </span>
        <span v-if="peerData.coldPeers" class="chip chip-cold" :class="{ 'chip-active': filter === 'cold' }" @click="filter = filter === 'cold' ? 'all' : 'cold'">
          <span class="chip-dot dot-cold" /> {{ peerData.coldPeers }} {{ $t('poolOperator.cold') }}
        </span>
        <span v-if="relayCount" class="chip chip-relay" :class="{ 'chip-active': filter === 'relay' }" @click="filter = filter === 'relay' ? 'all' : 'relay'">
          <v-icon size="9" color="var(--g-accent)">mdi-access-point</v-icon> {{ relayCount }} {{ $t('poolOperator.myRelays') }}
        </span>
        <span v-if="configuredCount" class="chip chip-cfg" :class="{ 'chip-active': filter === 'cfg' }" @click="filter = filter === 'cfg' ? 'all' : 'cfg'">
          <v-icon size="9" color="success">mdi-check-circle</v-icon> {{ configuredCount }} {{ $t('poolOperator.configured') }}
        </span>
      </div>

      <!-- Sort controls -->
      <div class="sort-row">
        <span class="sort-label">{{ $t('common.sortBy') }}:</span>
        <span v-for="opt in sortOptions" :key="opt.key" class="sort-opt" :class="{ 'sort-active': sortBy === opt.key }" @click="toggleSort(opt.key)">
          {{ opt.label }}
          <v-icon v-if="sortBy === opt.key" x-small :style="{ transform: sortAsc ? '' : 'rotate(180deg)' }">mdi-arrow-up</v-icon>
        </span>
      </div>

      <!-- Peer list -->
      <div v-if="sortedPeers.length" class="peer-list">
        <div v-for="(peer, i) in sortedPeers" :key="i" class="peer-row">
          <!-- Direction -->
          <div class="peer-dir">
            <v-icon size="11" :color="dirColor(peer.direction)">{{ dirIcon(peer.direction) }}</v-icon>
          </div>
          <!-- Address -->
          <div class="peer-addr-col">
            <span class="peer-addr">{{ peer.address }}</span>
            <span class="peer-port">:{{ peer.port }}</span>
          </div>
          <!-- Tags -->
          <span v-if="isRelay(peer)" class="peer-tag tag-relay">
            <v-icon size="8" color="var(--g-accent)">mdi-access-point</v-icon> relay
          </span>
          <span v-if="peer.configured" class="peer-tag tag-cfg">cfg</span>
          <span v-if="peer.trustable" class="peer-tag tag-trust">trust</span>
          <!-- RTT -->
          <span v-if="peer.rtt != null" class="peer-rtt" :class="rttClass(peer.rtt)">
            {{ formatRtt(peer.rtt) }}
          </span>
        </div>
      </div>
      <div v-else class="peers-hint" style="padding: 12px 0">{{ $t('poolOperator.noPeersInFilter') }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { poolOperatorStore } from '@/stores/poolOperatorStore';

const { t } = useTranslation();

const props = defineProps<{
  connected: boolean;
  nodeUrl?: string;
  nodeData?: any;
}>();

const loading = ref(false);
const peerData = ref<any>(null);
const fetchFailed = ref(false);
const filter = ref('all');
const sortBy = ref('rtt');
const sortAsc = ref(true);
let pollTimer: any = null;


function isRelay(peer: any): boolean {
  // Only trust explicit signals — server's relay flag or trustable topology peers
  if (peer.relay) return true;
  if (peer.trustable) return true;
  return false;
}

const relayCount = computed(() => peerData.value?.peers?.filter((p: any) => isRelay(p)).length || 0);
const configuredCount = computed(() => peerData.value?.peers?.filter((p: any) => p.configured).length || 0);

const sortOptions = computed(() => [
  { key: 'rtt', label: 'RTT' },
  { key: 'dir', label: t('poolOperator.direction') || 'Direction' },
  { key: 'addr', label: 'IP' },
]);

function toggleSort(key: string) {
  if (sortBy.value === key) sortAsc.value = !sortAsc.value;
  else { sortBy.value = key; sortAsc.value = true; }
}

const sortedPeers = computed(() => {
  if (!peerData.value?.peers) return [];
  let peers = [...peerData.value.peers];

  // Filter
  if (filter.value === 'in') peers = peers.filter(p => p.direction === 'in');
  else if (filter.value === 'out') peers = peers.filter(p => p.direction === 'out');
  else if (filter.value === 'bi') peers = peers.filter(p => p.direction === 'bi');
  else if (filter.value === 'relay') peers = peers.filter(p => isRelay(p));
  else if (filter.value === 'cfg') peers = peers.filter(p => p.configured);
  else if (filter.value === 'hot') peers = peers.filter(p => p.state === 'hot');
  else if (filter.value === 'warm') peers = peers.filter(p => p.state === 'warm');
  else if (filter.value === 'cold') peers = peers.filter(p => p.state === 'cold');

  // Sort
  const dir = sortAsc.value ? 1 : -1;
  if (sortBy.value === 'rtt') {
    peers.sort((a, b) => ((a.rtt ?? 99999) - (b.rtt ?? 99999)) * dir);
  } else if (sortBy.value === 'dir') {
    const order: Record<string, number> = { out: 0, bi: 1, in: 2 };
    peers.sort((a, b) => ((order[a.direction] ?? 3) - (order[b.direction] ?? 3)) * dir);
  } else if (sortBy.value === 'addr') {
    peers.sort((a, b) => a.address.localeCompare(b.address) * dir);
  }

  return peers;
});

async function fetchPeers() {
  if (!props.nodeUrl) return;
  loading.value = true;
  try {
    const { nodeFetch } = await import('../utils/nodeFetch');
    const data = await nodeFetch(`${props.nodeUrl}/peers`, 15000);
    if (data && !data.error) {
      peerData.value = data;
      fetchFailed.value = false;
    } else {
      fetchFailed.value = true;
    }
  } catch {
    fetchFailed.value = true;
  } finally {
    loading.value = false;
  }
}

function startPolling() {
  stopPolling();
  if (props.connected && props.nodeUrl) {
    fetchPeers();
    pollTimer = setInterval(fetchPeers, 30000);
  }
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

watch(() => [props.connected, props.nodeUrl], () => {
  if (props.connected && props.nodeUrl) startPolling();
  else stopPolling();
}, { immediate: true });

onMounted(() => { if (props.connected && props.nodeUrl) startPolling(); });
onBeforeUnmount(() => stopPolling());

function dirIcon(dir: string): string {
  if (dir === 'in') return 'mdi-arrow-down-bold';
  if (dir === 'bi') return 'mdi-swap-vertical-bold';
  return 'mdi-arrow-up-bold';
}

function dirColor(dir: string): string {
  if (dir === 'in') return 'var(--g-accent)';
  if (dir === 'bi') return 'var(--g-info)';
  return 'var(--g-warning)';
}

function formatRtt(rtt: number): string {
  if (rtt < 0.001) return '<1ms';
  if (rtt < 1) return Math.round(rtt * 1000) + 'ms';
  return rtt.toFixed(1) + 's';
}

function rttClass(rtt: number): string {
  if (rtt < 0.05) return 'rtt-good';
  if (rtt < 0.2) return 'rtt-ok';
  return 'rtt-slow';
}
</script>

<style scoped>
.peers-card { padding: 14px; }

.card-header {
  font-size: 11px; font-weight: 600; color: var(--g-text-3);
  display: flex; align-items: center; margin-bottom: 12px;
}

.mode-badge {
  font-size: 11px; font-weight: 700; padding: 2px 8px;
  border-radius: var(--g-r-control);
}
.mode-p2p { background: rgba(160,120,255,0.15); color: var(--g-info); }
.mode-legacy { background: rgba(255,255,255,0.06); color: var(--g-text-3); }

.peers-offline {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: var(--g-text-3); padding: 12px 0;
}

.peers-loading, .peers-hint {
  display: flex; align-items: center;
  font-size: 11px; color: var(--g-text-3);
}
.peers-hint { margin-top: 4px; }

/* Filter chips */
.peer-chips {
  display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px;
}

.chip {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 11px; font-weight: 600; padding: 3px 8px;
  border-radius: var(--g-r-card); cursor: pointer; white-space: nowrap;
  background: rgba(255,255,255,0.04); color: var(--g-text-3);
  border: 1px solid transparent;
  transition: all 0.15s;
}
.chip:hover { background: rgba(255,255,255,0.08); color: var(--g-text-2); }
.chip-active { border-color: var(--g-hairline-3); color: var(--g-text-1); background: rgba(255,255,255,0.08); }

.chip-in.chip-active { border-color: rgba(45,240,247,0.3); background: rgba(45,240,247,0.08); }
.chip-out.chip-active { border-color: rgba(253,176,34,0.3); background: rgba(253,176,34,0.08); }
.chip-bi.chip-active { border-color: rgba(160,120,255,0.3); background: rgba(160,120,255,0.08); }
.chip-hot.chip-active { border-color: rgba(117,224,167,0.3); background: rgba(117,224,167,0.08); }
.chip-warm.chip-active { border-color: rgba(253,176,34,0.3); background: rgba(253,176,34,0.08); }
.chip-cold.chip-active { border-color: var(--g-hairline-3); }
.chip-relay.chip-active { border-color: rgba(45,240,247,0.3); background: rgba(45,240,247,0.08); }
.chip-cfg.chip-active { border-color: rgba(117,224,167,0.3); background: rgba(117,224,167,0.08); }

.chip-dot { width: 5px; height: 5px; border-radius: 50%; }
.dot-hot { background: var(--g-success); }
.dot-warm { background: var(--g-warning); }
.dot-cold { background: var(--g-text-3); }

/* Sort controls */
.sort-row {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 6px; padding-bottom: 6px;
  border-bottom: 1px solid var(--g-hairline-1);
}

.sort-label { font-size: 11px; color: var(--g-text-3); }

.sort-opt {
  font-size: 11px; font-weight: 600; color: var(--g-text-3);
  cursor: pointer; display: inline-flex; align-items: center; gap: 2px;
  transition: color 0.15s;
}
.sort-opt:hover { color: var(--g-text-2); }
.sort-active { color: var(--g-info); }

/* Peer list */
.peer-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 350px;
  overflow-y: auto;
}

.peer-list::-webkit-scrollbar { width: 3px; }
.peer-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

.peer-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: var(--g-r-control);
  background: rgba(255,255,255,0.02);
  transition: background 0.15s;
}
.peer-row:hover { background: rgba(255,255,255,0.05); }

.peer-dir { flex-shrink: 0; display: flex; align-items: center; }

.peer-addr-col {
  flex: 1; min-width: 0;
  font-family: var(--g-font-mono);
  font-size: 11px;
}

.peer-addr { color: var(--g-text-2); }
.peer-port { color: var(--g-accent); }

/* Tags */
.peer-tag {
  font-size: 11px; font-weight: 700; padding: 1px 5px;
  border-radius: var(--g-r-chip);
  white-space: nowrap; display: inline-flex; align-items: center; gap: 2px;
}
.tag-relay { background: rgba(45,240,247,0.1); color: var(--g-accent); }
.tag-cfg { background: rgba(117,224,167,0.1); color: var(--g-success); }
.tag-trust { background: rgba(160,120,255,0.1); color: var(--g-info); }

.peer-rtt {
  font-family: var(--g-font-mono);
  font-size: 11px; font-weight: 600;
  white-space: nowrap; flex-shrink: 0;
}
.rtt-good { color: var(--g-success); }
.rtt-ok { color: var(--g-warning); }
.rtt-slow { color: var(--g-error); }
</style>
