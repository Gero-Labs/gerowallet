<template>
  <div class="kes-form">
    <!-- Ledger limitation -->
    <div v-if="isLedgerColdKey" class="kes-notice">
      <div class="notice-icon-wrap" style="background: rgba(45,240,247,0.1)">
        <v-icon size="18" color="#2DF0F7">mdi-information-outline</v-icon>
      </div>
      <div class="notice-text">{{ $t('poolOperator.kesLedgerLimitation') }}</div>
    </div>

    <!-- KES Info Cards -->
    <div class="kes-info-grid" v-if="!isLedgerColdKey">
      <div class="kes-info-card">
        <v-icon size="20" color="#FDB022" class="mb-2">mdi-counter</v-icon>
        <span class="kes-info-label">{{ $t('poolOperator.kesCounter') }}</span>
        <span class="kes-info-hint">{{ $t('poolOperator.kesCounterHint') }}</span>
        <v-text-field
          v-model="kesCounter"
          type="number"
          outlined dense dark hide-details
          placeholder="0"
          class="glass-input mt-2"
        />
      </div>
      <div class="kes-info-card">
        <v-icon size="20" color="#A078FF" class="mb-2">mdi-clock-outline</v-icon>
        <span class="kes-info-label">{{ $t('poolOperator.currentKesPeriod') }}</span>
        <span class="kes-info-hint">{{ $t('poolOperator.kesPeriodHint') }}</span>
        <v-text-field
          v-model="kesPeriod"
          type="number"
          outlined dense dark hide-details
          placeholder="0"
          class="glass-input mt-2"
        />
      </div>
    </div>

    <!-- Password for cold key decryption -->
    <v-text-field
      v-if="!isLedgerColdKey"
      v-model="password"
      :label="$t('poolOperator.coldKeyPassword')"
      type="password"
      outlined dense dark hide-details
      class="glass-input mt-3"
    />

    <v-btn
      v-if="!isLedgerColdKey"
      color="#FDB022"
      block
      class="mt-4 black--text font-weight-bold"
      style="border-radius: 10px; text-transform: none; letter-spacing: normal"
      :disabled="!kesPeriod || !kesCounter || !password"
      :loading="loading"
      @click="rotateKes()"
    >
      <v-icon left small>mdi-key-change</v-icon>
      {{ $t('poolOperator.generateKesKeys') }}
    </v-btn>

    <!-- Output Dialog -->
    <v-dialog v-model="showOutput" max-width="600px" persistent>
      <v-card class="kes-output-card">
        <v-card-title class="d-flex align-center" style="gap: 8px; border-bottom: 1px solid rgba(255,255,255,0.06)">
          <v-icon color="#75E0A7">mdi-check-circle</v-icon>
          {{ $t('poolOperator.kesKeysGenerated') }}
          <v-spacer />
          <v-btn icon small @click="showOutput = false">
            <v-icon small>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <v-card-text class="pt-4">
          <div class="output-hint mb-4">{{ $t('poolOperator.kesKeysGeneratedDescription') }}</div>

          <div v-for="file in outputFiles" :key="file.name" class="output-file">
            <div class="output-file-header">
              <div class="output-file-icon">
                <v-icon size="14" :color="file.color">{{ file.icon }}</v-icon>
              </div>
              <span class="output-file-name">{{ file.name }}</span>
              <v-spacer />
              <v-btn x-small text :color="file.color" @click="downloadFile(file.name, file.content)" class="dl-btn">
                <v-icon x-small class="mr-1">mdi-download</v-icon>
                {{ $t('common.download') }}
              </v-btn>
            </div>
            <div class="output-file-preview">{{ file.content.substring(0, 120) }}...</div>
          </div>

          <div class="transfer-notice mt-4">
            <v-icon x-small color="#FDB022" class="mr-1">mdi-alert-outline</v-icon>
            {{ $t('poolOperator.kesTransferInstructions') }}
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRefs } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import snackbar from '@/plugins/snackbar';

const { t } = useTranslation();
const { coldKeySource } = toRefs(poolOperatorStore);

const loading = ref(false);
const kesPeriod = ref('');
const kesCounter = ref('');
const password = ref('');

const showOutput = ref(false);
const kesSkey = ref('');
const kesVkey = ref('');
const opCert = ref('');

const isLedgerColdKey = computed(() => coldKeySource.value === 'ledger');

const outputFiles = computed(() => [
  { name: 'kes.skey', content: kesSkey.value, icon: 'mdi-key', color: '#FDA29B' },
  { name: 'kes.vkey', content: kesVkey.value, icon: 'mdi-key-outline', color: '#2DF0F7' },
  { name: 'node.cert', content: opCert.value, icon: 'mdi-certificate', color: '#75E0A7' },
]);

