<template>
  <div class="step-google-backup">
    <div class="step-scroll">
    <v-card class="mb-3" outlined style="background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.12);">
      <v-card-text class="pa-3">
        <div class="d-flex align-center mb-2">
          <v-icon color="primary" size="22" class="mr-2">mdi-shield-key-outline</v-icon>
          <div class="text-body-2 white--text font-weight-medium">{{ $t('welcome.recoveryNoFileTitle') }}</div>
        </div>
        <div class="text-body-2 grey--text text--lighten-1">
          {{ $t('welcome.recoveryNoFileBody') }}
        </div>
      </v-card-text>
    </v-card>

    <v-btn
      class="onb-btn"
      block
      depressed
      :color="stored ? 'success' : 'primary'"
      :loading="storing"
      :disabled="stored"
      @click="storeRecovery()"
    >
      <v-icon left small>{{ stored ? 'mdi-check' : 'mdi-cloud-upload-outline' }}</v-icon>
      {{ stored ? $t('welcome.recoverySaved') : (errorMessage ? $t('common.retry') : $t('welcome.saveRecovery')) }}
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
    </div>

    <!-- Navigation -->
    <div class="onboarding-actions d-flex" style="gap: 12px;">
      <v-spacer />
      <v-btn class="onb-btn" depressed color="primary" :disabled="!stored" @click="$emit('next')">
        {{ $t('common.continue') }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, getCurrentInstance } from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import type { NetworkInfo } from '@/utils/networks';
import type { GoogleWalletBgResponse } from './googleWalletMessages';

const props = defineProps<{
  network: NetworkInfo;
  idToken: string;
  walletId: number;
  /** Plaintext recovery share — sent once to the background, which encrypts + uploads. Never rendered/logged/persisted here. */
  recoveryShare: string;
  /** Wallet xpub (not secret) — the restore-time anchor stored alongside the blob. */
  publicKey: string;
  recoveryPassword: string;
}>();
defineEmits<{ (e: 'next'): void }>();

const vmProxy = getCurrentInstance()!.proxy;

const storing = ref(false);
const stored = ref(false);
const errorMessage = ref('');

const storeRecovery = async (): Promise<void> => {
  storing.value = true;
  errorMessage.value = '';
  try {
    // Never log request payload — carries idToken/recoveryShare/recoveryPassword.
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.STORE_MPC_RECOVERY,
      data: {
        idToken: props.idToken,
        chain: props.network?.blockchain,
        network: props.network?.network,
        recoveryShare: props.recoveryShare,
        recoveryPassword: props.recoveryPassword,
        publicKey: props.publicKey,
      },
    }) as GoogleWalletBgResponse;
    if (!response?.data?.success) {
      throw new Error(response?.data?.error || (vmProxy.$t('welcome.recoverySaveFailed') as string));
    }
    stored.value = true;
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : (vmProxy.$t('welcome.recoverySaveFailed') as string);
  } finally {
    storing.value = false;
  }
};
</script>

<style scoped>
.onb-btn {
  border-radius: 8px !important;
  box-shadow: none !important;
}
</style>
