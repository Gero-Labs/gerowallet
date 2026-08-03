<template>
  <div class="leader-schedule">
    <div class="section-header">
      <div class="section-title">
        <v-icon size="16" color="var(--g-text-1)" class="mr-2">mdi-calendar-clock</v-icon>
        {{ $t('poolOperator.leaderSchedule') }}
      </div>
    </div>

    <!-- Node not connected -->
    <div v-if="!nodeConnected" class="ls-notice liquid-glass-compact">
      <div class="ls-notice-icon" style="background: var(--g-warning-fill)">
        <v-icon size="20" color="warning">mdi-server-off</v-icon>
      </div>
      <div>
        <div class="ls-notice-title">{{ $t('poolOperator.nodeRequiredForSchedule') }}</div>
        <div class="ls-notice-text">{{ $t('poolOperator.nodeRequiredForScheduleDescription') }}</div>
      </div>
    </div>

    <!-- Node connected — schedule controls -->
    <template v-else>
      <div class="schedule-controls">
        <v-btn-toggle v-model="scheduleView" mandatory dense class="schedule-toggle">
          <v-btn x-small :value="'current'" class="toggle-btn">{{ $t('poolOperator.currentEpoch') }}</v-btn>
          <v-btn x-small :value="'next'" class="toggle-btn">{{ $t('poolOperator.nextEpoch') }}</v-btn>
        </v-btn-toggle>
        <v-btn text x-small class="refresh-btn" @click="fetchSchedule" :loading="loading">
          <v-icon x-small class="mr-1">mdi-refresh</v-icon>
          {{ $t('poolOperator.fetch') }}
        </v-btn>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="text-center py-6">
        <v-progress-circular indeterminate color="warning" size="24" />
        <div class="loading-text mt-2">{{ $t('poolOperator.calculatingSchedule') }}</div>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="ls-error liquid-glass-compact mt-3">
        <v-icon size="16" color="error" class="mr-2">mdi-alert-circle</v-icon>
        <span>{{ error }}</span>
      </div>

      <!-- Schedule Results -->
      <div v-else-if="slots.length" class="mt-3">
        <!-- Summary Cards -->
        <div class="schedule-summary">
          <div class="summary-card liquid-glass-compact">
            <span class="summary-value">{{ slots.length }}</span>
            <span class="summary-label">{{ $t('poolOperator.assignedSlots') }}</span>
          </div>
          <div class="summary-card liquid-glass-compact">
            <span class="summary-value" :class="nextSlot ? 'text-accent' : ''">{{ nextSlotCountdown || '--' }}</span>
            <span class="summary-label">{{ $t('poolOperator.nextBlock') }}</span>
          </div>
          <div class="summary-card liquid-glass-compact">
            <span class="summary-value">{{ producedCount }}/{{ pastCount }}</span>
            <span class="summary-label">{{ $t('poolOperator.produced') }}</span>
          </div>
          <div v-if="missedCount > 0" class="summary-card liquid-glass-compact summary-card--warn">
            <span class="summary-value text-warn">{{ missedCount }}</span>
            <span class="summary-label">{{ $t('poolOperator.missed') }}</span>
          </div>
        </div>

        <!-- Slot List -->
        <div class="slot-list mt-3">
          <div
            v-for="(slot, i) in slots"
            :key="slot.slot"
            class="slot-item"
            :class="{
              'slot-past': slot.isPast,
              'slot-next': slot.isNext,
              'slot-missed': slot.isPast && !slot.produced,
            }"
          >
            <div class="slot-index">#{{ i + 1 }}</div>
            <div class="slot-info">
              <span class="slot-time">{{ slot.time }}</span>
              <span class="slot-detail">{{ $t('poolOperator.slot') }} {{ slot.slotInEpoch }}</span>
            </div>
            <div class="slot-status">
              <template v-if="slot.isPast">
                <v-icon v-if="slot.produced" x-small color="success">mdi-check-circle</v-icon>
                <v-icon v-else x-small color="error">mdi-close-circle</v-icon>
              </template>
              <template v-else-if="slot.isNext">
                <span class="next-badge">{{ $t('poolOperator.nextBlock') }}</span>
              </template>
              <v-icon v-else x-small color="var(--g-text-3)">mdi-clock-outline</v-icon>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="!loading && fetched" class="text-center py-4">
        <v-icon size="32" color="var(--g-text-3)">mdi-calendar-blank</v-icon>
        <div class="empty-text mt-2">{{ $t('poolOperator.noSlotsAssigned') }}</div>
      </div>

      <div v-else class="text-center py-4">
        <span class="empty-text">{{ $t('poolOperator.clickFetchSchedule') }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRefs, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { nodeFetch } from '../utils/nodeFetch';

const { t } = useTranslation();
const { poolId: _poolId } = toRefs(poolOperatorStore);

const loading = ref(false);
const fetched = ref(false);
const error = ref('');
const scheduleView = ref<'current' | 'next'>('current');

interface ScheduleSlot {
  slot: number;
  slotInEpoch: number;
  timestamp: number;
  time: string;
  isPast: boolean;
  isNext: boolean;
  produced: boolean;
}

const slots = ref<ScheduleSlot[]>([]);

const nodeConnected = computed(() => !!nodeMonitorUrl.value);

const nodeMonitorUrl = computed(() => {
  // Find the block producer node from the nodes list
  const bp = poolOperatorStore.nodes.find(n => n.type === 'bp' && n.connected);
  return bp?.url || '';
});

const nextSlot = computed(() => slots.value.find(s => s.isNext));

const nextSlotCountdown = computed(() => {
  if (!nextSlot.value) return null;
  const diff = nextSlot.value.timestamp - Date.now() / 1000;
  if (diff <= 0) return t('poolOperator.now');
  const hours = Math.floor(diff / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
});

const pastCount = computed(() => slots.value.filter(s => s.isPast).length);
const producedCount = computed(() => slots.value.filter(s => s.isPast && s.produced).length);
const missedCount = computed(() => slots.value.filter(s => s.isPast && !s.produced).length);


async function fetchSchedule() {
  if (!nodeMonitorUrl.value) return;
  loading.value = true;
  error.value = '';
  fetched.value = false;

  try {
    const epoch = scheduleView.value;
    const data = await nodeFetch(
      `${nodeMonitorUrl.value}/leader-schedule?epoch=${epoch}`,
      120_000 // Leader schedule can take time to compute
    );

    if (data.error) {
      throw new Error(data.error);
    }
    const now = Date.now() / 1000;

    // Expected response: { slots: [{ slot, slotInEpoch, timestamp, produced? }], epoch }
    if (data.slots && Array.isArray(data.slots)) {
      let foundNext = false;
      slots.value = data.slots.map((s: any) => {
        const isPast = s.timestamp < now;
        let isNext = false;
        if (!isPast && !foundNext) {
          isNext = true;
          foundNext = true;
        }
        return {
          slot: s.slot,
          slotInEpoch: s.slotInEpoch || s.slot_in_epoch || 0,
          timestamp: s.timestamp,
          time: new Date(s.timestamp * 1000).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
          }),
          isPast,
          isNext,
          produced: s.produced ?? (isPast ? true : false), // Assume produced if not specified
        };
      });
    } else {
      slots.value = [];
    }

    fetched.value = true;
  } catch (e: any) {
    error.value = e.message || t('errors.unknownError');
    slots.value = [];
  } finally {
    loading.value = false;
  }
}

