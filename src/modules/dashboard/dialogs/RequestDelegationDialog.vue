<template>
  <v-dialog v-model="dialog" max-width="600" persistent>
    <v-card class="liquid-glass">
      <v-card-title class="d-flex align-center justify-space-between">
        <span>Request DUST Delegation</span>
        <v-btn icon small @click="close">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-card-text>
        <div class="mb-4">
          <p class="text-body-2 mb-2" style="color: rgba(255, 255, 255, 0.7)">
            Request another Midnight wallet to help pay for your DUST registration fee.
            They will use their DUST to fund your registration transaction.
          </p>
        </div>

        <!-- Step 1: Funder Address Input -->
        <v-form ref="formRef" v-model="formValid">
          <v-text-field
            v-model="funderAddress"
            label="Funder Wallet Address"
            placeholder="mn_addr_undeployed1..."
            outlined
            dense
            :rules="addressRules"
            :error-messages="addressError"
            @input="addressError = ''"
            class="mb-3"
          >
            <template v-slot:prepend-inner>
              <v-icon small color="primary">mdi-wallet-outline</v-icon>
            </template>
          </v-text-field>

          <v-text-field
            v-model="requesterName"
            label="Your Display Name (Optional)"
            placeholder="e.g., Alice, My Wallet, etc."
            outlined
            dense
            counter="50"
            :rules="nameRules"
            class="mb-3"
          >
            <template v-slot:prepend-inner>
              <v-icon small color="primary">mdi-account-outline</v-icon>
            </template>
          </v-text-field>

          <v-textarea
            v-model="message"
            label="Message (Optional)"
            placeholder="Add a note to the funder..."
            outlined
            dense
            rows="3"
            counter="200"
            :rules="messageRules"
            class="mb-3"
          >
            <template v-slot:prepend-inner>
              <v-icon small color="primary">mdi-message-text-outline</v-icon>
            </template>
          </v-textarea>

          <v-select
            v-model="expiryHours"
            label="Request Expiry"
            :items="expiryOptions"
            outlined
            dense
            class="mb-3"
          >
            <template v-slot:prepend-inner>
              <v-icon small color="primary">mdi-clock-outline</v-icon>
            </template>
          </v-select>
        </v-form>

        <!-- Fee Estimate -->
        <v-alert
          v-if="estimatedFee"
          type="info"
          text
          dense
          class="mb-3"
          color="primary"
        >
          <div class="d-flex align-center">
            <v-icon small class="mr-2">mdi-information-outline</v-icon>
            <div>
              <div class="text-caption">Estimated DUST Fee</div>
              <div class="font-weight-bold">{{ formatDust(estimatedFee) }} DUST</div>
            </div>
          </div>
        </v-alert>

        <!-- Warning if wallet doesn't have unshielded NIGHT -->
        <v-alert
          v-if="!hasUnshieldedNight"
          type="warning"
          text
          dense
          class="mb-3"
        >
          <div class="text-caption">
            <v-icon small class="mr-1">mdi-alert</v-icon>
            You need unshielded NIGHT tokens in your wallet for DUST registration.
            Make sure you have received unshielded NIGHT before the funder approves your request.
          </div>
        </v-alert>

        <!-- Error Display -->
        <v-alert
          v-if="error"
          type="error"
          text
          dense
          dismissible
          @click:close="error = ''"
          class="mb-3"
        >
          {{ error }}
        </v-alert>

        <!-- Success Display -->
        <v-alert
          v-if="success"
          type="success"
          text
          dense
          class="mb-3"
        >
          <div class="d-flex align-center">
            <v-icon small class="mr-2">mdi-check-circle</v-icon>
            <div>
              <div class="font-weight-bold">Request sent successfully!</div>
              <div class="text-caption">The funder will receive your delegation request.</div>
            </div>
          </div>
        </v-alert>
      </v-card-text>

      <v-card-actions class="px-4 pb-4">
        <v-spacer></v-spacer>
        <v-btn
          text
          @click="close"
          :disabled="loading"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          @click="sendRequest"
          :loading="loading"
          :disabled="!formValid || loading || success"
        >
          <v-icon small left>mdi-send</v-icon>
          Send Request
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { Blockchain } from '@/models/types';

interface Props {
  value: boolean;
}

interface Emits {
  (e: 'input', value: boolean): void;
  (e: 'request-sent', requestId: string): void;
}

const props = withDefaults(defineProps<Props>(), {
  value: false
});
const emit = defineEmits<Emits>();

const dialog = computed({
  get: () => props.value,
  set: (value) => emit('input', value),
});

// Form state
const formRef = ref<any>(null);
const formValid = ref(false);
const funderAddress = ref('');
const requesterName = ref('');
const message = ref('');
const expiryHours = ref(24);
const loading = ref(false);
const error = ref('');
const success = ref(false);
const addressError = ref('');

