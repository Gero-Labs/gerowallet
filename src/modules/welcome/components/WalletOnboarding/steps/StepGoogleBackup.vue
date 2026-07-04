<template>
  <div class="step-google-backup">
    <v-card class="mb-3" outlined style="background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.12);">
      <v-card-text class="pa-3">
        <div class="d-flex align-center mb-2">
          <v-icon color="primary" size="22" class="mr-2">mdi-file-lock-outline</v-icon>
          <div class="text-body-2 white--text font-weight-medium">{{ fileName }}</div>
        </div>
        <div class="text-body-2 grey--text text--lighten-1">
          {{ $t('welcome.onboardingDescGoogleBackup') }}
        </div>
      </v-card-text>
    </v-card>

    <v-btn
      class="onb-btn"
      block
      depressed
      :color="downloaded ? 'success' : 'primary'"
      :loading="downloading"
      @click="download()"
    >
      <v-icon left small>{{ downloaded ? 'mdi-check' : 'mdi-download' }}</v-icon>
      {{ downloaded ? $t('welcome.recoveryFileDownloaded') : $t('welcome.downloadRecoveryFile') }}
    </v-btn>

    <v-alert
      v-if="errorMessage"
      color="error"
      icon="mdi-alert-outline"
      outlined
      dense
      border="left"
      class="mt-3 mb-0"
    >
      <span class="text-body-2">{{ errorMessage }}</span>
    </v-alert>

    <v-checkbox
      v-model="savedAcknowledged"
      :disabled="!downloaded"
      hide-details
      class="mt-4 mb-0"
    >
      <template v-slot:label>
        <span class="text-body-2">{{ $t('welcome.confirmSavedRecoveryFile') }}</span>
      </template>
    </v-checkbox>

    <div class="mnemonic-note mt-3">
      <v-icon x-small color="grey lighten-1" class="mr-1 flex-shrink-0">mdi-information-outline</v-icon>
      <span>{{ $t('welcome.mnemonicBackupNote') }}</span>
    </div>

    <!-- Navigation -->
    <div class="onboarding-actions d-flex" style="gap: 12px;">
      <v-spacer />
      <v-btn class="onb-btn" depressed color="primary" :disabled="!canContinue" @click="$emit('next')">
        {{ $t('common.continue') }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, getCurrentInstance } from 'vue';
import { recoveryFileName } from './googleRecoveryFilename';

interface Props {
  walletId: number;
  /** Encrypted download only — never rendered, logged, or persisted by this component. */
  recoveryShare: string;
  recoveryPassword: string;
}

const props = defineProps<Props>();
defineEmits<{ (e: 'next'): void }>();

const vmProxy = getCurrentInstance()!.proxy;

const downloading = ref(false);
const downloaded = ref(false);
const savedAcknowledged = ref(false);
const errorMessage = ref('');

const fileName = computed(() => recoveryFileName(props.walletId));

const canContinue = computed(() => downloaded.value && savedAcknowledged.value);

function triggerDownload(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const download = async (): Promise<void> => {
  downloading.value = true;
  errorMessage.value = '';
  try {
    const { encryptRecoveryShare } = await import('@/shared/utils/mpc');
    const blob = await encryptRecoveryShare(props.recoveryShare, props.recoveryPassword);
    triggerDownload(fileName.value, blob);
    downloaded.value = true;
  } catch (error: unknown) {
    console.error('Failed to prepare recovery file:', error instanceof Error ? error.message : 'unknown error');
    errorMessage.value = vmProxy.$t('errors.unknownError') as string;
  } finally {
    downloading.value = false;
  }
};
</script>

<style scoped>
.onb-btn {
  border-radius: 8px !important;
  box-shadow: none !important;
}

.mnemonic-note {
  display: flex;
  align-items: flex-start;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  line-height: 1.4;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
}

::v-deep .v-input--checkbox .v-input--selection-controls__ripple {
  display: none;
}
</style>
