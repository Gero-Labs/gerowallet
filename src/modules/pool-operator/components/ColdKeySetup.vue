<template>
  <v-card flat class="transparent pa-4">
    <!-- Hero intro -->
    <div class="setup-hero">
      <v-icon size="56" color="primary" class="mb-3">mdi-server-network</v-icon>
      <h2 class="setup-title">{{ $t('poolOperator.welcomeTitle') }}</h2>
      <p class="setup-subtitle">{{ $t('poolOperator.welcomeSubtitle') }}</p>
    </div>

    <!-- Feature highlights -->
    <div class="features-grid">
      <div class="feature-card">
        <v-icon size="24" color="#2DF0F7">mdi-chart-bar</v-icon>
        <div class="feature-title">{{ $t('poolOperator.featureDashboard') }}</div>
        <div class="feature-desc">{{ $t('poolOperator.featureDashboardDesc') }}</div>
      </div>
      <div class="feature-card">
        <v-icon size="24" color="#75E0A7">mdi-server</v-icon>
        <div class="feature-title">{{ $t('poolOperator.featureMonitor') }}</div>
        <div class="feature-desc">{{ $t('poolOperator.featureMonitorDesc') }}</div>
      </div>
      <div class="feature-card">
        <v-icon size="24" color="white">mdi-calendar-clock</v-icon>
        <div class="feature-title">{{ $t('poolOperator.featureSchedule') }}</div>
        <div class="feature-desc">{{ $t('poolOperator.featureScheduleDesc') }}</div>
      </div>
      <div class="feature-card">
        <v-icon size="24" color="#FDA29B">mdi-key-change</v-icon>
        <div class="feature-title">{{ $t('poolOperator.featureKes') }}</div>
        <div class="feature-desc">{{ $t('poolOperator.featureKesDesc') }}</div>
      </div>
    </div>

    <!-- Get started -->
    <div class="get-started-section">
      <h3 class="get-started-title">{{ $t('poolOperator.readyToStart') }}</h3>
      <p class="get-started-desc">{{ $t('poolOperator.readyToStartDesc') }}</p>

      <v-card outlined class="import-card" hover @click="showImportDialog = true">
        <div class="import-card-content">
          <v-icon size="36" color="primary">mdi-file-key-outline</v-icon>
          <div>
            <h4 class="import-card-title">{{ $t('poolOperator.importColdKey') }}</h4>
            <p class="import-card-desc">{{ $t('poolOperator.importColdKeyDescription') }}</p>
          </div>
          <v-icon color="rgba(255,255,255,0.3)">mdi-chevron-right</v-icon>
        </div>
      </v-card>
    </div>

    <!-- VRF Key Import (shown after cold key is set) -->
    <div v-if="coldKeyImported" class="mt-6">
      <v-divider class="mb-4" />
      <h4>{{ $t('poolOperator.importVrfKey') }}</h4>
      <p class="text-caption grey--text">{{ $t('poolOperator.importVrfKeyDescription') }}</p>
      <v-file-input
        v-model="vrfKeyFile"
        :label="$t('poolOperator.vrfKeyFile')"
        accept=".vkey,.json"
        outlined
        dense
        prepend-icon="mdi-file-certificate-outline"
        class="mt-2"
        @change="parseVrfKey"
      />
      <div v-if="vrfKeyHash" class="mt-2">
        <div class="text-caption grey--text">{{ $t('poolOperator.vrfKeyHash') }}</div>
        <div class="monospace-text text-body-2 mt-1">{{ vrfKeyHash }}</div>
      </div>
      <div v-if="poolId" class="mt-4">
        <v-alert type="success" dense outlined>
          {{ $t('poolOperator.poolIdDerived') }}: <strong class="monospace-text">{{ poolId }}</strong>
        </v-alert>
        <v-btn color="primary" block class="mt-4" @click="finishSetup">
          {{ $t('poolOperator.completeSetup') }}
        </v-btn>
      </div>
    </div>

    <!-- Import Cold Key Dialog -->
    <ImportColdKeyDialog
      v-model="showImportDialog"
      @imported="onColdKeyImported"
    />
  </v-card>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { walletStore } from '@/stores/walletStore';
