<template>
  <v-dialog v-model="dialog" max-width="600" persistent content-class="order-card-flow-modal">
    <v-card class="modal-card">
      <!-- Header -->
      <div class="modal-header">
        <div class="header-content">
          <h2 class="modal-title">{{ currentTitle }}</h2>
          <p class="modal-subtitle">{{ currentSubtitle }}</p>
        </div>
        <v-btn icon class="close-btn" @click="handleClose" :disabled="isProcessing">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </div>

      <!-- Progress Indicator -->
      <div v-if="selectedCardType === 'physical' && currentStep > 1 && currentStep < 6" class="progress-indicator">
        <div
          v-for="step in physicalSteps"
          :key="step"
          class="progress-step"
          :class="{
            active: currentStep === step,
            completed: currentStep > step,
          }"
        >
          <div class="step-number">{{ step - 1 }}</div>
        </div>
      </div>

      <!-- Step Content -->
      <div class="modal-content">
        <!-- Step 1: Card Type Selection -->
        <CardTypeSelectionStep
          v-if="currentStep === 1"
          :selected-type="selectedCardType"
          @select="handleCardTypeSelect"
        />

        <!-- Step 2: Shipping Address Selection (Physical only) -->
        <ShippingAddressSelectionStep
          v-if="currentStep === 2"
          :use-existing="useExistingAddress"
          :address="shippingAddress"
          @back="handleBack"
          @submit="handleAddressSubmit"
        />

        <!-- Step 3: Shipping Method Selection (Physical only) -->
        <ShippingMethodStep
          v-if="currentStep === 3"
          :selected-method="shippingMethod"
          @back="handleBack"
          @select="handleShippingMethodSelect"
        />

        <!-- Step 4: Payment Info (Physical only) -->
        <CardOrderPaymentStep
          v-if="currentStep === 4"
          :amount-ada="paymentAmount.ada"
          :amount-eur="paymentAmount.eur"
          @back="handleBack"
          @confirm="handlePaymentConfirm"
        />

        <!-- Step 5: Payment Confirmation (Physical only) -->
        <PaymentConfirmationStep
          v-if="currentStep === 5"
          :is-loading="isProcessing"
          :is-success="orderSuccess"
          @complete="handleOrderComplete"
        />
      </div>

      <!-- Actions for Step 1 -->
      <div v-if="currentStep === 1" class="modal-actions">
        <SecondaryButton :text="$t('common.cancel')" @click="handleClose" />
        <GradientButton
          :text="$t('card.continueButton')"
          @click="handleContinueFromTypeSelection"
          :disabled="!selectedCardType"
          :loading="orderingVirtualCard"
        />
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useRouter } from 'vue-router/composables';
import SecondaryButton from '../SecondaryButton.vue';
import GradientButton from '../GradientButton.vue';
import CardTypeSelectionStep from './card-order-steps/CardTypeSelectionStep.vue';
import ShippingAddressSelectionStep from './card-order-steps/ShippingAddressSelectionStep.vue';
import ShippingMethodStep from './card-order-steps/ShippingMethodStep.vue';
import CardOrderPaymentStep from './card-order-steps/CardOrderPaymentStep.vue';
import PaymentConfirmationStep from './card-order-steps/PaymentConfirmationStep.vue';
import cardStore from '@/stores/modules/card';
import snackbar from '@/plugins/snackbar';

const { t } = useTranslation();
const router = useRouter();

interface Props {
  open: boolean;
}

