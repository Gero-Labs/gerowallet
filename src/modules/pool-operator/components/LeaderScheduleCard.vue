<template>
  <div class="ls-card liquid-glass">
    <div class="card-header">
      <v-icon size="14" color="white" class="mr-1">mdi-calendar-clock</v-icon>
      <span>{{ $t('poolOperator.leaderSchedule') }}</span>
      <v-progress-circular v-if="loading" indeterminate size="10" width="1" color="#FDB022" class="ml-2" />
    </div>

    <div v-if="!connected" class="ls-offline">
      <v-icon small color="rgba(255,255,255,0.3)">mdi-server-off</v-icon>
      <span>{{ $t('poolOperator.nodeRequiredForSchedule') }}</span>
    </div>

    <div v-else class="ls-row">
      <!-- Current Epoch -->
      <div class="ls-epoch">
        <div class="ls-epoch-header">
          <span class="ls-epoch-label">{{ $t('poolOperator.currentEpoch') }}</span>
          <span v-if="current" class="ls-epoch-num">{{ current.epoch }}</span>
        </div>
        <div v-if="current" class="ls-epoch-stats">
          <div class="ls-stat">
            <span class="ls-val">{{ current.totalSlots }}</span>
            <span class="ls-lbl">slots</span>
          </div>
          <div class="ls-stat">
            <span class="ls-val ls-ok">{{ current.producedCount }}</span>
            <span class="ls-lbl">produced</span>
          </div>
          <div v-if="current.missedCount > 0" class="ls-stat">
            <span class="ls-val ls-err">{{ current.missedCount }}</span>
            <span class="ls-lbl">missed</span>
          </div>
          <div v-if="nextCountdown" class="ls-stat">
            <span class="ls-val ls-accent">{{ nextCountdown }}</span>
            <span class="ls-lbl">next</span>
          </div>
        </div>
        <div v-else class="ls-empty">--</div>

        <!-- Slot timeline for current epoch -->
        <div v-if="current && current.slots && current.slots.length" class="ls-slots">
          <div v-for="slot in current.slots" :key="slot.slot" class="ls-slot" :class="slotClass(slot)">
            <div class="ls-slot-icon">
              <v-icon size="10" :color="slotColor(slot)">{{ slotIcon(slot) }}</v-icon>
            </div>
            <div class="ls-slot-info">
              <span class="ls-slot-time">{{ formatSlotTime(slot.timestamp) }}</span>
              <span v-if="slot.blockNo" class="ls-slot-block">#{{ slot.blockNo }}</span>
            </div>
            <span class="ls-slot-status" :class="'ls-st-' + slotStatus(slot)">{{ slotStatusLabel(slot) }}</span>
          </div>
        </div>
      </div>

      <!-- Vertical Divider -->
      <div class="ls-vdivider" />

      <!-- Next Epoch -->
      <div class="ls-epoch">
        <div class="ls-epoch-header">
          <span class="ls-epoch-label">{{ $t('poolOperator.nextEpoch') }}</span>
          <span v-if="next" class="ls-epoch-num">{{ next.epoch }}</span>
        </div>
        <div v-if="next" class="ls-epoch-stats">
          <div class="ls-stat">
            <span class="ls-val">{{ next.totalSlots }}</span>
            <span class="ls-lbl">slots</span>
          </div>
        </div>
        <div v-else class="ls-empty">--</div>

        <!-- Slot timeline for next epoch -->
        <div v-if="next && next.slots && next.slots.length" class="ls-slots">
          <div v-for="slot in next.slots" :key="slot.slot" class="ls-slot ls-slot--pending">
            <div class="ls-slot-icon">
              <v-icon size="10" color="rgba(255,255,255,0.3)">mdi-clock-outline</v-icon>
            </div>
            <div class="ls-slot-info">
              <span class="ls-slot-time">{{ formatSlotTime(slot.timestamp) }}</span>
            </div>
            <span class="ls-slot-status ls-st-pending">{{ $t('poolOperator.pending') }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();

defineProps<{
  connected: boolean;
  loading: boolean;
  current?: any;
  next?: any;
  nextCountdown?: string;
}>();

function slotStatus(slot: any): string {
  if (slot.produced === true) return 'produced';
  if (slot.produced === false) return 'missed';
  return 'pending';
}

function slotClass(slot: any): string {
  if (slot.produced === true) return 'ls-slot--produced';
  if (slot.produced === false) return 'ls-slot--missed';
  return 'ls-slot--pending';
}

function slotColor(slot: any): string {
  if (slot.produced === true) return '#75E0A7';
  if (slot.produced === false) return '#FDA29B';
  return '#FDB022';
}

function slotIcon(slot: any): string {
  if (slot.produced === true) return 'mdi-check-circle';
  if (slot.produced === false) return 'mdi-close-circle';
  return 'mdi-clock-outline';
}

function slotStatusLabel(slot: any): string {
  if (slot.produced === true) return slot.status || t('poolOperator.produced');
  if (slot.produced === false) return slot.status || t('poolOperator.missed');
  return t('poolOperator.pending');
}

function formatSlotTime(timestamp: number): string {
  if (!timestamp) return '--';
  const d = new Date(timestamp * 1000);
  const now = Date.now();
  const diff = timestamp * 1000 - now;

  const timeStr = d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  if (diff > 0) {
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const rel = h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
    return `${timeStr} (${rel})`;
  }
  if (diff > -3600000) {
    const m = Math.floor(-diff / 60000);
    return `${timeStr} (${m}m ago)`;
  }
  return timeStr;
}
</script>

<style scoped>
.ls-card { padding: 14px; }

.card-header {
  font-size: 11px; font-weight: 600; color: white;
  text-transform: uppercase; letter-spacing: 0.5px;
  display: flex; align-items: center; margin-bottom: 12px;
}

.ls-offline {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: rgba(255,255,255,0.4);
  padding: 12px 0;
}

.ls-row { display: flex; gap: 0; }
.ls-epoch { padding: 4px 0; flex: 1; min-width: 0; }

.ls-epoch-header {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;
}

.ls-epoch-label { font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.6); }
.ls-epoch-num { font-size: 11px; color: rgba(255,255,255,0.4); font-variant-numeric: tabular-nums; }