async function rotateKes() {
  loading.value = true;
  try {
    if (isLedgerColdKey.value) {
      throw new Error(t('poolOperator.kesLedgerLimitation'));
    }

    // Verify password
    const verification = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.VERIFY_SPENDING_PASSWORD,
      data: { password: password.value },
    }) as { data: { success: boolean; error?: string } };

    if (!verification.data.success) {
      snackbar.setError(t('wallet.wrongSpendingPassword'));
      return;
    }

    // Generate new KES keypair
    const { ed25519 } = await import('@noble/curves/ed25519');
    const kesPrivateKey = crypto.getRandomValues(new Uint8Array(32));
    const kesPublicKey = ed25519.getPublicKey(kesPrivateKey);

    // Decrypt cold key
    const walletId = walletStore.loggedWallet?.id;
    if (!walletId) throw new Error('No wallet logged in');

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(walletId);
    const configTable = db.table('config');
    const encryptedEntry = await configTable.where({ key: 'spo_encryptedColdKey' }).first();
    if (!encryptedEntry?.value) throw new Error('No cold key configured');

    const { decryptWithPassword } = await import('@/shared/utils/crypto');
    const coldKeyBytes = new Uint8Array(decryptWithPassword(password.value, encryptedEntry.value));
    const coldPubKey = ed25519.getPublicKey(coldKeyBytes);

    // Build op cert payload
    const newCounter = parseInt(kesCounter.value) + 1;
    const period = parseInt(kesPeriod.value);

    const opCertPayload = new Uint8Array(32 + 8 + 8);
    opCertPayload.set(kesPublicKey, 0);
    const counterView = new DataView(opCertPayload.buffer, 32, 8);
    counterView.setBigUint64(0, BigInt(newCounter));
    const periodView = new DataView(opCertPayload.buffer, 40, 8);
    periodView.setBigUint64(0, BigInt(period));

    // Sign with cold key
    const opCertSignature = ed25519.sign(opCertPayload, coldKeyBytes);
    coldKeyBytes.fill(0);

    // Format TextEnvelope output
    const toHex = (bytes: Uint8Array) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const kesPrivHex = '5820' + toHex(kesPrivateKey);
    const kesPubHex = '5820' + toHex(kesPublicKey);

    kesSkey.value = JSON.stringify({
      type: 'KesSigningKey_ed25519_kes_2^6',
      description: 'KES Signing Key',
      cborHex: kesPrivHex,
    }, null, 2);

    kesVkey.value = JSON.stringify({
      type: 'KesVerificationKey_ed25519_kes_2^6',
      description: 'KES Verification Key',
      cborHex: kesPubHex,
    }, null, 2);

    const coldPubHex = toHex(coldPubKey);
    const sigHex = toHex(opCertSignature);
    const opCertHex = toHex(kesPublicKey) + coldPubHex + newCounter.toString(16).padStart(16, '0') + period.toString(16).padStart(16, '0') + sigHex;

    opCert.value = JSON.stringify({
      type: 'NodeOperationalCertificate',
      description: '',
      cborHex: opCertHex,
    }, null, 2);

    poolOperatorStore.kesCounter = newCounter;
    showOutput.value = true;
    snackbar.fireSuccess(t('poolOperator.kesKeysGenerated'));
  } catch (e: any) {
    snackbar.setError(e.message || t('errors.unknownError'));
  } finally {
    loading.value = false;
  }
}

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<style scoped>
.kes-form {
  padding-top: 4px;
}

.kes-notice {
  display: flex;
  gap: 12px;
  padding: 12px 14px;
  background: rgba(45,240,247,0.04);
  border: 1px solid rgba(45,240,247,0.1);
  border-radius: 10px;
}

.notice-icon-wrap {
  width: 32px;
  height: 32px;
  min-width: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.notice-text {
  font-size: 12px;
  color: rgba(255,255,255,0.5);
  line-height: 1.5;
}

.kes-info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (max-width: 450px) {
  .kes-info-grid {
    grid-template-columns: 1fr;
  }
}

.kes-info-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px;
  padding: 14px;
  display: flex;
  flex-direction: column;
}

.kes-info-label {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255,255,255,0.8);
}

.kes-info-hint {
  font-size: 10px;
  color: rgba(255,255,255,0.5);
  line-height: 1.4;
  margin-top: 2px;
}

/* Output dialog */
.kes-output-card {
  background: #13161b !important;
  border: 1px solid rgba(255,255,255,0.08);
}

.output-hint {
  font-size: 12px;
  color: rgba(255,255,255,0.5);
  line-height: 1.5;
}

.output-file {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  margin-bottom: 8px;
  overflow: hidden;
}

.output-file-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.output-file-icon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: rgba(255,255,255,0.04);
  display: flex;
  align-items: center;
  justify-content: center;
}

.output-file-name {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255,255,255,0.8);
  font-family: 'Roboto Mono', monospace;
}

.dl-btn {
  text-transform: none !important;
  letter-spacing: normal !important;
  font-size: 11px !important;
}

.output-file-preview {
  padding: 8px 12px;
  font-family: 'Roboto Mono', monospace;
  font-size: 10px;
  color: rgba(255,255,255,0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.transfer-notice {
  font-size: 11px;
  color: #FDB022;
  line-height: 1.5;
  display: flex;
  align-items: flex-start;
  padding: 10px 12px;
  background: rgba(253,176,34,0.05);
  border: 1px solid rgba(253,176,34,0.1);
  border-radius: 8px;
}

.glass-input >>> .v-input__slot {
  background: rgba(255,255,255,0.04) !important;
  border-color: rgba(255,255,255,0.08) !important;
}

.glass-input >>> .v-input__slot:hover {
  border-color: rgba(255,255,255,0.15) !important;
}
</style>
