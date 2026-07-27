<template>
  <!-- Fileless MPC recovery: nothing for the user to save. This step exists only to
       upload the encrypted recovery share, so it shows a brief spinner and auto-advances
       on success (no dead "Recovery saved / Continue" click). It only becomes interactive
       if the upload fails, offering a retry — onboarding stays gated on a successful upload. -->
  <div class="step-google-backup">
    <div class="step-scroll d-flex flex-column align-center justify-center text-center" style="min-height: 180px;">
      <template v-if="!errorMessage">
        <v-progress-circular indeterminate color="primary" size="34" width="3" class="mb-3" />
        <div class="text-body-2 grey--text text--lighten-1">{{ $t('welcome.savingRecovery') }}</div>
      </template>
      <template v-else>
        <v-alert
          color="error"
          icon="mdi-alert-outline"
          outlined
          dense
          border="left"
          class="mb-3"
          style="width: 100%;"
        >
          <span class="text-body-2">{{ errorMessage }}</span>
        </v-alert>
        <v-btn class="onb-btn" depressed color="primary" :loading="storing" @click="storeRecovery()">
          <v-icon left small>mdi-refresh</v-icon>
          {{ $t('common.retry') }}
        </v-btn>
      </template>
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
const emit = defineEmits<{ (e: 'next'): void }>();

const vmProxy = getCurrentInstance()!.proxy;

const storing = ref(false);
const stored = ref(false);
const errorMessage = ref('');

const storeRecovery = async (): Promise<void> => {
  // Re-entrancy guard: auto-fired once on load, and the Retry button can fire it
  // again — bail if an upload is already in flight so two concurrent calls don't race
  // on storing/stored/errorMessage and stomp a prior success back into an error.
  if (storing.value) return;
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
    // Fileless recovery is armed — nothing for the user to confirm here, so skip
    // straight to the next step. Onboarding stays gated on this success (a failure
    // leaves us on the retry state instead of advancing).
    emit('next');
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : (vmProxy.$t('welcome.recoverySaveFailed') as string);
  } finally {
    storing.value = false;
  }
};

// No user input needed (password, share and xpub anchor were collected earlier), so
// arm the upload automatically. Kicked off in setup so `storing` is true before first
// paint — the user sees a spinner, then auto-advances once the share is uploaded.
storeRecovery();
</script>

<style scoped>
.onb-btn {
  border-radius: 8px !important;
  box-shadow: none !important;
}
</style>