.ls-epoch-stats { display: flex; gap: 14px; align-items: baseline; }
.ls-stat { display: flex; align-items: baseline; gap: 3px; }

.ls-val { font-size: 20px; font-weight: 800; color: rgba(255,255,255,0.95); font-variant-numeric: tabular-nums; }
.ls-ok { color: #75E0A7; }
.ls-err { color: #FDA29B; }
.ls-accent { color: #FDB022; }

.ls-lbl { font-size: 10px; color: rgba(255,255,255,0.4); }
.ls-empty { font-size: 16px; color: rgba(255,255,255,0.15); padding: 4px 0; }

.ls-vdivider { width: 1px; background: rgba(255,255,255,0.06); margin: 0 20px; align-self: stretch; }

/* Slot timeline */
.ls-slots {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(255,255,255,0.04);
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
}

.ls-slots::-webkit-scrollbar { width: 3px; }
.ls-slots::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

.ls-slot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  background: rgba(255,255,255,0.02);
  transition: background 0.15s;
}

.ls-slot:hover { background: rgba(255,255,255,0.05); }

.ls-slot--produced { border-left: 2px solid #75E0A7; }
.ls-slot--missed { border-left: 2px solid #FDA29B; }
.ls-slot--pending { border-left: 2px solid rgba(253,176,34,0.4); }

.ls-slot-icon { flex-shrink: 0; display: flex; align-items: center; }

.ls-slot-info {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 6px;
}

.ls-slot-time {
  font-family: 'Roboto Mono', monospace;
  font-size: 11px;
  color: rgba(255,255,255,0.7);
  white-space: nowrap;
}

.ls-slot-block {
  font-family: 'Roboto Mono', monospace;
  font-size: 10px;
  color: rgba(255,255,255,0.4);
}

.ls-slot-status {
  font-size: 9px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.3px;
  white-space: nowrap;
  flex-shrink: 0;
}

.ls-st-produced { color: #75E0A7; }
.ls-st-missed { color: #FDA29B; }
.ls-st-pending { color: rgba(253,176,34,0.6); }

@media (max-width: 500px) {
  .ls-row { flex-direction: column; }
  .ls-vdivider { width: auto; height: 1px; margin: 8px 0; }
}
</style>
