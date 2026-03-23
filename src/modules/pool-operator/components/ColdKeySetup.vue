<template>
  <v-card flat class="transparent pa-4">
    <div class="text-center py-4">
      <v-icon size="48" color="primary">mdi-key-plus</v-icon>
      <h3 class="mt-3">{{ $t('poolOperator.setupColdKey') }}</h3>
      <p class="grey--text mt-2">{{ $t('poolOperator.setupColdKeyDescription') }}</p>
    </div>

    <v-row justify="center" class="mt-4">
      <!-- Import Software Key -->
      <v-col cols="12" sm="5">
        <v-card outlined class="pa-4 text-center cursor-pointer" hover @click="showImportDialog = true">
          <v-icon size="40" color="primary">mdi-file-key-outline</v-icon>
          <h4 class="mt-3">{{ $t('poolOperator.importColdKey') }}</h4>
          <p class="text-caption grey--text mt-2">{{ $t('poolOperator.importColdKeyDescription') }}</p>
        </v-card>
      </v-col>

      <v-col cols="12" sm="1" class="d-flex align-center justify-center">
        <span class="grey--text text-body-2">{{ $t('common.or') }}</span>
      </v-col>

      <!-- Connect Ledger -->
      <v-col cols="12" sm="5">
        <v-card outlined class="pa-4 text-center cursor-pointer" hover @click="connectLedger">
          <v-icon size="40" color="primary">mdi-usb</v-icon>
          <h4 class="mt-3">{{ $t('poolOperator.ledgerColdKey') }}</h4>
          <p class="text-caption grey--text mt-2">{{ $t('poolOperator.ledgerColdKeyDescription') }}</p>
        </v-card>
      </v-col>
    </v-row>

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

async function connectLedger() {
  // TODO: Phase 3 — Ledger cold key setup at m/1853'/1815'/0'/0'
  snackbar.setError(t('common.comingSoon'));
}

async function parseVrfKey() {
  if (!vrfKeyFile.value) return;
  try {
    const text = await vrfKeyFile.value.text();
    const envelope = JSON.parse(text);
    // TextEnvelope format: { type: "VrfVerificationKey_...", cborHex: "5820..." }
    if (!envelope.cborHex) {
      throw new Error('Invalid VRF key file format');
    }
    // Extract the VRF verification key from CBOR envelope
    // CBOR hex: "5820" (byte string header for 32 bytes) + 32 bytes hex
    const cborHex = envelope.cborHex;
    let keyHex: string;
    if (cborHex.startsWith('5820')) {
      keyHex = cborHex.slice(4); // Skip CBOR byte string header
    } else {
      keyHex = cborHex;
    }
    // VRF vkey is 32 bytes — store as hex (this is the VrfVkHex used in PoolParameters)
    vrfKeyHash.value = keyHex;
    poolOperatorStore.vrfKeyHash = keyHex;

    // Persist to wallet DB
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
