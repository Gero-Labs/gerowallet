<template>
  <v-dialog v-model="dialog" max-width="600" persistent>
    <v-card class="liquid-glass">
      <v-card-title class="d-flex align-center justify-space-between">
        <span>Approve DUST Delegation</span>
        <v-btn icon small @click="close">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-card-text>
        <div v-if="request" class="mb-4">
          <!-- Request Details -->
          <div class="request-details mb-4">
            <div class="detail-section mb-3">
              <div class="detail-label">Requester</div>
              <div class="detail-value">
                <div class="font-weight-bold">{{ request.requesterName || 'Anonymous' }}</div>
                <div class="text-caption font-monospace">{{ request.requesterAddress }}</div>
              </div>
            </div>

            <div v-if="request.message" class="detail-section mb-3">
              <div class="detail-label">Message</div>
              <div class="detail-value message-box">
                {{ request.message }}
              </div>
            </div>

            <div class="detail-section mb-3">
              <div class="detail-label">Estimated Fee</div>
              <div class="detail-value">
                <span class="font-weight-bold text-h6">{{ formatDust(request.estimatedFee) }} DUST</span>
              </div>
            </div>

            <div class="detail-section">
              <div class="detail-label">Requested</div>
              <div class="detail-value">{{ formatTimeAgo(request.createdAt) }}</div>
            </div>
          </div>

          <v-divider class="my-4"></v-divider>

          <!-- Password Confirmation -->
          <div class="mb-4">
            <p class="text-body-2 mb-3" style="color: rgba(255, 255, 255, 0.7)">
              To approve this request, you will fund the requester's DUST registration transaction.
              This will deduct approximately <strong>{{ formatDust(request.estimatedFee) }} DUST</strong> from your wallet.
            </p>

            <v-form ref="formRef" v-model="formValid">
              <v-text-field
                v-model="password"
                label="Wallet Password"
                type="password"
                outlined
                dense
                :rules="passwordRules"
                :error-messages="passwordError"
                @input="passwordError = ''"
                class="mb-0"
                @keyup.enter="approve"
              >
                <template v-slot:prepend-inner>
                  <v-icon small color="primary">mdi-lock-outline</v-icon>
                </template>
              </v-text-field>
            </v-form>
          </div>

          <!-- Warning if insufficient DUST -->
          <v-alert
            v-if="insufficientDust"
            type="warning"
            text
            dense
            class="mb-3"
          >
            <div class="text-caption">
              <v-icon small class="mr-1">mdi-alert</v-icon>
              You may not have enough DUST to fund this request.
              Current balance: {{ currentDustBalance }} DUST
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
                <div class="font-weight-bold">Delegation approved successfully!</div>
                <div v-if="txHash" class="text-caption">Transaction: {{ truncateHash(txHash) }}</div>
              </div>
            </div>
          </v-alert>
        </div>
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
          @click="approve"
          :loading="loading"
          :disabled="!formValid || loading || success"
        >
          <v-icon small left>mdi-check</v-icon>
          Approve & Fund
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { walletStore } from '@/stores/walletStore';
import delegationService from '@/services/delegation.service';
import { updateDelegationRequestStatus } from '@/stores/delegationStore';
import { DelegationRequest, DelegationRequestStatus } from '@/models/delegation-types';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';

interface Props {
  value: boolean;
  request: DelegationRequest | null;
}

interface Emits {
  (e: 'input', value: boolean): void;
  (e: 'approved', requestId: string, txHash: string): void;
}

const props = withDefaults(defineProps<Props>(), {
  value: false,
  request: null
});
const emit = defineEmits<Emits>();

const dialog = computed({
  get: () => props.value,
  set: (value) => emit('input', value),
});

// Form state
const formRef = ref<any>(null);
const formValid = ref(false);
const password = ref('');
const loading = ref(false);
const error = ref('');
const success = ref(false);
const passwordError = ref('');
const txHash = ref('');

// Validation rules
const passwordRules = [
  (v: string) => !!v || 'Password is required',
];

// Computed properties
const currentWallet = computed(() => walletStore.loggedWallet);

const currentDustBalance = computed(() => {
  // TODO: Get actual DUST balance from wallet
  // For now, return a placeholder
  return '0.000000';
});

const insufficientDust = computed(() => {
  if (!props.request) return false;
  const balance = parseFloat(currentDustBalance.value);
  const required = parseInt(props.request.estimatedFee) / 1e12;
  return balance < required;
});

// Methods
function formatDust(dust: string): string {
  const value = parseInt(dust) / 1e12;
  return value.toFixed(6);
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

function truncateHash(hash: string): string {
  if (!hash) return '';
  return `${hash.slice(0, 12)}...${hash.slice(-8)}`;
}

async function approve() {
  if (!formRef.value?.validate()) {
    return;
  }

  if (!props.request) {
    error.value = 'No request to approve';
    return;
  }

  loading.value = true;
  error.value = '';
  success.value = false;
  txHash.value = '';

  try {
    console.log('💰 Approving delegation request:', props.request.id);

    // Execute DUST registration with funding seed
    // This will call background script to execute the midnight-node-toolkit command
    const result = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.EXECUTE_DUST_DELEGATION,
      data: {
        requestId: props.request.id,
        requesterAddress: props.request.requesterAddress,
        funderAddress: props.request.funderAddress,
        password: password.value,
      },
    });

    if (!result.data?.success) {
      throw new Error(result.data?.error || result.error || 'Failed to execute delegation');
    }

    txHash.value = result.data.txHash;
    console.log('✅ Delegation approved, transaction hash:', txHash.value);

    // Update local request status
    await updateDelegationRequestStatus(props.request.id, DelegationRequestStatus.APPROVED, {
      txHash: txHash.value,
      completedAt: Date.now(),
    });

    // Note: Delegation response is sent to requester by background script
    // (it handles both real Ably messaging and mock mode database updates)

    success.value = true;
    emit('approved', props.request.id, txHash.value);

    // Auto-close after success
    setTimeout(() => {
      close();
    }, 3000);
  } catch (err: any) {
    console.error('❌ Failed to approve delegation request:', err);

    if (err.message && err.message.includes('password')) {
      passwordError.value = 'Incorrect password';
    } else {
      error.value = err.message || 'Failed to approve request. Please try again.';
    }

    // Send error response to requester
    if (props.request) {
      try {
        await delegationService.sendDelegationResponse(
          props.request.id,
          props.request.requesterAddress,
          props.request.funderAddress,
          false,
          undefined,
          err.message || 'Approval failed'
        );
      } catch (responseErr) {
        console.warn('Failed to send error response:', responseErr);
      }
    }
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
    password.value = '';
    error.value = '';
    success.value = false;
    passwordError.value = '';
    txHash.value = '';
  }, 300);
}

// Watch dialog to reset on close
watch(dialog, (newValue) => {
  if (!newValue) {
    // Reset form when dialog closes
    setTimeout(() => {
      formRef.value?.reset();
      password.value = '';
      error.value = '';
      success.value = false;
      passwordError.value = '';
      txHash.value = '';
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

.request-details {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.detail-value {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
}

.font-monospace {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}

.message-box {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 12px;
  border-left: 3px solid rgba(45, 240, 247, 0.5);
  font-size: 13px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.8);
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
