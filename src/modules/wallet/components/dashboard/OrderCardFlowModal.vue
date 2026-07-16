<template>
  <BaseDialog
    :is-open="dialog"
    :title="currentTitle"
    :subtitle="currentSubtitle"
    :width="650"
    :persistent="true"
    :loading="isLoadingAdaAmountToPay || isProcessing"
    @close="handleClose"
    :min-height="600"
    icon="mdi-credit-card-plus"
    scrollable
  >
    <!-- Progress Stepper -->
    <v-stepper
      v-if="selectedCardType === 'physical' && currentStep > 1 && currentStep < 6"
      :value="Number(currentStep)"
      @change="currentStep = Number($event)"
      flat
      class="transparent px-2"
      style="min-height: 72px;"
    >
      <v-stepper-header>
        <v-stepper-step :complete="currentStep > 1" step="1" color="primary" class="pa-2">
          {{ $t('card.cardType') }}
        </v-stepper-step>
        <v-divider></v-divider>
        <v-stepper-step :complete="currentStep > 2" step="2" color="primary" class="pa-2">
          {{ $t('card.shippingAddress') }}
        </v-stepper-step>
        <v-divider></v-divider>
        <v-stepper-step :complete="currentStep > 3" step="3" color="primary" class="pa-2">
          {{ $t('card.shippingMethod') }}
        </v-stepper-step>
        <v-divider></v-divider>
        <v-stepper-step :complete="currentStep > 4" step="4" color="primary" class="pa-2">
          {{ $t('card.paymentDetails') }}
        </v-stepper-step>
        <v-divider></v-divider>
        <v-stepper-step step="5" color="primary" class="pa-2">
          {{ $t('card.confirm') }}
        </v-stepper-step>
      </v-stepper-header>
    </v-stepper>

    <!-- Step Content -->
    <v-card-text class="modal-content px-3">
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
        ref="addressStepRef"
        :address="shippingAddress"
        @back="handleBack"
        @submit="handleAddressSubmit"
      />

      <!-- Step 3: Shipping Method Selection (Physical only) -->
      <ShippingMethodStep
        v-if="currentStep === 3"
        ref="methodStepRef"
        :selected-method="shippingMethod"
        :is-loading="isLoadingAdaAmountToPay"
        @back="handleBack"
        @select="handleShippingMethodSelect"
      />

      <!-- Step 4: Payment Info (Physical only) -->
      <CardOrderPaymentStep
        v-if="currentStep === 4"
        ref="paymentStepRef"
        :amount-eur="paymentAmount.eur"
        @back="handleBack"
        @confirm="handlePaymentConfirm"
      />

      <!-- Step 5: Payment Confirmation (Physical only) -->
      <PaymentConfirmationStep
        v-if="currentStep === 5"
        :is-loading="isProcessing"
        :is-success="orderSuccess"
        @complete="handleClose"
      />
    </v-card-text>

    <!-- Actions for Step 1 -->
    <v-card-actions v-if="currentStep === 1" class="modal-actions px-3">
      <SecondaryButton :text="t('common.cancel')" @click="handleClose" />
      <GradientButton
        :text="t('card.continueButton')"
        @click="handleContinueFromTypeSelection"
        :disabled="!selectedCardType"
        :loading="orderingVirtualCard"
      />
    </v-card-actions>

    <!-- Actions for Step 2 -->
    <v-card-actions v-if="currentStep === 2" class="modal-actions px-3">
      <SecondaryButton :text="t('common.back')" @click="addressStepRef?.handleBack()" />
      <GradientButton
        :text="t('card.continueButton')"
        @click="addressStepRef?.handleContinue()"
      />
    </v-card-actions>

    <!-- Actions for Step 3 -->
    <v-card-actions v-if="currentStep === 3" class="modal-actions px-3">
      <SecondaryButton :text="t('common.back')" @click="methodStepRef?.handleBack()" :disabled="isLoadingAdaAmountToPay" />
      <GradientButton
        :text="t('card.continueButton')"
        @click="methodStepRef?.handleContinue()"
        :loading="isLoadingAdaAmountToPay"
        :disabled="isLoadingAdaAmountToPay"
      />
    </v-card-actions>

    <!-- Actions for Step 4 -->
    <v-card-actions v-if="currentStep === 4" class="modal-actions px-3">
      <SecondaryButton :text="t('common.back')" @click="paymentStepRef?.handleBack()" :disabled="paymentStepRef?.isValidating" />
      <GradientButton
        :text="t('card.confirmPayment')"
        :icon-image="paymentStepRef?.isPrfWallet ? assets.passKeySvg : undefined"
        @click="paymentStepRef?.handleConfirm()"
        :disabled="(!paymentStepRef?.isPrfWallet && !paymentStepRef?.spendingPassword) || paymentStepRef?.isValidating || paymentStepRef?.isExpired"
        :loading="paymentStepRef?.isValidating"
      />
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import SecondaryButton from '../SecondaryButton.vue';
import GradientButton from '../GradientButton.vue';
import CardTypeSelectionStep from './card-order-steps/CardTypeSelectionStep.vue';
import ShippingAddressSelectionStep from './card-order-steps/ShippingAddressSelectionStep.vue';
import ShippingMethodStep from './card-order-steps/ShippingMethodStep.vue';
import CardOrderPaymentStep from './card-order-steps/CardOrderPaymentStep.vue';
import PaymentConfirmationStep from './card-order-steps/PaymentConfirmationStep.vue';
import cardStore, { OrderPhysicalCardPayload } from '@/stores/modules/card';
import snackbar from '@/plugins/snackbar';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import assets from '@/utils/assets';
import { Cardano } from '@cardano-sdk/core';
import { walletStore } from '@/stores/walletStore';
import { nexusTxApi, walletUtxosToNexusInputs, txOutToNexusOutput, type BuildTxRequest } from '@/api/nexus-tx-api';

