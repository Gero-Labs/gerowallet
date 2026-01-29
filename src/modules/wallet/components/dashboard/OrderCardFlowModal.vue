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

      <!-- Progress Stepper -->
      <v-stepper
        v-if="selectedCardType === 'physical' && currentStep > 1 && currentStep < 6"
        v-model="currentStep"
        class="order-stepper"
        flat
        non-linear
      >
        <v-stepper-header>
          <v-stepper-step :complete="currentStep > 2" step="1" color="#00c7f3">
            {{ $t('card.shippingAddress') }}
          </v-stepper-step>
          <v-divider></v-divider>
          <v-stepper-step :complete="currentStep > 3" step="2" color="#00c7f3">
            {{ $t('card.shippingMethod') }}
          </v-stepper-step>
          <v-divider></v-divider>
          <v-stepper-step :complete="currentStep > 4" step="3" color="#00c7f3">
            {{ $t('card.paymentDetails') }}
          </v-stepper-step>
          <v-divider></v-divider>
          <v-stepper-step step="4" color="#00c7f3">
            {{ $t('card.confirm') }}
          </v-stepper-step>
        </v-stepper-header>
      </v-stepper>

      <!-- Step Content -->
      <div class="modal-content">
        <!-- Step 1: Card Type Selection -->
        <CardTypeSelectionStep
          v-if="currentStep === 1"
          :selected-type="selectedCardType"
          :has-virtual-card="hasVirtualCard"
          :has-physical-card="hasPhysicalCard"
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
          :is-loading="isProcessing"
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
import { OrderPhysicalCardPayload } from '@/stores/modules/card';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { Cardano } from '@cardano-sdk/core';
import { serializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { buildCardanoTransaction } from '@/shared/utils/builder';

const { t } = useTranslation();
const router = useRouter();

// Check if user already has virtual or physical cards
// For physical cards, also check if payment is pending - if so, allow continuing payment
const hasVirtualCard = computed(() => {
  return cardStore.state.cards.some(
    card => {
      const isVirtual = card.cardData?.own_type === 'virtual';
      if (!isVirtual) return false;
      
      const hasCardOrOrder = card.cardData?.card_uuid || card.cardData?.order_uuid;
      if (!hasCardOrOrder) return false;
      
      // Check if card is rejected (case-insensitive)
      const status = card.cardData?.status?.toLowerCase() || '';
      const isRejected = status === 'rejected';
      
      // If virtual card exists but is rejected, allow ordering new one
      if (isRejected) {
        return false;
      }
      
      return true;
    }
  );
});

const hasPhysicalCard = computed(() => {
  return cardStore.state.cards.some(
    card => {
      const isPhysical = card.cardData?.own_type === 'physical';
      if (!isPhysical) return false;
      
      const hasCardUuid = !!card.cardData?.card_uuid;
      const hasOrderUuid = !!card.cardData?.order_uuid;
      const hasCardOrOrder = hasCardUuid || hasOrderUuid;
      
      if (!hasCardOrOrder) return false;
      
      // Check if card is rejected FIRST (case-insensitive) - this takes priority
      const status = card.cardData?.status?.toLowerCase() || '';
      const isRejected = status === 'rejected';
      
      // If physical card exists but is rejected, allow ordering new one
      if (isRejected) {
        return false;
      }
      
      // If card has UUID, it's active - already ordered
      if (hasCardUuid) {
        return true;
      }
      
      // If card has order_uuid but no card_uuid, check payment status
      if (hasOrderUuid && !hasCardUuid) {
        // Check payment status from delivery object
        const delivery = (card.cardData as any)?.delivery;
        if (delivery) {
          const paymentStatus = delivery.payment_status?.toLowerCase();
          // If payment status is 'pending', allow continuing payment
          if (paymentStatus === 'pending') {
            return false; // Allow continuing payment
          }
          // If payment status is not pending (detected, confirming, confirmed, completed), card is being processed
          // But if it's failed or expired, allow re-ordering
          if (paymentStatus === 'failed' || paymentStatus === 'expired') {
            return false; // Allow re-ordering
          }
          // Otherwise, payment is in progress, consider it as already ordered
          return true;
        }
        
        // If no delivery object, assume payment is pending and allow continuing
        return false;
      }
      
      return false;
    }
  );
});

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

// Card type selection
const selectedCardType = ref<'virtual' | 'physical' | null>(null);

// Get saved delivery address from last physical card
const getSavedDeliveryAddress = () => {
  const cards = cardStore.state.cards || [];
  const physicalCards = cards.filter(card => card.cardData?.own_type === 'physical');
  
  if (physicalCards.length === 0) return null;
  
  // Get the most recent physical card (by created_at or updated_at)
  const lastPhysicalCard = physicalCards.sort((a, b) => {
    const dateA = new Date(b.cardData?.updated_at || b.cardData?.created_at || 0).getTime();
    const dateB = new Date(a.cardData?.updated_at || a.cardData?.created_at || 0).getTime();
    return dateA - dateB;
  })[0];
  
  // Check if card has delivery object
  const delivery = (lastPhysicalCard.cardData as any)?.delivery;
  if (!delivery) return null;
  
  return {
    streetAddress: delivery.address || '',
    city: delivery.city || '',
    stateProvince: delivery.region || '',
    zipCode: delivery.zip || '',
    countryCode: delivery.country_code || '',
    phone: delivery.phone || '',
  };
};

// Shipping address
const useExistingAddress = ref(false);
const savedDeliveryAddress = getSavedDeliveryAddress();
const shippingAddress = ref(savedDeliveryAddress || {
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
  ada: 0,
  eur: 0,
});
const paymentAddress = ref('');
const orderUuid = ref('');
const paymentId = ref(0);
const exchangeRate = ref('');
const depositExpiresAt = ref('');
const depositQrCode = ref('');

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

const handleShippingMethodSelect = async (method: 'regular' | 'express-eu' | 'express-worldwide') => {
  shippingMethod.value = method;
  
  try {
    isProcessing.value = true;
    
    // Create order on backend to get payment details
    const payload: OrderPhysicalCardPayload = {
      address: shippingAddress.value.streetAddress,
      region: shippingAddress.value.stateProvince,
      city: shippingAddress.value.city,
      zipCode: shippingAddress.value.zipCode,
      countryCode: shippingAddress.value.countryCode,
      phone: shippingAddress.value.phone,
      deliveryMethod: method,
    };
    
    const orderResponse = await cardStore.orderPhysicalCard(payload);
    
    if (!orderResponse) {
      throw new Error(t('card.failedToGetPaymentDetails'));
    }
    
    // Store order details
    orderUuid.value = orderResponse.orderUuid || '';
    paymentId.value = orderResponse.paymentId || 0;
    
    // Get payment address (depositAddress)
    paymentAddress.value = orderResponse.depositAddress || '';
    
    // Get payment amount (depositAmountAda, depositAmountEur)
    const amountAda = parseFloat(orderResponse.depositAmountAda || '0');
    const amountEur = parseFloat(orderResponse.depositAmountEur || '0');
    
    paymentAmount.value = {
      ada: amountAda,
      eur: amountEur,
    };
    
    // Store additional payment info
    exchangeRate.value = orderResponse.exchangeRate || '';
    depositExpiresAt.value = orderResponse.depositExpiresAt || '';
    depositQrCode.value = orderResponse.depositQrCode || '';
    
    if (!paymentAddress.value || paymentAmount.value.ada <= 0) {
      throw new Error(t('card.failedToGetPaymentDetails'));
    }
    
    currentStep.value = 4;
  } catch (error: any) {
    snackbar.setError(error?.message || t('card.failedToOrderCard') + ' ' + t('card.pleaseTryAgain'));
  } finally {
    isProcessing.value = false;
  }
};

const handlePaymentConfirm = async (spendingPassword: string) => {
  // Move to confirmation step
  currentStep.value = 5;
  isProcessing.value = true;

  try {
    if (!paymentAddress.value) {
      throw new Error(t('card.missingPaymentAddress'));
    }

    const adaAmount = paymentAmount.value.ada;
    if (isNaN(adaAmount) || adaAmount <= 0) {
      throw new Error(t('errors.invalidAmount'));
    }

    const lovelaceAmount = BigInt(Math.floor(adaAmount * 1_000_000)) as Cardano.Lovelace;

    const outputs: Cardano.TxOut[] = [
      {
        address: paymentAddress.value as Cardano.PaymentAddress,
        value: {
          coins: lovelaceAmount,
          assets: new Map(),
        },
      },
    ];

    const tx = await buildCardanoTransaction({
      outputs,
      utxos: walletStore.utxos,
      epochParams: networkStore.epochParams,
      changeAddress: walletStore.loggedWallet.baseAddress,
      tip: networkStore.tip,
    });

    const txCbor = serializeCardanoJsSdkTx(tx);
    const witnessResult = (await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_TX,
      data: {
        txCbor: txCbor,
        partialSign: false,
        password: spendingPassword,
        accountIndex: 0,
        utxos: walletStore.utxos,
        addresses: walletStore.keys,
        mergeWitnesses: false,
      },
    })) as { data: { witnesses?: any; error?: string } };

    if (witnessResult.data.error) {
      throw new Error(witnessResult.data.error);
    }

    const txWitnesses = witnessResult.data.witnesses;
    const submitResult = (await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SUBMIT_TX,
      data: {
        txCbor: txCbor,
        witnessHex: txWitnesses,
        utxos: walletStore.utxos,
      },
    })) as { data: { txId?: string; error?: string } };

    if (submitResult.data.error) {
      throw new Error(submitResult.data.error);
    }

    snackbar.fireSuccess(t('notifications.transactionSubmitted'));

    await cardStore.fetchCardData();

    orderSuccess.value = true;
  } catch (error: any) {
    snackbar.setError(error?.message || t('card.failedToOrderCard') + ' ' + t('card.pleaseTryAgain'));
    currentStep.value = 4;
  } finally {
    isProcessing.value = false;
  }
};

