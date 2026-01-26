<template>
  <v-dialog v-model="dialog" max-width="600" persistent content-class="pay-order-modal">
    <v-card class="modal-card">
      <!-- Header -->
      <div class="modal-header">
        <div class="header-content">
          <h2 class="modal-title">{{ $t('card.completePayment') }}</h2>
          <p class="modal-subtitle">{{ $t('card.paymentRequired') }}</p>
        </div>
        <v-btn icon class="close-btn" @click="handleClose" :disabled="isProcessing">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </div>

      <!-- Step Content -->
      <div class="modal-content">
        <!-- Payment Step -->
        <CardOrderPaymentStep
          v-if="!orderSuccess"
          :amount-ada="paymentAmount.ada"
          :amount-eur="paymentAmount.eur"
          :exchange-rate="orderResponse ? parseFloat(String(orderResponse.exchangeRate)) : undefined"
          @back="handleClose"
          @confirm="handlePaymentConfirm"
        />

        <!-- Success State -->
        <PaymentConfirmationStep
          v-else
          :is-loading="isProcessing"
          :is-success="orderSuccess"
          @complete="handleOrderComplete"
        />
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useRouter } from 'vue-router/composables';
import CardOrderPaymentStep from './card-order-steps/CardOrderPaymentStep.vue';
import PaymentConfirmationStep from './card-order-steps/PaymentConfirmationStep.vue';
import cardStore from '@/stores/modules/card';
import snackbar from '@/plugins/snackbar';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { Cardano } from '@cardano-sdk/core';
import { serializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { buildCardanoTransaction } from '@/shared/utils/builder';

const { t } = useTranslation();
const router = useRouter();

interface Props {
  open: boolean;
  orderUuid: string;
}

interface Emits {
  (e: 'close'): void;
  (e: 'success'): void;
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

// Payment
const paymentAmount = ref({
  ada: 0,
  eur: 0,
});

// Order response data
const orderResponse = ref<{
  paymentId: number;
  depositAddress: string;
  depositAmountEur: string | number;
  depositAmountAda: string | number;
  exchangeRate: string | number;
  depositExpiresAt: string;
  depositQrCode: string;
  orderUuid?: string;
  paymentStatus?: string;
} | null>(null);

// Processing states
const isProcessing = ref(false);
const orderSuccess = ref(false);

// Load order details when modal opens
watch(
  () => props.open,
  async newVal => {
    if (newVal && props.orderUuid) {
      await loadOrderDetails();
    } else {
      orderSuccess.value = false;
      isProcessing.value = false;
    }
  }
);

const loadOrderDetails = async () => {
  try {
    isProcessing.value = true;
    
    // First, try to get delivery info from current card data
    const cards = cardStore.state.cards || [];
    const cardWithOrder = cards.find(c => c.cardData?.order_uuid === props.orderUuid);
    
    if (cardWithOrder?.cardData && (cardWithOrder.cardData as any).delivery) {
      // Use delivery object from card data
      const delivery = (cardWithOrder.cardData as any).delivery;
      orderResponse.value = {
        paymentId: delivery.payment_id || 0,
        depositAddress: delivery.deposit_address || '',
        depositAmountEur: delivery.deposit_amount_eur || '0',
        depositAmountAda: delivery.deposit_amount_ada || '0',
        exchangeRate: delivery.deposit_exchange_rate || '0',
        depositExpiresAt: delivery.deposit_expires_at || '',
        depositQrCode: delivery.deposit_qr_code || '',
        orderUuid: props.orderUuid,
        paymentStatus: delivery.payment_status || 'pending',
      };
      
      paymentAmount.value = {
        ada: parseFloat(String(delivery.deposit_amount_ada)) || 0,
        eur: parseFloat(String(delivery.deposit_amount_eur)) || 0,
      };
    } else {
      // Use new delivery-payment API endpoint
      const paymentDetails = await cardStore.getDeliveryPayment(props.orderUuid);
      
      if (!paymentDetails) {
        throw new Error(t('card.failedToLoadOrderDetails'));
      }
      
      // Convert snake_case to camelCase for compatibility
      orderResponse.value = {
        paymentId: paymentDetails.payment_id || 0,
        depositAddress: paymentDetails.deposit_address || '',
        depositAmountEur: String(paymentDetails.amount_eur || 0),
        depositAmountAda: String(paymentDetails.amount_ada || 0),
        exchangeRate: String(paymentDetails.exchange_rate || 0),
        depositExpiresAt: paymentDetails.expires_at || '',
        depositQrCode: paymentDetails.qr_code_data || '',
        orderUuid: props.orderUuid,
        paymentStatus: paymentDetails.status || 'pending',
      };
      
      paymentAmount.value = {
        ada: parseFloat(String(paymentDetails.amount_ada)) || 0,
        eur: parseFloat(String(paymentDetails.amount_eur)) || 0,
      };
    }
  } catch (error: any) {
    snackbar.setError(error?.message || t('card.failedToLoadOrderDetails'));
    handleClose();
  } finally {
    isProcessing.value = false;
  }
};

const handlePaymentConfirm = async (spendingPassword: string) => {
  isProcessing.value = true;

  try {
    if (!orderResponse.value) {
      throw new Error(t('errors.invalidOrder'));
    }

    const cardanoAddress = orderResponse.value.depositAddress;
    const adaAmount = parseFloat(String(orderResponse.value.depositAmountAda));

    if (!cardanoAddress || isNaN(adaAmount) || adaAmount <= 0) {
      throw new Error(t('errors.invalidPaymentDetails'));
    }

    const lovelaceAmount = BigInt(Math.floor(adaAmount * 1_000_000)) as Cardano.Lovelace;

    const outputs: Cardano.TxOut[] = [
      {
        address: cardanoAddress as Cardano.PaymentAddress,
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

    // Refresh card data to get updated order info
    await cardStore.fetchCardData();

    // Start polling for card UUID (with 1 hour timeout)
    if (props.orderUuid) {
      try {
        const cardUuid = await cardStore.pollForCardUuid(
          props.orderUuid,
          3600000, // 1 hour timeout
          10000, // 10 seconds interval
          (elapsedMs, timeoutMs) => {
            // Progress callback - can be used for UI updates if needed
          }
        );

        if (cardUuid) {
          // Card UUID found, check card state
          const cardState = await cardStore.getCardState(cardUuid);
          if (cardState?.status) {
            // Status will be stored in card data after fetchCardData
          }
          
          // Refresh card data to get the new card with UUID
          await cardStore.fetchCardData();
        }
      } catch (error) {
        // Polling failed, but order was successful
      }
    }

    orderSuccess.value = true;
    emit('success');
  } catch (error: any) {
    snackbar.setError(error?.message || t('card.failedToOrderCard') + ' ' + t('card.pleaseTryAgain'));
  } finally {
    isProcessing.value = false;
  }
};

const handleOrderComplete = () => {
  handleClose();
  router.push('/card');
};

const handleClose = () => {
  orderResponse.value = null;
  isProcessing.value = false;
  orderSuccess.value = false;
  paymentAmount.value = { ada: 0, eur: 0 };
  emit('close');
};
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.pay-order-modal {
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

.modal-content {
  padding: 0 $spacing-3xl $spacing-3xl;
}

@media (max-width: $breakpoint-sm) {
  .modal-header {
    padding: $spacing-2xl $spacing-2xl $spacing-md;
  }

  .modal-content {
    padding: 0 $spacing-2xl $spacing-2xl;
  }
}
</style>
