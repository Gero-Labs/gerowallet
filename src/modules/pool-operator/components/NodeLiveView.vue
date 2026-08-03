<template>
  <div class="glv">
    <!-- ═══ EPOCH ═══ -->
    <div class="glv-row glv-epoch-row">
      <span class="glv-k">Epoch</span><span class="glv-v">{{ d.epoch }}</span>
      <span class="glv-dim">[</span>
      <div class="glv-epoch-bar"><div class="glv-epoch-fill" :style="{ width: epochPct + '%' }" /></div>
      <span class="glv-dim">]</span>
      <span class="glv-v-accent">{{ epochPct }}%</span>
      <span class="glv-dim">{{ epochTimeLeft }} remaining</span>
    </div>

    <!-- ═══ CORE METRICS (3x3 grid matching gLiveView) ═══ -->
    <div class="glv-section-label">── CHAIN ──</div>
    <div class="glv-grid">
      <span class="glv-k">Block</span><span class="glv-v">{{ d.blockHeight?.toLocaleString() }}</span>
      <span class="glv-k">Tip (ref)</span><span class="glv-v">{{ d.tipRef?.toLocaleString() }}</span>
      <span class="glv-k">Forks</span><span class="glv-v">{{ d.forks || 0 }}</span>

      <span class="glv-k">Slot</span><span class="glv-v">{{ d.slotNo?.toLocaleString() }}</span>
      <span class="glv-k">Density</span><span class="glv-v">{{ d.density || 0 }}</span>
      <span class="glv-k">Total Tx</span><span class="glv-v">{{ d.txsProcessed?.toLocaleString() || 0 }}</span>

      <span class="glv-k">Slot epoch</span><span class="glv-v">{{ d.epochSlot?.toLocaleString() }}</span>
      <span class="glv-k">Sync</span><span class="glv-v" :class="syncClass">{{ d.syncProgress || 0 }}%</span>
      <span class="glv-k">Pending Tx</span><span class="glv-v">{{ d.mempoolTxs || 0 }}/{{ fmtBytes(d.mempoolBytes) }}</span>
    </div>

    <!-- ═══ CONNECTIONS ═══ -->
    <div class="glv-section-label">── CONNECTIONS ──── Incoming ◄ ──────── Outgoing ► ──</div>
    <div class="glv-grid">
      <span class="glv-k">Bi-Dir</span><span class="glv-v">{{ d.connections?.biDir || 0 }}</span>
      <span class="glv-k glv-k-in">Warm</span><span class="glv-v">{{ d.connections?.inWarm || 0 }}</span>
      <span class="glv-k glv-k-out">Warm</span><span class="glv-v">{{ d.connections?.outWarm || 0 }}</span>

      <span class="glv-k">Duplex</span><span class="glv-v">{{ d.connections?.duplex || 0 }}</span>
      <span class="glv-k glv-k-in">Hot</span><span class="glv-v">{{ d.connections?.inHot || 0 }}</span>
      <span class="glv-k glv-k-out">Hot</span><span class="glv-v">{{ d.connections?.outHot || 0 }}</span>
    </div>

    <!-- ═══ BLOCK PROPAGATION ═══ -->
    <div class="glv-section-label">── BLOCK PROPAGATION ──</div>
    <div class="glv-row">
      <span class="glv-k">Last Block</span><span class="glv-v" :class="delayClass">{{ d.lastBlockDelay || 0 }}s</span>
      <span class="glv-dim">Less than 1|3|5s [%]</span>
      <span class="glv-v">{{ d.blockDelayPct?.within1s || 0 }}</span>
      <span class="glv-dim">|</span>
      <span class="glv-v">{{ d.blockDelayPct?.within3s || 0 }}</span>
      <span class="glv-dim">|</span>
      <span class="glv-v">{{ d.blockDelayPct?.within5s || 0 }}</span>
    </div>

    <!-- ═══ NODE RESOURCE USAGE ═══ -->
    <div class="glv-section-label">── NODE RESOURCE USAGE ──</div>
    <div class="glv-row">
      <span class="glv-k">CPU (sys)</span>
      <div class="glv-bar-mini"><div class="glv-bar-fill" :class="cpuClass" :style="{ width: Math.min(d.cpuPercent || 0, 100) + '%' }" /></div>
      <span class="glv-v">{{ d.cpuPercent?.toFixed(2) || 0 }}%</span>
      <span class="glv-k">Mem (RSS)</span><span class="glv-v">{{ fmtMem(d.memoryMb) }}</span>
      <span class="glv-k">Disk util</span><span class="glv-v">{{ d.diskPct || 0 }}%</span>
    </div>

    <!-- ═══ CORE (BP only) ═══ -->
    <template v-if="node.type === 'bp'">
      <div class="glv-section-label">── CORE ──</div>
      <!-- KES -->
      <div v-if="d.kesPeriod != null" class="glv-row">
        <span class="glv-k">KES</span>
        <span class="glv-dim">current|remaining|exp</span>
        <span class="glv-v">{{ d.kesPeriod }}</span>
        <span class="glv-dim">|</span>
        <span class="glv-v" :class="kesClass">{{ d.kesRemaining }}</span>
        <span class="glv-dim">|</span>
        <span class="glv-v">{{ kesExpiry }}</span>
      </div>
      <!-- OP Cert -->
      <div v-if="d.opCert" class="glv-row">
        <span class="glv-k">OP Cert</span>
        <span class="glv-dim">disk|chain</span>
        <span class="glv-v">{{ d.opCert?.disk ?? '--' }}</span>
        <span class="glv-dim">|</span>
        <span class="glv-v">{{ d.opCert?.chain ?? '--' }}</span>
      </div>

      <!-- ═══ BLOCK PRODUCTION ═══ -->
      <div v-if="schedule" class="glv-section-label">── BLOCK PRODUCTION ──</div>
      <div v-if="schedule" class="glv-grid">
        <span class="glv-k">Leader</span><span class="glv-v">{{ schedule.totalSlots }}</span>
        <span class="glv-k">Adopted</span><span class="glv-v val-ok">{{ schedule.producedCount }}</span>
        <span class="glv-k">Confirmed</span><span class="glv-v val-ok">{{ schedule.producedCount }}</span>

        <span class="glv-k">Pending</span><span class="glv-v">{{ schedule.pendingCount || 0 }}</span>
        <span class="glv-k">Missed</span><span class="glv-v" :class="schedule.missedCount ? 'val-err' : ''">{{ schedule.missedCount || 0 }}</span>
        <span class="glv-k">Lost</span><span class="glv-v">0</span>
      </div>
      <!-- Next block countdown -->
      <div v-if="nextSlotCountdown" class="glv-row">
        <span class="glv-k">Next Block</span><span class="glv-v val-accent">{{ nextSlotCountdown }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';

const props = defineProps<{
  node: any;
  versions?: any;
  schedule?: any;
  nextCountdown?: string;
  visible?: boolean;
}>();

const liveData = ref<any>(null);
let pollTimer: any = null;

async function poll() {
  if (!props.node?.url) return;
  try {
    const { nodeFetch } = await import('../utils/nodeFetch');
    const data = await nodeFetch(`${props.node.url}/status`, 8000);
    if (data && !data.error) liveData.value = data;
  } catch {}
}

function startPolling() {
  stopPolling();
  poll();
  pollTimer = setInterval(poll, 10000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

watch(() => props.visible, (val) => {
  if (val) startPolling();
  else stopPolling();
}, { immediate: true });

onBeforeUnmount(() => stopPolling());

// Use live data if available, fall back to initial node.data
const d = computed(() => liveData.value || props.node?.data || {});
const _v = computed(() => props.versions);

const epochPct = computed(() => {
  const slot = d.value.epochSlot || 0;
  const remaining = d.value.epochSlotsRemaining || 0;
  const total = slot + remaining;
  return total > 0 ? ((slot / total) * 100).toFixed(1) : '0';
});

const epochTimeLeft = computed(() => {
  const remaining = d.value.epochSlotsRemaining || 0;
  const seconds = remaining; // 1 slot ≈ 1 second
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
});

const syncClass = computed(() => {
  const s = d.value.syncProgress || 0;
  if (s >= 100) return 'val-ok';
  if (s >= 99) return 'val-warn';
  return 'val-err';
});

const delayClass = computed(() => {
  const delay = d.value.lastBlockDelay || 0;
  if (delay < 1) return 'val-ok';
  if (delay < 3) return 'val-warn';
  return 'val-err';
});

const kesClass = computed(() => {
  const r = d.value.kesRemaining;
  if (r == null) return '';
  if (r < 20) return 'val-err';
  if (r < 50) return 'val-warn';
  return 'val-ok';
});

const kesExpiry = computed(() => {
  const exp = d.value.kesExpiry;
  if (!exp) return '--';
  return new Date(exp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
});

const cpuClass = computed(() => {
  const c = d.value.cpuPercent || 0;
  if (c < 50) return 'bar-ok';
  if (c < 80) return 'bar-warn';
  return 'bar-err';
});

const nextSlotCountdown = computed(() => props.nextCountdown);

function _formatUptime(seconds: number): string {
  if (!seconds) return '--';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtMem(mb: number): string {
  if (!mb) return '--';
  return mb >= 1024 ? (mb / 1024).toFixed(1) + 'G' : mb + 'M';
}

function fmtBytes(bytes: number): string {
  if (!bytes) return '0';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + 'MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return bytes + 'B';
}
</script>

<style scoped>
.glv {
  font-family: var(--g-font-mono);
  font-size: 11px;
  padding: 10px 12px;
  line-height: 1.6;
}

/* Shared row */
.glv-row {
  display: flex; align-items: center; gap: 6px;
  flex-wrap: wrap;
  padding: 2px 0;
  border-bottom: 1px solid var(--g-hairline-1);
}

/* Key-value tokens */
.glv-k {
  font-size: 11px; font-weight: 600; color: var(--g-text-3);
  text-transform: uppercase; letter-spacing: 0.3px;
  min-width: 58px;
}
.glv-v {
  font-weight: 700; color: var(--g-text-1);
  font-variant-numeric: tabular-nums;
}
.glv-v-accent { font-weight: 700; color: var(--g-accent); }
.glv-dim { font-size: 11px; color: var(--g-text-3); }
.glv-hash { font-size: 11px; color: var(--g-text-3); }
.glv-k-in { color: var(--g-accent); }
.glv-k-out { color: var(--g-warning); }

/* Section labels (gLiveView style separators) */
.glv-section-label {
  font-size: 11px; font-weight: 600; color: var(--g-accent);
  letter-spacing: 0.5px; padding: 4px 0 2px;
  border-top: 1px solid var(--g-hairline-1);
  margin-top: 2px;
}

/* Header */
.glv-header { padding-bottom: 4px; border-bottom: 1px solid var(--g-hairline-1); margin-bottom: 2px; }
.glv-name { font-size: 12px; font-weight: 700; color: var(--g-text-1); }
.glv-tag {
  font-size: 11px; font-weight: 700; padding: 1px 4px;
  border-radius: 4px; text-transform: uppercase;
  background: var(--g-hairline-1); color: var(--g-text-3);
}

/* Epoch bar */
.glv-epoch-row { gap: 6px; }
.glv-epoch-bar { flex: 1; height: 3px; background: var(--g-hairline-1); border-radius: 4px; overflow: hidden; min-width: 60px; }
.glv-epoch-fill { height: 100%; background: var(--g-accent); border-radius: 4px; transition: width 1s; }

/* Core metrics grid — 6 columns: key val key val key val */
.glv-grid {
  display: grid;
  grid-template-columns: auto 1fr auto 1fr auto 1fr;
  gap: 1px 8px;
  padding: 4px 0;
  border-bottom: 1px solid var(--g-hairline-1);
}

/* Mini bar (CPU etc) */
.glv-bar-mini { width: 40px; height: 3px; background: var(--g-hairline-1); border-radius: 4px; overflow: hidden; }
.glv-bar-fill { height: 100%; border-radius: 4px; transition: width 0.6s; }
.bar-ok { background: var(--g-success); }
.bar-warn { background: var(--g-warning); }
.bar-err { background: var(--g-error); }

/* Value colors */
.val-ok { color: var(--g-success); }
.val-warn { color: var(--g-warning); }
.val-err { color: var(--g-error); }
.val-accent { color: var(--g-warning); }
</style>