interface Emits {
  (e: 'close'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

// Dialog state
const dialog = computed({
  get: () => props.open,
  set: value => {
    if (!value) {
      emit('close');
    }
  },
});

// Step management
const currentStep = ref(1);
const physicalSteps = [2, 3, 4, 5];

// Card type selection
const selectedCardType = ref<'virtual' | 'physical' | null>(null);

// Shipping address
const useExistingAddress = ref(true);
const shippingAddress = ref({
  streetAddress: '',
  city: '',
  stateProvince: '',
  zipCode: '',
  countryCode: '',
  phone: '',
});

// Shipping method
const shippingMethod = ref<'regular' | 'express-eu' | 'express-worldwide'>('regular');

// Payment
const paymentAmount = ref({
  ada: 12.5,
  eur: 5.0,
});

// Processing states
const isProcessing = ref(false);
const orderingVirtualCard = ref(false);
const orderSuccess = ref(false);

// Computed titles based on current step
const currentTitle = computed(() => {
  switch (currentStep.value) {
    case 1:
      return t('card.orderYourGeroCard');
    case 2:
      return t('card.shippingAddress');
    case 3:
      return t('card.selectShippingMethod');
    case 4:
      return t('card.paymentDetails');
    case 5:
      return orderSuccess.value ? t('card.orderConfirmed') : t('card.processingOrder');
    default:
      return t('card.orderYourGeroCard');
  }
});

const currentSubtitle = computed(() => {
  switch (currentStep.value) {
    case 1:
      return t('card.chooseOptionBelow');
    case 2:
      return t('card.whereToShipCard');
    case 3:
      return t('card.selectDeliverySpeed');
    case 4:
      return t('card.reviewPaymentDetails');
    case 5:
      return orderSuccess.value ? t('card.yourOrderHasBeenPlaced') : t('card.pleaseWait');
    default:
      return '';
  }
});

// Handlers
const handleCardTypeSelect = (type: 'virtual' | 'physical') => {
  selectedCardType.value = type;
};

const handleContinueFromTypeSelection = async () => {
  if (!selectedCardType.value) return;

  if (selectedCardType.value === 'virtual') {
    // Virtual card flow - order immediately
    await orderVirtualCard();
  } else {
    // Physical card flow - go to address step
    currentStep.value = 2;
  }
};

const orderVirtualCard = async () => {
  try {
    orderingVirtualCard.value = true;
    await cardStore.orderCard();
    await cardStore.fetchCardData();
    snackbar.fireSuccess(t('card.cardOrderedSuccess'));
    handleClose();
    // Navigate to card page (will show pending section)
    router.push('/card');
  } catch (error: any) {
    console.error('Failed to order virtual card:', error);
    let errorReason: string;
    if (typeof error?.response?.data === 'string' && error.response.data) {
      errorReason = '<b>' + t('card.failedToOrderCard') + '</b><br>' + error.response.data;
    } else {
      errorReason =
        t('card.failedToOrderCard') +
        ' ' +
        (error?.response?.data?.error?.message ||
          error?.response?.data?.error ||
          error?.response?.data?.reason ||
          error?.response?.data?.message ||
          error?.message ||
          t('card.pleaseTryAgain'));
    }
    snackbar.setError(errorReason);
  } finally {
    orderingVirtualCard.value = false;
  }
};

const handleBack = () => {
  if (currentStep.value > 1) {
    currentStep.value--;
  }
};

const handleAddressSubmit = (payload: { useExisting: boolean; address?: typeof shippingAddress.value }) => {
  useExistingAddress.value = payload.useExisting;
  if (payload.address) {
    shippingAddress.value = payload.address;
  }
  currentStep.value = 3;
};

const handleShippingMethodSelect = (method: 'regular' | 'express-eu' | 'express-worldwide') => {
  shippingMethod.value = method;
  // Update payment amount based on shipping method
  const fees: Record<string, { ada: number; eur: number }> = {
    regular: { ada: 12.5, eur: 3.99 },
    'express-eu': { ada: 31.2, eur: 9.99 },
    'express-worldwide': { ada: 62.5, eur: 19.99 },
  };
  paymentAmount.value = fees[method] || fees.regular;
  currentStep.value = 4;
};

const handlePaymentConfirm = async () => {
  // Move to confirmation step
  currentStep.value = 5;
  isProcessing.value = true;

  // Simulate payment processing (placeholder for backend integration)
  try {
    // TODO: Backend integration required
    // In the future, this will:
    // 1. Get payment address from backend
    // 2. Sign and submit transaction with spending password
    // 3. Poll for payment confirmation
    // 4. Call orderPhysicalCard with payment_tx_id

    // For now, simulate a delay for payment confirmation
    await new Promise(resolve => setTimeout(resolve, 3000));

    // TODO: Uncomment when backend is ready
    // Build the payload for physical card order
    // const payload = {
    //   address: useExistingAddress.value ? '' : shippingAddress.value.streetAddress,
    //   region: useExistingAddress.value ? '' : shippingAddress.value.stateProvince,
    //   city: useExistingAddress.value ? '' : shippingAddress.value.city,
    //   zipCode: useExistingAddress.value ? '' : shippingAddress.value.zipCode,
    //   countryCode: useExistingAddress.value ? '' : shippingAddress.value.countryCode,
    //   phone: useExistingAddress.value ? '' : shippingAddress.value.phone,
    //   deliveryMethod: shippingMethod.value,
    //   // payment_tx_id: txId, // Add after transaction is submitted
    // };
    //
    // await cardStore.orderPhysicalCard(payload);
    // await cardStore.fetchCardData();

    // Simulate success for now
    orderSuccess.value = true;
  } catch (error: any) {
    console.error('Failed to order physical card:', error);
    snackbar.setError(t('card.failedToOrderCard') + ' ' + (error?.message || t('card.pleaseTryAgain')));
    // Go back to payment step on error
    currentStep.value = 4;
  } finally {
    isProcessing.value = false;
  }
};

const handleOrderComplete = () => {
  handleClose();
  router.push('/card');
};

const handleClose = () => {
  // Reset state
  currentStep.value = 1;
  selectedCardType.value = null;
  useExistingAddress.value = true;
  shippingAddress.value = {
    streetAddress: '',
    city: '',
    stateProvince: '',
    zipCode: '',
    countryCode: '',
    phone: '',
  };
  shippingMethod.value = 'regular';
  paymentAmount.value = { ada: 12.5, eur: 5.0 };
  isProcessing.value = false;
  orderSuccess.value = false;
  orderingVirtualCard.value = false;
  emit('close');
};

// Reset state when dialog opens
watch(
  () => props.open,
  newVal => {
    if (newVal) {
      currentStep.value = 1;
      selectedCardType.value = null;
      orderSuccess.value = false;
    }
  }
);
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.order-card-flow-modal {
  border-radius: $border-radius-lg;
}

.modal-card {
  background: $background-dark !important;
  border-radius: $border-radius-lg !important;
  overflow: hidden;
}

.modal-header {
  position: relative;
  padding: $spacing-3xl $spacing-3xl $spacing-lg;
  display: flex;
  align-items: flex-start;
}

.header-content {
  flex: 1;
}

.modal-title {
  font-family: $font-family-primary;
  font-weight: $font-weight-bold;
  font-size: $font-size-2xl;
  line-height: $line-height-tight;
  color: $text-primary;
  margin: 0 0 $spacing-sm 0;
}

.modal-subtitle {
  font-family: $font-family-primary;
  font-weight: $font-weight-normal;
  font-size: $font-size-base;
  line-height: $line-height-relaxed;
  color: $text-muted;
  margin: 0;
}

.close-btn {
  position: absolute;
  right: $spacing-lg;
  top: $spacing-lg;
  width: 44px;
  height: 44px;

  .v-icon {
    color: #85888e;
    font-size: $font-size-xl;
  }
}

.progress-indicator {
  display: flex;
  justify-content: center;
  gap: $spacing-md;
  padding: 0 $spacing-3xl $spacing-lg;
}

.progress-step {
  .step-number {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: $background-secondary;
    border: 2px solid $border-primary;
    color: $text-muted;
    font-family: $font-family-primary;
    font-weight: $font-weight-semibold;
    font-size: $font-size-sm;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s ease;
  }

  &.active .step-number {
    background: rgba($primary-cyan, 0.2);
    border-color: $primary-cyan;
    color: $primary-cyan;
  }

  &.completed .step-number {
    background: $primary-cyan;
    border-color: $primary-cyan;
    color: $background-dark;
  }
}

.modal-content {
  padding: 0 $spacing-3xl $spacing-lg;
}

.modal-actions {
  display: flex;
  gap: $spacing-md;
  padding: $spacing-lg $spacing-3xl $spacing-3xl;
}

.modal-actions :deep(.secondary-button),
.modal-actions :deep(.gradient-button) {
  flex: 1;
  width: 100%;
  height: 44px;
  font-size: $font-size-base;
  font-weight: $font-weight-semibold;
  text-transform: none;
}

@media (max-width: $breakpoint-sm) {
  .modal-header {
    padding: $spacing-2xl $spacing-2xl $spacing-md;
  }

  .modal-content {
    padding: 0 $spacing-2xl $spacing-md;
  }

  .modal-actions {
    padding: $spacing-md $spacing-2xl $spacing-2xl;
    flex-direction: column;
  }

  .progress-indicator {
    padding: 0 $spacing-2xl $spacing-md;
  }
}
</style>
