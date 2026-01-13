<template>
  <v-dialog v-model="open" max-width="400" persistent content-class="block-card-confirm-modal">
    <v-card class="block-card-confirm-dialog" outlined>
      <!-- Header -->
      <div class="modal-header">
        <div class="content">
          <div class="icon-section">
            <div class="featured-icon">
              <v-icon class="card-icon">mdi-credit-card-off</v-icon>
            </div>
          </div>

          <div class="text-section">
            <h3 class="modal-title">{{ title }}</h3>
            <p class="modal-subtitle">{{ subtitle }}</p>
          </div>
        </div>

        <v-btn icon class="close-btn" @click="closeModal">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </div>

      <!-- Actions -->
      <div class="modal-actions">
        <div class="actions-content">
          <div class="password-section" v-if="loggedWallet.type === 'Normal'">
            <PassKeyPasswordField
              :value="password"
              @input="password = $event"
              dense
              outlined
              class="password-input"
              :label="t('wallet.spendingPassword')"
              hide-details
              @enter="verifyPassword"
              @passkey-autofill-success="verifyPassword"
            />
          </div>
          <div v-if="loggedWallet.type === 'Ledger'" class="ledger-section">
            <p class="ledger-instruction">{{ $t('wallet.ledgerSignPrompt') }}</p>
          </div>
          <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>

          <div class="buttons-section">
            <v-btn class="cancel-btn" @click="closeModal" :disabled="loading"> {{ $t('common.cancel') }} </v-btn>
            <v-btn v-if="loggedWallet.type === 'Ledger'" color="error" class="delete-btn" @click="sign" :loading="loading"> Sign </v-btn>
            <v-btn v-else color="error" class="delete-btn" @click="verifyPassword" :disabled="!password"> {{ $t('common.confirm') }} </v-btn>
          </div>
        </div>
      </div>
    </v-card>
  </v-dialog>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { BackgroundResponse, Messaging, VerifyPasswordResponse } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { METHOD } from '@/chrome/config';
