<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" class="pa-2">
        <!-- Loading -->
        <div v-if="!loaded" class="text-center py-8">
          <v-progress-circular indeterminate color="primary" size="32" />
        </div>

        <!-- State 1: No cold key — show setup -->
        <ColdKeySetup v-else-if="!coldKeyConfigured" @configured="onColdKeyConfigured" />

        <!-- State 2: Cold key configured — unified dashboard -->
        <template v-else>
          <PoolDashboard />

          <!-- Advanced Sections (only if registered) -->
          <template v-if="isRegistered">
            <EpochHistory />
            <LeaderSchedule />
            <NodeMonitor />
          </template>

          <!-- Action Panels -->
          <v-expansion-panels v-model="openPanel" flat class="spo-panels mt-3">
            <!-- Register / Update Pool -->
            <v-expansion-panel class="spo-panel liquid-glass-compact">
              <v-expansion-panel-header class="spo-panel-header">
                <div class="spo-panel-title">
                  <div class="spo-panel-icon" style="background: rgba(45,240,247,0.1)">
                    <v-icon size="16" color="#2DF0F7">{{ isRegistered ? 'mdi-pencil-outline' : 'mdi-plus-circle-outline' }}</v-icon>
                  </div>
                  <div>
                    <span class="spo-panel-label">
                      {{ isRegistered ? $t('poolOperator.updatePool') : $t('poolOperator.registerPool') }}
                    </span>
                    <span class="spo-panel-hint">
                      {{ isRegistered ? $t('poolOperator.updatePoolDescription') : $t('poolOperator.registerPoolDescription') }}
                    </span>
                  </div>
                </div>
              </v-expansion-panel-header>
              <v-expansion-panel-content class="spo-panel-body">
                <PoolRegistrationForm />
              </v-expansion-panel-content>
            </v-expansion-panel>

            <!-- Retire Pool -->
            <v-expansion-panel v-if="isRegistered" class="spo-panel liquid-glass-compact">
              <v-expansion-panel-header class="spo-panel-header">
                <div class="spo-panel-title">
                  <div class="spo-panel-icon" style="background: rgba(253,162,155,0.1)">
                    <v-icon size="16" color="#FDA29B">mdi-power</v-icon>
                  </div>
                  <div>
                    <span class="spo-panel-label">{{ $t('poolOperator.retirePool') }}</span>
                    <span class="spo-panel-hint">{{ $t('poolOperator.retirePoolDescription') }}</span>
                  </div>
                </div>
              </v-expansion-panel-header>
              <v-expansion-panel-content class="spo-panel-body">
                <PoolRetirementForm />
              </v-expansion-panel-content>
            </v-expansion-panel>

            <!-- KES Rotation -->
            <v-expansion-panel class="spo-panel liquid-glass-compact">
              <v-expansion-panel-header class="spo-panel-header">
                <div class="spo-panel-title">
                  <div class="spo-panel-icon" style="background: rgba(253,176,34,0.1)">
                    <v-icon size="16" color="#FDB022">mdi-key-change</v-icon>
                  </div>
                  <div>
                    <span class="spo-panel-label">{{ $t('poolOperator.kesRotation') }}</span>
                    <span class="spo-panel-hint">{{ $t('poolOperator.kesRotationDescription') }}</span>
                  </div>
                </div>
              </v-expansion-panel-header>
              <v-expansion-panel-content class="spo-panel-body">
                <KesRotation />
              </v-expansion-panel-content>
            </v-expansion-panel>
          </v-expansion-panels>
        </template>
      </v-col>
    </v-row>
  </v-layout>
</template>

<script setup lang="ts">
import { ref, computed, toRefs, onMounted } from 'vue';
import { poolOperatorStore, loadPoolOperatorConfig } from '@/stores/poolOperatorStore';
import { walletStore } from '@/stores/walletStore';

import PoolDashboard from './components/PoolDashboard.vue';
import ColdKeySetup from './components/ColdKeySetup.vue';
import PoolRegistrationForm from './components/PoolRegistrationForm.vue';
import PoolRetirementForm from './components/PoolRetirementForm.vue';
import KesRotation from './components/KesRotation.vue';
import EpochHistory from './components/EpochHistory.vue';
import LeaderSchedule from './components/LeaderSchedule.vue';
import NodeMonitor from './components/NodeMonitor.vue';

const { coldKeySource, isRegistered } = toRefs(poolOperatorStore);
const openPanel = ref<number | undefined>(undefined);
const loaded = ref(false);

const coldKeyConfigured = computed(() => coldKeySource.value !== 'none');

onMounted(async () => {
  const walletId = walletStore.loggedWallet?.id;
  if (walletId) {
    await loadPoolOperatorConfig(walletId);
  }
  loaded.value = true;
});

function onColdKeyConfigured() {
  // Cold key was just set up — dashboard will render
}
</script>

<style scoped>
.spo-panels {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.spo-panel {
  background: rgba(255,255,255,0.03) !important;
  border: 1px solid rgba(255,255,255,0.06) !important;
  border-radius: 12px !important;
  transition: border-color 0.2s ease;
}

.spo-panel:hover {
  border-color: rgba(255,255,255,0.12) !important;
}

.spo-panel::before {
  box-shadow: none !important;
}

.spo-panel-header {
  padding: 14px 16px !important;
  min-height: unset !important;
}

.spo-panel-title {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.spo-panel-icon {
  width: 32px;
  height: 32px;
  min-width: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}

.spo-panel-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255,255,255,0.9);
  line-height: 1.3;
}

.spo-panel-hint {
  display: block;
  font-size: 11px;
  color: rgba(255,255,255,0.35);
  line-height: 1.4;
  margin-top: 2px;
  max-width: 400px;
}

.spo-panel-body {
  border-top: 1px solid rgba(255,255,255,0.06);
}

/* Override Vuetify expansion panel defaults */
.spo-panels >>> .v-expansion-panel-content__wrap {
  padding: 16px !important;
}

.spo-panels >>> .v-expansion-panel-header__icon .v-icon {
  color: rgba(255,255,255,0.25) !important;
  font-size: 18px !important;
}
</style>