import ImportColdKeyDialog from '../dialogs/ImportColdKeyDialog.vue';
import snackbar from '@/plugins/snackbar';

const { t } = useTranslation();
const emit = defineEmits(['configured']);

const showImportDialog = ref(false);
const coldKeyImported = ref(false);
const vrfKeyFile = ref<File | null>(null);
const vrfKeyHash = ref<string | null>(null);
const poolId = ref<string | null>(null);

async function onColdKeyImported(result: { coldKeyHash: string; poolId: string }) {
  coldKeyImported.value = true;
  poolId.value = result.poolId;
  poolOperatorStore.coldKeyHash = result.coldKeyHash;
  poolOperatorStore.poolId = result.poolId;
}

async function parseVrfKey() {
  if (!vrfKeyFile.value) return;
  try {
    const text = await vrfKeyFile.value.text();
    const envelope = JSON.parse(text);
    if (!envelope.cborHex) {
      throw new Error('Invalid VRF key file format');
    }
    const cborHex = envelope.cborHex;
    let keyHex: string;
    if (cborHex.startsWith('5820')) {
      keyHex = cborHex.slice(4);
    } else {
      keyHex = cborHex;
    }
    vrfKeyHash.value = keyHex;
    poolOperatorStore.vrfKeyHash = keyHex;

    const walletId = walletStore.loggedWallet?.id;
    if (walletId) {
      const { setWalletConfiguration } = await import('@/db/wallet-db');
      await setWalletConfiguration(walletId, 'spo_vrfKeyHash', keyHex);
    }
  } catch (e) {
    snackbar.setError(t('poolOperator.invalidVrfKeyFile'));
    vrfKeyHash.value = null;
  }
}

function finishSetup() {
  if (!vrfKeyHash.value || !poolId.value) return;
  poolOperatorStore.coldKeySource = poolOperatorStore.coldKeySource || 'imported';
  emit('configured');
}
</script>

<style scoped>
.setup-hero {
  text-align: center;
  padding: 24px 16px 16px;
}

.setup-title {
  font-size: 22px;
  font-weight: 800;
  color: rgba(255,255,255,0.95);
  margin-bottom: 8px;
}

.setup-subtitle {
  font-size: 14px;
  color: rgba(255,255,255,0.55);
  line-height: 1.6;
  max-width: 500px;
  margin: 0 auto;
}

/* Feature highlights */
.features-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin: 20px 0;
}

@media (max-width: 500px) {
  .features-grid { grid-template-columns: 1fr; }
}

.feature-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px;
  padding: 16px;
  transition: border-color 0.2s;
}

.feature-card:hover {
  border-color: rgba(255,255,255,0.12);
}

.feature-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255,255,255,0.85);
  margin-top: 10px;
}

.feature-desc {
  font-size: 12px;
  color: rgba(255,255,255,0.45);
  line-height: 1.5;
  margin-top: 4px;
}

/* Get started */
.get-started-section {
  margin-top: 24px;
  text-align: center;
}

.get-started-title {
  font-size: 16px;
  font-weight: 700;
  color: rgba(255,255,255,0.9);
}

.get-started-desc {
  font-size: 13px;
  color: rgba(255,255,255,0.45);
  margin-top: 4px;
  margin-bottom: 16px;
}

.import-card {
  cursor: pointer;
  border-color: rgba(255,255,255,0.08) !important;
  border-radius: 12px !important;
  transition: all 0.2s;
}

.import-card:hover {
  border-color: rgba(45,240,247,0.3) !important;
  background: rgba(45,240,247,0.03) !important;
}

.import-card-content {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
}

.import-card-title {
  font-size: 15px;
  font-weight: 600;
  color: rgba(255,255,255,0.9);
  text-align: left;
}

.import-card-desc {
  font-size: 12px;
  color: rgba(255,255,255,0.45);
  line-height: 1.5;
  margin-top: 2px;
  text-align: left;
}
</style>