const { t } = useTranslation();

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
      return !isRejected;
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
        const delivery = card.cardData?.delivery;
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

// Refs for steps
const addressStepRef = ref(null);
const methodStepRef = ref(null);
const paymentStepRef = ref(null);

// Step management
const currentStep = ref(1);

// Ensure currentStep is always a number (v-stepper can set it as string)
watch(currentStep, (newVal) => {
  if (typeof newVal === 'string') {
    currentStep.value = Number(newVal);
  }
});

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
  const delivery = lastPhysicalCard.cardData?.delivery;
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
  eur: 0,
});
const paymentAddress = ref('');
const orderUuid = ref('');
const paymentId = ref(0);
const exchangeRate = ref('');
const depositExpiresAt = ref('');
const depositQrCode = ref('');

// Processing states
const isLoadingAdaAmountToPay = ref(false);
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
    snackbar.fireSuccess(t('card.cardOrderedSuccess'));
    handleClose();
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

const handleAddressSubmit = async (payload: { address?: typeof shippingAddress.value }) => {
  if (payload.address) {
    console.log(payload.address);
    shippingAddress.value = payload.address;
  }
  currentStep.value = 3;
};

const handleShippingMethodSelect = async (method: 'regular' | 'express-eu' | 'express-worldwide') => {
  isLoadingAdaAmountToPay.value = true;
  shippingMethod.value = method;
  if (method === 'regular') {
    paymentAmount.value.eur = 10;
  }
  await cardStore.getExchangeRate();
  currentStep.value = 4;
  isLoadingAdaAmountToPay.value = false;
};

