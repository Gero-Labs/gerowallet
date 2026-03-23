<template>
  <div class="leader-schedule">
    <div class="section-header">
      <div class="section-title">
        <v-icon size="16" color="#FDB022" class="mr-2">mdi-calendar-clock</v-icon>
        {{ $t('poolOperator.leaderSchedule') }}
      </div>
    </div>

    <!-- VRF Key Required Notice -->
    <div v-if="!hasVrfSkey" class="vrf-notice liquid-glass-compact">
      <div class="vrf-notice-icon">
        <v-icon size="24" color="#FDB022">mdi-key-alert</v-icon>
      </div>
      <div>
        <div class="vrf-notice-title">{{ $t('poolOperator.vrfSkeyRequired') }}</div>
        <div class="vrf-notice-text">{{ $t('poolOperator.vrfSkeyRequiredDescription') }}</div>
        <v-file-input
          v-model="vrfSkeyFile"
          :label="$t('poolOperator.vrfSkeyFile')"
          accept=".skey,.json"
          outlined dense dark hide-details
          prepend-icon="mdi-file-key"
          class="mt-3"
          style="max-width: 360px"
          @change="importVrfSkey"
        />
      </div>
    </div>

    <!-- Schedule Display -->
    <template v-else>
      <div class="schedule-controls">
        <v-btn-toggle v-model="scheduleView" mandatory dense class="schedule-toggle">
          <v-btn x-small :value="'current'" class="toggle-btn">{{ $t('poolOperator.currentEpoch') }}</v-btn>
          <v-btn x-small :value="'next'" class="toggle-btn">{{ $t('poolOperator.nextEpoch') }}</v-btn>
        </v-btn-toggle>
        <v-btn text x-small class="refresh-btn" @click="calculateSchedule" :loading="calculating">
          <v-icon x-small class="mr-1">mdi-calculator</v-icon>
          {{ $t('poolOperator.calculate') }}
        </v-btn>
      </div>

      <!-- VRF WASM Not Available -->
      <div v-if="!vrfWasmAvailable" class="vrf-wasm-notice liquid-glass-compact mt-3">
        <v-icon size="18" color="rgba(255,255,255,0.3)" class="mr-2">mdi-information-outline</v-icon>
        <div>
          <div style="font-size: 12px; color: rgba(255,255,255,0.6)">{{ $t('poolOperator.vrfWasmRequired') }}</div>
          <div style="font-size: 11px; color: rgba(255,255,255,0.3); margin-top: 4px">{{ $t('poolOperator.vrfWasmRequiredDescription') }}</div>
        </div>
      </div>

      <!-- Schedule Results -->
      <div v-else-if="slots.length" class="schedule-results mt-3">
        <div class="schedule-summary">
          <div class="summary-stat">
            <span class="summary-value">{{ slots.length }}</span>
            <span class="summary-label">{{ $t('poolOperator.assignedSlots') }}</span>
          </div>
          <div class="summary-stat">
            <span class="summary-value">{{ nextSlotCountdown || '--' }}</span>
            <span class="summary-label">{{ $t('poolOperator.nextBlock') }}</span>
          </div>
        </div>

        <div class="slot-list mt-3">
          <div v-for="(slot, i) in slots" :key="slot.slot" class="slot-item" :class="{ 'slot-past': slot.isPast, 'slot-next': slot.isNext }">
            <div class="slot-index">#{{ i + 1 }}</div>
            <div class="slot-info">
              <span class="slot-time">{{ slot.time }}</span>
              <span class="slot-detail">{{ $t('poolOperator.slot') }} {{ slot.slot }}</span>
            </div>
            <div class="slot-status">
              <v-icon x-small :color="slot.isPast ? (slot.produced ? '#75E0A7' : '#FDA29B') : 'rgba(255,255,255,0.2)'">
                {{ slot.isPast ? (slot.produced ? 'mdi-check-circle' : 'mdi-close-circle') : 'mdi-clock-outline' }}
              </v-icon>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="!calculating" class="text-center py-4">
        <span class="empty-text">{{ $t('poolOperator.clickCalculate') }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRefs } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { walletStore } from '@/stores/walletStore';
