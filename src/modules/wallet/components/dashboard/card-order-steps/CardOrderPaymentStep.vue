<template>
  <div class="payment-step">
    <!-- Payment Amount Display -->
    <div class="payment-amount-card">
      <div class="amount-header">
        <v-icon class="payment-icon">mdi-credit-card-outline</v-icon>
        <span class="payment-label">{{ $t('card.shippingFeePayment') }}</span>
      </div>
      <div class="amount-display">
        <div class="amount-row">
          <span class="amount-value ada">{{ amountAda.toFixed(2) }} ADA</span>
          <span class="amount-equivalent">(~{{ '\u20AC' }}{{ amountEur.toFixed(2) }})</span>
        </div>
      </div>
    </div>

    <!-- Expired Payment Alert -->
    <v-alert v-if="isExpired" type="error" colored-border border="left" class="expired-alert" elevation="0">
      <div class="alert-content">
        <div class="alert-title">
          <v-icon small color="#f44336">mdi-alert-circle</v-icon>
          <span>{{ $t('card.paymentExpired') }}</span>
        </div>
        <div class="alert-body">
          <p>{{ $t('card.paymentExpiredMessage') }}</p>
        </div>
      </div>
    </v-alert>

    <!-- Important Information Alert -->
    <v-alert v-else type="info" color="primary" prominent colored-border border="left" class="info-alert" elevation="0">
      <div class="alert-content">
        <div class="alert-title">
          <span>{{ $t('card.importantInformation') }}</span>
        </div>
        <div class="alert-body">
          <p>{{ $t('card.paymentCoversShippingOnly') }}</p>
          <p>{{ $t('card.notATopUp') }}</p>
          <p class="highlight">{{ $t('card.oneTimePaymentAddress') }}</p>
        </div>
      </div>
    </v-alert>

    <!-- Authentication Section -->
    <div v-if="!isPrfWallet" class="auth-section">
      <!-- Password Wallet: Password Field -->
      <PassKeyPasswordField
        v-model="spendingPassword"
        :label="t('wallet.spendingPassword')"
        outlined
        dense
        hide-details
        :placeholder="t('card.enterSpendingPassword')"
        :rules="[rules.required()]"
        :disabled="isValidating"
        required
        @passkey-autofill-success="handleAutofillSuccess"
        @passkey-autofill-error="handleAutofillError"
        class="password-field"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import snackbar from '@/plugins/snackbar';
import { useTranslation } from '@/shared/composables/useTranslation';
import { cardStore } from '@/stores/modules/card';
import { walletStore } from '@/stores/walletStore';
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import rules from '@/utils/rules';
import { decryptPrivateKeyWithPrf } from '@/shared/utils/webauthn-prf';

interface Props {
  amountEur: number;
  paymentStatus?: string;
}

interface Emits {
  (e: 'back'): void;
  (e: 'confirm', password: string, privateKeyBytes?: Uint8Array): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const { t } = useTranslation();
const { exchangeRate } = cardStore;

const amountAda = computed(() => {
  if (!exchangeRate?.buy || !props.amountEur) return 0;
  return props.amountEur / Number(exchangeRate.buy);
});

const isExpired = computed(() => {
  const status = props.paymentStatus?.toLowerCase() || '';
  return status === 'expired';
});

// Check if wallet is PRF (PassKey) wallet
const isPrfWallet = computed(() => walletStore.loggedWallet?.encryptionMethod === 'prf');

// Local state
const spendingPassword = ref('');
const isValidating = ref(false);

// Handlers
const handleBack = () => {
  emit('back');
};

const handleAutofillSuccess = () => {
  console.log('✅ PassKey autofill successful');
};

const handleAutofillError = (error: string) => {
  console.error('❌ PassKey autofill failed:', error);
};

const handleConfirm = async () => {
  isValidating.value = true;
  try {
    // For PRF wallets: Trigger PassKey authentication
    if (isPrfWallet.value) {
      const wallet = walletStore.loggedWallet;
      const credentialId = wallet?.webAuthnCredentialId;
      const encryptedPrivateKey = wallet?.prfEncryptedPrivateKey;
      const walletId = wallet?.id;

      if (!credentialId || !encryptedPrivateKey || !walletId) {
        console.error('❌ Missing required fields:', {
          credentialId: !!credentialId,
          encryptedPrivateKey: !!encryptedPrivateKey,
          walletId: !!walletId
        });
        throw new Error(t('wallet.passKeyNotRegistered'));
      }

      // Decrypt private key with PRF
      const privateKeyBytes = await decryptPrivateKeyWithPrf(encryptedPrivateKey, credentialId, walletId);

      // Emit with private key bytes for transaction signing
      emit('confirm', '', privateKeyBytes);
      return;
    }

    // Verify spending password for non-PRF wallets
    const passwordVerification = (await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.VERIFY_SPENDING_PASSWORD,
      data: { password: spendingPassword.value },
    })) as { data: { success: boolean; error?: string } };

