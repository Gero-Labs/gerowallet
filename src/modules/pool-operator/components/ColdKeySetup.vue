<template>
  <v-card flat class="transparent spo-setup pa-4">
    <!-- Hero intro -->
    <div class="setup-hero">
      <div class="hero-badge">
        <v-icon size="34" color="var(--g-accent)">mdi-server-network</v-icon>
      </div>
      <h2 class="setup-title">{{ $t('poolOperator.welcomeTitle') }}</h2>
      <p class="setup-subtitle">{{ $t('poolOperator.welcomeSubtitle') }}</p>
    </div>

    <!-- Feature highlights -->
    <div class="features-grid">
      <div class="feature-card c-cyan">
        <div class="feature-tile"><v-icon size="22" color="var(--g-accent)">mdi-chart-bar</v-icon></div>
        <div class="feature-title">{{ $t('poolOperator.featureDashboard') }}</div>
        <div class="feature-desc">{{ $t('poolOperator.featureDashboardDesc') }}</div>
      </div>
      <div class="feature-card c-green">
        <div class="feature-tile"><v-icon size="22" color="success">mdi-server</v-icon></div>
        <div class="feature-title">{{ $t('poolOperator.featureMonitor') }}</div>
        <div class="feature-desc">{{ $t('poolOperator.featureMonitorDesc') }}</div>
      </div>
      <div class="feature-card c-violet">
        <div class="feature-tile"><v-icon size="22" color="var(--g-info)">mdi-calendar-clock</v-icon></div>
        <div class="feature-title">{{ $t('poolOperator.featureSchedule') }}</div>
        <div class="feature-desc">{{ $t('poolOperator.featureScheduleDesc') }}</div>
      </div>
      <div class="feature-card c-red">
        <div class="feature-tile"><v-icon size="22" color="error">mdi-key-change</v-icon></div>
        <div class="feature-title">{{ $t('poolOperator.featureKes') }}</div>
        <div class="feature-desc">{{ $t('poolOperator.featureKesDesc') }}</div>
      </div>
    </div>

    <!-- Get started -->
    <div class="get-started-section">
      <span class="step-badge t-label">{{ $t('poolOperator.getStartedStep') }}</span>
      <h3 class="get-started-title">{{ $t('poolOperator.readyToStart') }}</h3>
      <p class="get-started-desc">{{ $t('poolOperator.readyToStartDesc') }}</p>
    </div>

    <div class="import-cta c-cyan" @click="showImportDialog = true">
      <div class="feature-tile"><v-icon size="26" color="var(--g-accent)">mdi-file-key-outline</v-icon></div>
      <div class="import-cta-body">
        <h4 class="import-cta-title">{{ $t('poolOperator.importColdKey') }}</h4>
        <p class="import-cta-desc">{{ $t('poolOperator.importColdKeyDescription') }}</p>
      </div>
      <v-icon color="var(--g-accent)">mdi-chevron-right</v-icon>
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
.spo-setup {
  max-width: 900px;
  margin: 0 auto;
}

/* Per-accent CSS variables (used by tiles, hover glow, gradient border) */
.c-cyan   { --accent: var(--g-accent); --tile-bg: rgba(45,240,247,0.16);  --tile-bd: rgba(45,240,247,0.35); }
.c-green  { --accent: var(--g-success); --tile-bg: var(--g-success-fill); --tile-bd: var(--g-success-line); }
.c-violet { --accent: var(--g-info); --tile-bg: rgba(182,146,246,0.16); --tile-bd: rgba(182,146,246,0.32); }
.c-red    { --accent: var(--g-error); --tile-bg: var(--g-error-fill); --tile-bd: var(--g-error-line); }

/* Hero */
.setup-hero {
  text-align: center;
  padding: 2px 16px 10px;
}

.hero-badge {
  width: 54px;
  height: 54px;
  margin: 0 auto 12px;
  border-radius: var(--g-r-sheet);
  display: grid;
  place-items: center;
  background: var(--g-raised);
  border: 1px solid rgba(45,240,247,0.35);
}

.setup-title {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.5px;
  margin-bottom: 6px;
  color: var(--g-text-1);
}

.setup-subtitle {
  font-size: 13px;
  color: var(--g-text-3);
  line-height: 1.5;
  max-width: 520px;
  margin: 0 auto;
}

/* Feature highlights */
.features-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin: 16px 0;
}

@media (max-width: 620px) {
  .features-grid { grid-template-columns: 1fr; }
}

.feature-card {
  position: relative;
  overflow: hidden;
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  padding: 14px;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.feature-card::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: var(--g-r-card);
  padding: 1px;
  background: var(--accent);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
}

.feature-card:hover {
  transform: translateY(-3px);
  border-color: transparent;
  box-shadow: var(--g-shadow-menu);
}

.feature-card:hover::before { opacity: 1; }

.feature-tile {
  width: 38px;
  height: 38px;
  border-radius: var(--g-r-card);
  display: grid;
  place-items: center;
  background: var(--tile-bg);
  border: 1px solid var(--tile-bd);
  margin-bottom: 10px;
}

.feature-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--g-text-1);
}

.feature-desc {
  font-size: 12px;
  color: var(--g-text-3);
  line-height: 1.5;
  margin-top: 4px;
}

/* Get started */
.get-started-section {
  margin-top: 18px;
  margin-bottom: 10px;
  text-align: center;
}

.step-badge {
  display: inline-block;
  color: var(--g-accent);
  background: rgba(45,240,247,0.1);
  border: 1px solid rgba(45,240,247,0.25);
  padding: 4px 10px;
  border-radius: var(--g-r-pill);
  margin-bottom: 10px;
}

.get-started-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--g-text-1);
}

.get-started-desc {
  font-size: 13px;
  color: var(--g-text-3);
  margin-top: 4px;
}

/* Import CTA */
.import-cta {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 18px;
  border-radius: var(--g-r-card);
  cursor: pointer;
  background: var(--g-raised);
  border: 1px solid rgba(45,240,247,0.28);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.import-cta:hover {
  transform: translateY(-2px);
  border-color: rgba(45,240,247,0.55);
  box-shadow: var(--g-shadow-menu);
}

.import-cta::after {
  content: "";
  position: absolute;
  top: 0;
  left: -60%;
  width: 40%;
  height: 100%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,0.08), transparent);
  transform: skewX(-18deg);
  transition: left 0.5s ease;
  pointer-events: none;
}

.import-cta:hover::after { left: 130%; }

.import-cta .feature-tile {
  width: 46px;
  height: 46px;
  border-radius: var(--g-r-card);
  margin: 0;
}

.import-cta-body {
  flex: 1;
}

.import-cta-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--g-text-1);
  text-align: left;
}

.import-cta-desc {
  font-size: 12px;
  color: var(--g-text-3);
  line-height: 1.5;
  margin-top: 3px;
  text-align: left;
}
</style>