// Re-fetch when epoch view changes
watch(scheduleView, () => {
  if (nodeMonitorUrl.value && fetched.value) fetchSchedule();
});

</script>

<style scoped>
.leader-schedule {
  margin-top: 12px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--g-text-2);
  display: flex;
  align-items: center;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Notice */
.ls-notice {
  display: flex;
  gap: 14px;
  padding: 16px;
  align-items: flex-start;
}

.ls-notice-icon {
  width: 36px;
  height: 36px;
  min-width: 36px;
  border-radius: var(--g-r-control);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ls-notice-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-2);
}

.ls-notice-text {
  font-size: 13px;
  color: var(--g-text-3);
  line-height: 1.5;
  margin-top: 2px;
}

/* Controls */
.schedule-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.toggle-btn {
  text-transform: none !important;
  letter-spacing: normal !important;
  font-size: 13px !important;
}

.refresh-btn {
  text-transform: none !important;
  letter-spacing: normal !important;
  color: var(--g-text-3) !important;
  font-size: 13px !important;
}

.loading-text {
  font-size: 13px;
  color: var(--g-text-3);
}

/* Error */
.ls-error {
  display: flex;
  align-items: center;
  padding: 12px;
  font-size: 14px;
  color: var(--g-error);
}

/* Summary */
.schedule-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 8px;
}

.summary-card {
  padding: 12px;
  text-align: center;
}

.summary-card--warn {
  border-color: var(--g-error-line) !important;
}

.summary-value {
  display: block;
  font-size: 24px;
  font-weight: 800;
  color: var(--g-text-1);
  font-variant-numeric: tabular-nums;
}

.summary-value.text-accent { color: var(--g-warning); }
.summary-value.text-warn { color: var(--g-error); }

.summary-label {
  display: block;
  font-size: 13px;
  color: var(--g-text-3);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-top: 2px;
}

/* Slot list */
.slot-list {
  max-height: 400px;
  overflow-y: auto;
  border-radius: var(--g-r-control);
  border: 1px solid var(--g-hairline-1);
}

.slot-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--g-hairline-1);
  transition: background 0.15s;
}

.slot-item:last-child { border-bottom: none; }
.slot-item:hover { background: rgba(255,255,255,0.02); }

.slot-past { opacity: 0.45; }
.slot-next {
  background: var(--g-warning-fill);
  opacity: 1;
  border-left: 2px solid var(--g-warning);
}
.slot-missed {
  opacity: 0.7;
  background: var(--g-error-fill);
  border-left: 2px solid var(--g-error-line);
}

.slot-index {
  font-size: 14px;
  color: var(--g-text-3);
  min-width: 28px;
  font-variant-numeric: tabular-nums;
}

.slot-info { flex: 1; }

.slot-time {
  font-size: 14px;
  font-weight: 600;
  color: var(--g-text-2);
  display: block;
}

.slot-detail {
  font-size: 14px;
  color: var(--g-text-3);
  font-family: var(--g-font-mono);
}

.slot-status {
  min-width: 60px;
  text-align: right;
}

.next-badge {
  font-size: 13px;
  font-weight: 700;
  color: var(--g-warning);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.empty-text {
  color: var(--g-text-3);
  font-size: 14px;
}
</style>