    if (!passwordVerification.data.success) {
      snackbar.setError(t('wallet.invalidSpendingPassword'));
      isValidating.value = false;
      return;
    }

    // Password is valid, emit to parent for transaction handling
    emit('confirm', spendingPassword.value);
  } catch (error: any) {
    console.error('❌ Authentication failed:', error);
    const errorMessage = isPrfWallet.value
      ? t('wallet.passKeyAuthenticationFailed')
      : t('wallet.invalidSpendingPassword');
    snackbar.setError(error?.message || errorMessage);
  } finally {
    isValidating.value = false;
  }
};

// Expose handlers and state so parent can call them
defineExpose({
  handleBack,
  handleConfirm,
  spendingPassword,
  isValidating,
  isExpired,
  isPrfWallet
});

</script>

<style lang="scss" scoped>
@import '../../../styles/variables';
@import '../../../styles/mixins';

.payment-step {
  width: 100%;
  @include flex-column;
  gap: $spacing-xl;
}

.payment-amount-card {
  padding: $spacing-xl;
  background: linear-gradient(135deg, rgba($primary-cyan, 0.1) 0%, rgba($primary-green, 0.1) 100%);
  border: 1px solid rgba($primary-cyan, 0.3);
  border-radius: $border-radius-lg;
}

.amount-header {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  margin-bottom: $spacing-md;
}

.payment-icon {
  color: $primary-cyan;
  font-size: $font-size-xl;
}

.payment-label {
  font-family: $font-family-primary;
  font-weight: $font-weight-medium;
  font-size: $font-size-base;
  color: $text-secondary;
}

.amount-display {
  text-align: center;
}

.amount-row {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: $spacing-sm;
  flex-wrap: wrap;
}

.amount-value {
  font-family: $font-family-primary;
  font-weight: $font-weight-bold;
  font-size: $font-size-3xl;
  color: $text-primary;
  line-height: 1.4;

  &.ada {
    background: $primary-gradient;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    display: inline-block;
    padding: 2px 0;
  }
}

.amount-equivalent {
  font-family: $font-family-primary;
  font-size: $font-size-lg;
  color: $text-muted;
}

.expired-alert {
  background: rgba(#f44336, 0.1) !important;
  border-color: #f44336 !important;

  :deep(.v-alert__content) {
    width: 100%;
  }

  .alert-title {
    color: #f44336;
  }
}

.info-alert {
  background: rgba(#1976d2, 0.1) !important;
  border-color: $primary-cyan !important;

  :deep(.v-alert__content) {
    width: 100%;
  }
}

.alert-content {
  @include flex-column;
  gap: $spacing-sm;
}

.alert-title {
  display: flex;
  align-items: center;
  gap: $spacing-xs;
  font-family: $font-family-primary;
  font-weight: $font-weight-semibold;
  font-size: $font-size-base;
  color: $primary-cyan;
}

.alert-body {
  @include flex-column;
  gap: $spacing-xs;

  p {
    font-family: $font-family-primary;
    font-size: $font-size-sm;
    color: $text-secondary;
    margin: 0;
    line-height: $line-height-relaxed;

    &.highlight {
      color: $text-primary;
      font-weight: $font-weight-medium;
    }
  }
}

.auth-section {
  width: 100%;
  @include flex-column;
}

.password-field {
  width: 100%;
}

.prf-info-alert {
  background: rgba($primary-cyan, 0.1) !important;
  border-color: $primary-cyan !important;

  :deep(.v-alert__content) {
    width: 100%;
  }
}

@media (max-width: $breakpoint-sm) {
  .amount-value {
    font-size: $font-size-2xl;
  }
}
</style>