const handlePaymentConfirm = async (spendingPassword: string, privateKeyBytes?: Uint8Array) => {
  isProcessing.value = true;
  currentStep.value = 5;
  await nextTick();

  try {
    // TODO Check balance first
    const payload: OrderPhysicalCardPayload = {
      address: shippingAddress.value.streetAddress,
      region: shippingAddress.value.stateProvince,
      city: shippingAddress.value.city,
      zipCode: shippingAddress.value.zipCode,
      countryCode: shippingAddress.value.countryCode,
      phone: shippingAddress.value.phone,
      deliveryMethod: shippingMethod.value,
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
    if (isNaN(amountAda) || amountAda <= 0) {
      throw new Error(t('errors.invalidAmount'));
    }
    const amountEur = parseFloat(orderResponse.depositAmountEur || '0');

    paymentAmount.value = {
      eur: amountEur,
    };

    // Store additional payment info
    exchangeRate.value = orderResponse.exchangeRate || '';
    depositExpiresAt.value = orderResponse.depositExpiresAt || '';
    depositQrCode.value = orderResponse.depositQrCode || '';

    if (!paymentAddress.value || amountAda <= 0) {
      throw new Error(t('card.failedToGetPaymentDetails'));
    }

    if (!paymentAddress.value) {
      throw new Error(t('card.missingPaymentAddress'));
    }

    // Convert ADA to lovelace (6 decimal precision)
    // depositAmountAda comes as string like "47.99946773" with 8 decimals
    // ADA only supports 6 decimals, so we truncate to 6 and convert to integer lovelace
    const adaString = orderResponse.depositAmountAda || '0';
    const [integerPart = '0', decimalPart = ''] = adaString.split('.');
    // Take only first 6 decimal digits (ADA precision)
    const truncatedDecimal = decimalPart.substring(0, 6).padEnd(6, '0');
    const lovelaceAmount = BigInt(integerPart + truncatedDecimal) as Cardano.Lovelace;
    const outputs: Cardano.TxOut[] = [
      {
        address: paymentAddress.value as Cardano.PaymentAddress,
        value: {
          coins: lovelaceAmount,
          assets: new Map(),
        },
      },
    ];

    // Build the payment server-side via Nexus (unconditional), signing the returned CBOR directly.
    const request: BuildTxRequest = {
      outputs: outputs.map(txOutToNexusOutput),
      changeAddress: walletStore.loggedWallet.baseAddress,
      utxos: walletUtxosToNexusInputs(walletStore.utxos as Cardano.Utxo[], walletStore.collateral),
    };
    const { tx_cbor: txCbor } = await nexusTxApi.buildTransferTx(request, walletStore.loggedWallet.network);
    if (!txCbor) throw new Error('Nexus returned an empty transaction CBOR');

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
        privateKeyBytes: privateKeyBytes ? Array.from(privateKeyBytes) : undefined,
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

    snackbar.fireSuccess(t('wallet.txSubmittedSuccess', { txId: submitResult.data.txId }));

    await cardStore.fetchCardData();

    orderSuccess.value = true;
  } catch (error: any) {
    snackbar.setError(error?.message || t('card.failedToOrderCard') + ' ' + t('card.pleaseTryAgain'));
    currentStep.value = 4;
  } finally {
    isProcessing.value = false;
  }
};

const handleClose = () => {
  currentStep.value = 1;
  selectedCardType.value = null;
  shippingAddress.value = {
    streetAddress: '',
    city: '',
    stateProvince: '',
    zipCode: '',
    countryCode: '',
    phone: '',
  };
  shippingMethod.value = 'regular';
  paymentAmount.value = { eur: 0 };
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
    }
  }
);
</script>
<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

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
  align-content: center;
  padding: $spacing-lg 0;
}

.modal-actions {
  display: flex;
  gap: $spacing-md;
  padding: $spacing-lg 0;
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
  .modal-content {
    padding: $spacing-md 0;
  }

  .modal-actions {
    padding: $spacing-md 0;
    flex-direction: column;
  }

  .order-stepper {
    padding: 0 $spacing-md $spacing-md;
  }
}
</style>