import { ref, watch, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { stringToHex } from '@/shared/utils/converter';
import snackbar from '@/plugins/snackbar';
import verifyDataSignature from '@cardano-foundation/cardano-verify-datasignature';
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';

const { t } = useTranslation();

interface Props {
  open: boolean;
  title: string;
  subtitle: string;
}

interface Emits {
  (e: 'close'): void;
  (e: 'confirm'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const { loggedWallet } = toRefs(walletStore);

const loading = ref(false);
const password = ref('');
const errorMessage = ref('');

const closeModal = () => {
  password.value = '';
  errorMessage.value = '';
  emit('close');
};

// Password verification
const verifyPassword = async () => {
  try {
    errorMessage.value = '';
    const passwordVerification = (await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.VERIFY_SPENDING_PASSWORD,
      data: { password: password.value },
    })) as BackgroundResponse<VerifyPasswordResponse>;
    if (!passwordVerification.data.success) {
      errorMessage.value = t('wallet.wrongSpendingPassword');
      return;
    }
    emit('confirm');
    closeModal();
  } catch (error: any) {
    errorMessage.value = error?.message || t('wallet.wrongSpendingPassword');
  }
};

const sign = async () => {
  try {
    loading.value = true;
    errorMessage.value = '';

    // Create a message to sign that proves wallet ownership
    // Using current timestamp to prevent replay attacks
    const timestamp = Date.now();
    const messageToSign = `Gero Wallet Verification - ${timestamp}`;

    // Use METHOD.signData pattern like in ViewRewardsDialog
    const request = {
      method: METHOD.signData,
      data: {
        address: loggedWallet.value.baseAddress,
        payload: stringToHex(messageToSign)
      },
    };

    const signatureResult: any = await Messaging.sendToBackground(request);

    if (signatureResult.error) {
      snackbar.setError(signatureResult.error.info || signatureResult.error.message || 'Failed to sign with Ledger');
      errorMessage.value = signatureResult.error.info || signatureResult.error.message || 'Failed to sign with Ledger device';
    } else {
      // Verify the signature using @cardano-foundation/cardano-verify-datasignature
      console.log(signatureResult)
      try {
        const isValid = verifyDataSignature(
          signatureResult.data.signature,
          signatureResult.data.key,
          messageToSign,
          loggedWallet.value.baseAddress
        );

        if (!isValid) {
          const errorMsg = t('wallet.signatureVerificationFailed');
          errorMessage.value = errorMsg;
          snackbar.setError(errorMsg);
          console.error('❌ Signature verification failed');
          return;
        }

        console.log('✅ Ledger signature verified successfully');
        // If verification succeeds, emit confirm event
        emit('confirm');
        closeModal();
      } catch (verifyError: any) {
        console.error('❌ Error verifying signature:', verifyError);
        const errorMsg = verifyError?.message || 'Failed to verify signature. Please try again.';
        errorMessage.value = errorMsg;
        snackbar.setError(errorMsg);
      }
    }
  } catch (error: any) {
    console.error('Error signing with Ledger:', error);
    const errorMsg = error?.message || 'Failed to sign with Ledger device. Please try again.';
    errorMessage.value = errorMsg;
    snackbar.setError(errorMsg);
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  newVal => {
    if (newVal) {
      password.value = '';
      errorMessage.value = '';
    }
  },
  { immediate: true }
);
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.block-card-confirm-modal {
  .v-dialog__content {
    align-items: center;
    justify-content: center;
  }
}

.block-card-confirm-dialog {
  background: $background-dark !important;
  border-radius: $border-radius-lg !important;
  overflow: hidden;
  width: 100%;
  max-width: 400px;
  box-shadow: $shadow-md;
}

.modal-header {
  position: relative;
  @include flex-column;
  align-items: center;
  width: 100%;
}

.content {
  @include flex-column;
  gap: $spacing-sm;
  padding: $spacing-xl $spacing-xl 0;
  width: 100%;
}

.icon-section {
  display: flex;
}

.featured-icon {
  width: 48px;
  height: 48px;
  background: #d92d20;
  border-radius: 50%;
  @include flex-center;
}

.card-icon {
  color: #fecdca;
  font-size: $font-size-xl;
}

.text-section {
  @include flex-column;
  gap: $spacing-xs;
}

.modal-title {
  @include heading-style($font-size-lg);
}

.modal-subtitle {
  @include body-text($font-size-sm);
  color: $text-muted;
  margin: 0;
}

.close-btn {
  position: absolute;
  top: $spacing-sm;
  right: $spacing-sm;
  width: 44px;
  height: 44px;

  .v-icon {
    color: #85888e;
    font-size: $font-size-xl;
  }
}

.modal-actions {
  padding: $spacing-sm 0 0;
  width: 100%;
}

.actions-content {
  @include flex-column;
  gap: $spacing-sm;
  padding: 0 $spacing-xl $spacing-xl;
}

.password-section {
  margin-top: 36px;
  position: relative;
  @include flex-column;
  gap: $spacing-xs;
}

.ledger-section {
  margin-top: 36px;
  @include flex-column;
  gap: $spacing-md;
  align-items: center;
}

.ledger-instruction {
  @include body-text($font-size-sm);
  color: $text-muted;
  text-align: center;
  margin: 0;
  line-height: 1.5;
}

.input-label {
  @include body-text($font-size-sm);
  font-weight: $font-weight-medium;
  color: $text-secondary;
  margin: 0;
}

.password-input {
  :deep(.v-input__control) {
    background: $background-dark !important;
    border: 1px solid $border-primary !important;
    border-radius: $border-radius-md !important;
  }

  :deep(.v-input__slot) {
    background: transparent !important;
    box-shadow: none !important;
  }

  :deep(.v-label) {
    color: $text-secondary !important;
    font-weight: $font-weight-medium;
    font-size: $font-size-sm;
  }

  :deep(.v-text-field__details) {
    display: none;
  }

  :deep(input) {
    color: $text-primary !important;
    font-size: $font-size-base;
  }
}

.buttons-section {
  display: flex;
  gap: $spacing-sm;
  width: 100%;
}

.cancel-btn {
  height: 44px !important;
  flex: 1;
  background: $background-card !important;
  border: 1px solid $border-primary !important;
  border-radius: $border-radius-md !important;
  color: $text-secondary !important;
  font-family: $font-family-primary;
  font-weight: $font-weight-semibold;
  font-size: $font-size-base;
  line-height: $line-height-relaxed;
  text-transform: none;
  padding: $spacing-sm $spacing-sm !important;
  box-shadow: $shadow-button;

  &:hover {
    background: #1a1d23 !important;
  }
}

.delete-btn {
  flex: 1;
  height: 44px !important;
  background: #d92d20 !important;
  border: 2px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: $border-radius-md !important;
  color: #ffffff !important;
  font-family: $font-family-primary;
  font-weight: $font-weight-semibold;
  font-size: $font-size-base;
  line-height: $line-height-relaxed;
  text-transform: none;
  padding: $spacing-sm $spacing-sm !important;
  box-shadow: $shadow-button;

  &:hover {
    background: #b42318 !important;
  }

  &:disabled {
    background: #6b7280 !important;
    border-color: #6b7280 !important;
  }
}

.error-message {
  color: #d92d20;
  font-size: $font-size-sm;
  margin: 0;
}
</style>
