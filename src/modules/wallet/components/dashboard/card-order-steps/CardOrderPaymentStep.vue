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
    <v-alert v-else type="info" colored-border border="left" class="info-alert" elevation="0">
      <div class="alert-content">
        <div class="alert-title">
          <v-icon small color="#00c7f3">mdi-information</v-icon>
          <span>{{ $t('card.importantInformation') }}</span>
        </div>
        <div class="alert-body">
          <p>{{ $t('card.paymentCoversShippingOnly') }}</p>
          <p>{{ $t('card.notATopUp') }}</p>
          <p class="highlight">{{ $t('card.oneTimePaymentAddress') }}</p>
        </div>
      </div>
    </v-alert>

    <!-- Spending Password Section -->
    <div class="password-section">
      <label class="input-label">{{ $t('wallet.spendingPassword') }}</label>
      <v-text-field
        v-model="spendingPassword"
        dense
        outlined
        class="password-input"
        :type="showPassword ? 'text' : 'password'"
        hide-details
        :placeholder="$t('card.enterSpendingPassword')"
      >
        <template v-slot:append>
          <v-icon @click="showPassword = !showPassword" tabindex="-1">
            {{ showPassword ? 'mdi-eye' : 'mdi-eye-off' }}
          </v-icon>
        </template>
      </v-text-field>
    </div>

    <!-- Actions -->
    <div class="step-actions">
      <SecondaryButton :text="$t('card.back')" @click="handleBack" :disabled="isValidating" />
      <GradientButton 
        :text="$t('card.confirmPayment')" 
        @click="handleConfirm" 
        :disabled="!spendingPassword || isValidating || isExpired"
        :loading="isValidating"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import SecondaryButton from '../../SecondaryButton.vue';
import GradientButton from '../../GradientButton.vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import snackbar from '@/plugins/snackbar';
import { useTranslation } from '@/shared/composables/useTranslation';

interface Props {
  amountAda: number;
  amountEur: number;
  paymentStatus?: string;
}

interface Emits {
  (e: 'back'): void;
  (e: 'confirm', password: string): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const { t } = useTranslation();

const isExpired = computed(() => {
  const status = props.paymentStatus?.toLowerCase() || '';
  return status === 'expired';
});

// Local state
const spendingPassword = ref('');
const showPassword = ref(false);
const isValidating = ref(false);

// Handlers
const handleBack = () => {
  emit('back');
};

const handleConfirm = async () => {
  isValidating.value = true;
  try {
    // Verify spending password
    const passwordVerification = (await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.VERIFY_SPENDING_PASSWORD,
      data: { password: spendingPassword.value },
    })) as { data: { success: boolean; error?: string } };

    if (!passwordVerification.data.success) {
      snackbar.setError(t('wallet.invalidSpendingPassword'));
      isValidating.value = false;
      return;
    }

    console.log('✅ Password verified successfully');
    // Password is valid, emit to parent for transaction handling
    emit('confirm', spendingPassword.value);
  } catch (error) {
    console.error('❌ Error verifying password:', error);
    snackbar.setError(t('wallet.invalidSpendingPassword'));
  } finally {
    isValidating.value = false;
  }
};

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

  &.ada {
    background: $primary-gradient;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
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

.password-section {
  @include flex-column;
  gap: $spacing-xs;
}

.input-label {
  font-family: $font-family-primary;
  font-weight: $font-weight-medium;
  font-size: $font-size-sm;
  color: $text-secondary;
}

.password-input {
  :deep(.v-input__control) {
    background: $background-card !important;
    border: 1px solid $border-primary !important;
    border-radius: $border-radius-md !important;
  }

  :deep(.v-input__slot) {
    background: transparent !important;
    box-shadow: none !important;
    min-height: 44px !important;
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

  :deep(.v-input--is-disabled) {
    opacity: 0.6;
  }
}

.step-actions {
  display: flex;
  gap: $spacing-md;
  margin-top: $spacing-md;
}

.step-actions :deep(.secondary-button),
.step-actions :deep(.gradient-button) {
  flex: 1;
  width: 100%;
  height: 44px;
  font-size: $font-size-base;
  font-weight: $font-weight-semibold;
  text-transform: none;
}

@media (max-width: $breakpoint-sm) {
  .amount-value {
    font-size: $font-size-2xl;
  }
}
</style>