const handleOrderComplete = async () => {
  await cardStore.fetchCardData();
  handleClose();
  router.push('/card');
};

const handleClose = async () => {
  await cardStore.fetchCardData();
  currentStep.value = 1;
  selectedCardType.value = null;
  useExistingAddress.value = false;
  shippingAddress.value = {
    streetAddress: '',
    city: '',
    stateProvince: '',
    zipCode: '',
    countryCode: '',
    phone: '',
  };
  shippingMethod.value = 'regular';
  paymentAmount.value = { ada: 0, eur: 0 };
  paymentAddress.value = '';
  orderUuid.value = '';
  paymentId.value = 0;
  exchangeRate.value = '';
  depositExpiresAt.value = '';
  depositQrCode.value = '';
  isProcessing.value = false;
  orderSuccess.value = false;
  orderingVirtualCard.value = false;
  emit('close');
};

// Reset state when dialog opens
watch(
  () => props.open,
  async newVal => {
    if (newVal) {
      currentStep.value = 1;
      selectedCardType.value = null;
      orderSuccess.value = false;
      // Refresh card data to get latest statuses
      try {
        await cardStore.fetchCardData();
      } catch (error) {
        // Silent error - continue anyway
      }
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

.order-stepper {
  background: transparent !important;
  box-shadow: none !important;
  padding: 0 $spacing-xl $spacing-lg;

  :deep(.v-stepper__header) {
    box-shadow: none;
    background: transparent;
    padding: 0;
  }

  :deep(.v-stepper__step) {
    padding: $spacing-xs;

    .v-stepper__step__step {
      background: $background-secondary;
      border: 2px solid $border-primary;
      color: $text-muted;
      font-family: $font-family-primary;
      font-weight: $font-weight-semibold;
      font-size: $font-size-sm;
      width: 28px;
      height: 28px;
      min-width: 28px;
    }

    &.v-stepper__step--active .v-stepper__step__step {
      background: rgba($primary-cyan, 0.2);
      border-color: $primary-cyan;
      color: $primary-cyan;
    }

    &.v-stepper__step--complete .v-stepper__step__step {
      background: $primary-cyan;
      border-color: $primary-cyan;
      color: $background-dark;

      .v-icon {
        color: $background-dark;
        font-size: $font-size-base;
      }
    }
  }

  :deep(.v-stepper__label) {
    font-family: $font-family-primary;
    font-size: $font-size-xs;
    color: $text-muted;
    text-align: center;
    line-height: $line-height-tight;
  }

  :deep(.v-stepper__step--active .v-stepper__label) {
    color: $primary-cyan;
  }

  :deep(.v-stepper__step--complete .v-stepper__label) {
    color: $text-secondary;
  }

  :deep(.v-divider) {
    border-color: $border-primary;
    margin: 0 $spacing-xs;
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