// Expiry options
const expiryOptions = [
  { text: '6 hours', value: 6 },
  { text: '12 hours', value: 12 },
  { text: '24 hours (1 day)', value: 24 },
  { text: '48 hours (2 days)', value: 48 },
  { text: '72 hours (3 days)', value: 72 },
];

// Validation rules
const addressRules = [
  (v: string) => !!v || 'Funder address is required',
  (v: string) => v.startsWith('mn_addr_') || 'Must be a valid Midnight address (mn_addr_...)',
  (v: string) => v.length >= 50 || 'Address appears to be too short',
];

const nameRules = [
  (v: string) => !v || v.length <= 50 || 'Name must be 50 characters or less',
];

const messageRules = [
  (v: string) => !v || v.length <= 200 || 'Message must be 200 characters or less',
];

// Computed properties
const currentWallet = computed(() => walletStore.loggedWallet);

const requesterAddress = computed(() => {
  // Return the wallet's unshielded address
  // TODO: Get actual unshielded address from wallet
  return currentWallet.value?.baseAddress || '';
});

const hasUnshieldedNight = computed(() => {
  // TODO: Check if wallet has unshielded NIGHT tokens
  // For now, we'll assume true
  return true;
});

const estimatedFee = computed(() => {
  // Estimated DUST fee for registration (in DUST base units, 12 decimals)
  // Typical registration fee is ~0.1-0.12 DUST
  return '100000000000'; // 0.1 DUST in base units
});

// Methods
function formatDust(dust: string): string {
  const value = parseInt(dust) / 1e12;
  return value.toFixed(6);
}

async function sendRequest() {
  if (!formRef.value?.validate()) {
    return;
  }

  // Validate current wallet is Midnight
  if (currentWallet.value?.chain !== Blockchain.MIDNIGHT) {
    error.value = 'Delegation requests are only available for Midnight wallets';
    return;
  }

  // Validate we have a requester address
  if (!requesterAddress.value) {
    error.value = 'Unable to get wallet address. Please try again.';
    return;
  }

  // Validate funder address is different from requester
  if (funderAddress.value === requesterAddress.value) {
    addressError.value = 'You cannot request delegation from yourself';
    return;
  }

  loading.value = true;
  error.value = '';
  success.value = false;

  try {
    console.log('📤 Sending delegation request:', {
      funderAddress: funderAddress.value,
      requesterAddress: requesterAddress.value,
      requesterName: requesterName.value || undefined,
      estimatedFee: estimatedFee.value,
      message: message.value || undefined,
      expiryHours: expiryHours.value,
    });

    // Send delegation request through background script
    const result = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SEND_DELEGATION_REQUEST,
      data: {
        funderAddress: funderAddress.value,
        requesterAddress: requesterAddress.value,
        requesterName: requesterName.value || undefined,
        estimatedFee: estimatedFee.value,
        message: message.value || undefined,
        expiryHours: expiryHours.value
      }
    });

    if (!result.data?.success) {
      throw new Error(result.data?.error || result.error || 'Failed to send delegation request');
    }

    console.log('✅ Delegation request sent successfully:', result.data.requestId);
    success.value = true;
    emit('request-sent', result.data.requestId);

    // Auto-close after success
    setTimeout(() => {
      close();
    }, 2000);
  } catch (err: any) {
    console.error('❌ Failed to send delegation request:', err);
    error.value = err.message || 'Failed to send request. Please try again.';
  } finally {
    loading.value = false;
  }
}

function close() {
  if (loading.value) return;

  dialog.value = false;

  // Reset form after closing animation
  setTimeout(() => {
    formRef.value?.reset();
    funderAddress.value = '';
    requesterName.value = '';
    message.value = '';
    expiryHours.value = 24;
    error.value = '';
    success.value = false;
    addressError.value = '';
  }, 300);
}

// Watch dialog to reset on close
watch(dialog, (newValue) => {
  if (!newValue) {
    // Reset form when dialog closes
    setTimeout(() => {
      formRef.value?.reset();
      error.value = '';
      success.value = false;
      addressError.value = '';
    }, 300);
  }
});
</script>

<style scoped>
.liquid-glass {
  background: linear-gradient(135deg, rgba(19, 22, 27, 0.95) 0%, rgba(19, 22, 27, 0.85) 100%) !important;
  backdrop-filter: blur(20px) saturate(1.5) !important;
  -webkit-backdrop-filter: blur(20px) saturate(1.5) !important;
  border: 1px solid rgba(45, 240, 247, 0.2) !important;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
}

::v-deep .v-text-field--outlined fieldset {
  border-color: rgba(255, 255, 255, 0.2) !important;
}

::v-deep .v-text-field--outlined:hover fieldset {
  border-color: rgba(45, 240, 247, 0.4) !important;
}

::v-deep .v-text-field--outlined.v-input--is-focused fieldset {
  border-color: rgba(45, 240, 247, 0.6) !important;
}
</style>