import snackbar from '@/plugins/snackbar';

const { t } = useTranslation();
const { poolId } = toRefs(poolOperatorStore);
const { loggedWallet } = toRefs(walletStore);

const hasVrfSkey = ref(false);
const vrfSkeyFile = ref<File | null>(null);
const vrfWasmAvailable = ref(false); // Will be true when VRF WASM module is loaded
const calculating = ref(false);
const scheduleView = ref<'current' | 'next'>('current');
const slots = ref<any[]>([]);

const nextSlotCountdown = computed(() => {
  const next = slots.value.find(s => s.isNext);
  if (!next) return null;
  const diff = next.timestamp - Date.now() / 1000;
  if (diff <= 0) return t('poolOperator.now');
  const hours = Math.floor(diff / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
});

async function importVrfSkey() {
  if (!vrfSkeyFile.value) return;
  try {
    const text = await vrfSkeyFile.value.text();
    const envelope = JSON.parse(text);
    if (!envelope.cborHex || !envelope.type?.includes('VrfSigningKey')) {
      throw new Error('Invalid VRF signing key file');
    }
    // Store VRF skey encrypted in wallet DB (same as cold key)
    // For now, just mark as available
    hasVrfSkey.value = true;
    snackbar.fireSuccess(t('poolOperator.vrfSkeyImported'));
  } catch (e: any) {
    snackbar.setError(e.message || t('poolOperator.invalidVrfKeyFile'));
  }
}

async function calculateSchedule() {
  calculating.value = true;
  try {
    // TODO: VRF WASM implementation
    // For now, show the notice that VRF WASM is not yet available
    vrfWasmAvailable.value = false;
  } finally {
    calculating.value = false;
  }
}
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
  font-size: 12px;
  font-weight: 600;
  color: rgba(255,255,255,0.6);
  display: flex;
  align-items: center;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* VRF Notice */
.vrf-notice {
  display: flex;
  gap: 14px;
  padding: 16px;
  align-items: flex-start;
}

.vrf-notice-icon {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 10px;
  background: rgba(253,176,34,0.1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.vrf-notice-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255,255,255,0.8);
}

.vrf-notice-text {
  font-size: 11px;
  color: rgba(255,255,255,0.35);
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
  font-size: 11px !important;
}

.refresh-btn {
  text-transform: none !important;
  letter-spacing: normal !important;
  color: rgba(255,255,255,0.3) !important;
  font-size: 11px !important;
}

/* WASM notice */
.vrf-wasm-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 14px;
}

/* Schedule Results */
.schedule-summary {
  display: flex;
  gap: 24px;
}

.summary-stat {
  display: flex;
  flex-direction: column;
}

.summary-value {
  font-size: 24px;
  font-weight: 800;
  color: rgba(255,255,255,0.95);
}

.summary-label {
  font-size: 10px;
  color: rgba(255,255,255,0.35);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

/* Slot list */
.slot-list {
  max-height: 300px;
  overflow-y: auto;
}

.slot-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  transition: background 0.15s;
}

.slot-item:hover { background: rgba(255,255,255,0.03); }
.slot-past { opacity: 0.5; }
.slot-next { background: rgba(45,240,247,0.04); border: 1px solid rgba(45,240,247,0.1); }

.slot-index {
  font-size: 10px;
  color: rgba(255,255,255,0.25);
  min-width: 24px;
}

.slot-info { flex: 1; }

.slot-time {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255,255,255,0.8);
  display: block;
}

.slot-detail {
  font-size: 10px;
  color: rgba(255,255,255,0.25);
  font-family: 'Roboto Mono', monospace;
}

.empty-text {
  color: rgba(255,255,255,0.25);
  font-size: 12px;
}
</style>
