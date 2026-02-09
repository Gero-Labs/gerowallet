<template>
  <v-col cols="12" md="6" class="py-0 card-status-column" style="align-content: center; justify-items: center; min-height: 144px">
    <div class="balance-section" v-if="currentCardHasUUID">
      <div class="balance-container">
        <p class="balance-label">{{ $t('card.totalBalance') }}</p>
        <p class="balance-amount">
          {{
            currentCard?.cardBalance?.currentBalance?.amount
              ? formatCurrency(currentCard.cardBalance.currentBalance.amount)
              : '€0.00'
          }}
        </p>
        <p class="balance-conversion">
          ≈ {{ formatADA(currentCard?.cardBalance?.currentBalance?.amount || 0) }} ADA
        </p>

        <!-- Action Buttons -->
        <div class="balance-actions">
          <v-btn class="action-btn top-up-btn" variant="outlined" @click="$emit('top-up')">
            <img src="@/modules/wallet/icons/currency-euro.svg" :alt="String($t('card.topUp'))" class="btn-icon" />
            {{ $t('card.topUp') }}
          </v-btn>
          <v-btn
            class="action-btn eye-btn"
            variant="outlined"
            @click="$emit('toggle-card-visibility')"
          >
            <v-icon>{{ showCardDetails ? 'mdi-eye-off' : 'mdi-eye' }}</v-icon>
          </v-btn>
        </div>
      </div>
    </div>
    <!-- Waiting Status Card - Show when order is in progress -->
    <v-card
      v-else-if="cardsWithOrderSlot[currentCardIndex]?.cardData.id"
      outlined
      class="waiting-status-card mt-6"
    >
      <div class="status-card-gradient"></div>
      <v-card-text class="status-card-content">
        <div class="status-icon-wrapper">
          <v-progress-circular
            v-if="loadingOrderDetails"
            indeterminate
            size="24"
            width="2"
            color="primary"
            class="status-loading"
          ></v-progress-circular>
          <v-icon
            v-else
            class="status-icon"
            :class="{ 'rejection-icon': isRejectedOrExpired }"
          >
            {{ isRejectedOrExpired ? 'mdi-close-circle' : 'mdi-credit-card-clock-outline' }}
          </v-icon>
        </div>
        <div class="status-text-wrapper">
          <!-- Loading State -->
          <template v-if="loadingOrderDetails">
            <div class="status-title-wrapper">
              <p class="status-title">
                {{ $t('card.loadingCardStatus') }}
              </p>
            </div>
            <p class="status-subtitle">
              {{ $t('card.pleaseWait') }}
            </p>
          </template>
          <!-- Rejected or Expired Card Status -->
          <template v-else-if="isRejectedOrExpired">
            <div class="status-title-wrapper">
              <p class="status-title">
                {{ isCurrentCardExpired ? $t('card.paymentExpired') : $t('card.cardRejected') }}
              </p>
            </div>
            <p class="status-subtitle">
              {{ isCurrentCardExpired ? $t('card.orderNewCardToContinue') : $t('card.cardRejectedMessage') }}
            </p>
            <v-btn
              class="order-new-card-btn mt-4"
              @click="$emit('order-new-card-after-rejection')"
            >
              <v-icon left>mdi-credit-card-plus</v-icon>
              {{ $t('card.orderNewCard') }}
            </v-btn>
          </template>
          <!-- Pending Card Status -->
          <template v-else>
            <div class="status-title-wrapper">
              <p class="status-title">
                {{ currentCardType === 'physical' ? $t('card.physicalCardOrderInProgress') : $t('card.virtualCardOrderInProgress') }}
              </p>
            </div>
            <p class="status-subtitle">
              <template v-if="currentOrderNeedsPayment">
                <template v-if="!isPaymentStatusCompleted">
                  {{ $t('card.paymentReceived') }} <br />
                  {{ $t('card.waitingForOrderProcessing') }} <br />
                </template>
                <template v-else-if="isPaymentInProgress">
                  {{ $t('card.paymentInProgress') }} <br />
                  {{ $t('card.pleaseWaitForConfirmation') }}
                </template>
                <template v-else>
                  {{ $t('card.physicalCardPaymentRequired') }} <br />
                  {{ $t('card.completePaymentToProceed') }}
                </template>
              </template>
              <template v-else>
                {{ $t('card.cardOrderProcessing') }} <br />
              </template>
            </p>
          </template>
        </div>
      </v-card-text>
    </v-card>
    <div v-if="shouldShowOrderCardSection" class="order-card-section mt-10">
      <h2 class="order-title">{{ $t('card.getYourGeroCard') }}</h2>
      <p class="order-description">{{ $t('card.spendCryptoAnywhere') }}</p>

      <!-- Promo and Button Row -->
      <div class="promo-button-row">
        <!-- Promo Section -->
        <div class="promo-section">
          <p
            class="promo-title"
            @click="$emit('show-promotion-modal')"
            @keydown.enter="$emit('show-promotion-modal')"
            @keydown.space.prevent="$emit('show-promotion-modal')"
            role="button"
            tabindex="0"
            aria-label="View promotional details and fee information"
          >
            <span class="clickable-text">{{ $t('card.enjoyZeroFeesUntil') }}</span>
            <v-icon small class="info-icon">mdi-information-outline</v-icon>
          </p>
          <div class="promo-features">
            <div class="promo-item">
              <v-icon class="promo-icon">mdi-check-circle</v-icon>
              <span class="promo-text">{{ $t('card.zeroMonthlyFees') }}</span>
            </div>
            <div class="promo-item">
              <v-icon class="promo-icon">mdi-check-circle</v-icon>
              <span class="promo-text">{{ $t('card.zeroAdaEurFees') }}</span>
            </div>
          </div>
        </div>

        <!-- Button -->
        <v-btn
          class="order-card-btn"
          large
          :loading="orderingCard"
          @click="$emit('open-order-card-flow')"
        >
          <v-icon left>mdi-credit-card-plus</v-icon>
          {{ $t('card.orderNewCard') }}
        </v-btn>
      </div>
    </div>
  </v-col>
</template>

<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { CardInfo } from '@/models/card';
import cardStoreModule from '@/stores/modules/card';
import { walletStore } from '@/stores/walletStore';

const { transactions } = toRefs(walletStore);

interface Props {
  cards: CardInfo[];
  currentCardIndex: number;
  cardsWithOrderSlot: CardInfo[];
  currentCardHasUUID: boolean;
  currentCardType: string;
  currentCardStatus?: string | null;
  isCurrentCardRejected: boolean;
  shouldShowOrderCardSection: boolean;
  showOrderTimer: boolean;
  timerDisplay: string;
  loadingOrderDetails: boolean;
  orderingCard: boolean;
  showCardDetails: boolean;
  exchangeRate: number;
  paymentDetailsCache: Record<string, { expires_at?: string; status?: string }>;
}

interface Emits {
  (e: 'top-up'): void;
  (e: 'toggle-card-visibility'): void;
  (e: 'order-new-card-after-rejection'): void;
  (e: 'complete-payment'): void;
  (e: 'open-order-card-flow'): void;
  (e: 'show-promotion-modal'): void;
  (e: 'update:timerDisplay', value: string): void;
}

const props = withDefaults(defineProps<Props>(), {
  currentCardStatus: null,
});
defineEmits<Emits>();

const currentCardIndex = computed(() => cardStoreModule.state.currentCardIndex);

const currentCard = computed(() => {
  return props.cardsWithOrderSlot[currentCardIndex.value];
});

const isPaymentStatusCompleted = computed(() => {
  if (!currentCard.value?.cardData?.order_uuid) return false;
  const paymentDetails = props.paymentDetailsCache[currentCard.value.cardData.order_uuid];
  return paymentDetails?.status === 'completed';
});

const isPaymentInProgress = computed(() => {
  const depositAddress = currentCard.value?.cardData?.delivery?.deposit_address;
  let adaAmount = currentCard.value?.cardData?.delivery?.deposit_amount_ada;
  const [integerPart = '0', decimalPart = ''] = adaAmount.split('.');
  // Take only first 6 decimal digits (ADA precision)
  const truncatedDecimal = decimalPart.substring(0, 6).padEnd(6, '0');
  adaAmount = integerPart + truncatedDecimal
  return transactions.value.some(tx => tx.body.outputs.some(output => output.address === depositAddress && output.value.coins === adaAmount));
})

const isCurrentCardExpired = computed(() => {
  return props.currentCardStatus === 'expired';
});

const isRejectedOrExpired = computed(() => {
  return props.isCurrentCardRejected || isCurrentCardExpired.value;
});

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(amount);
};

const formatADA = (eurAmount: number) => {
  const adaAmount = eurAmount / props.exchangeRate;
  return adaAmount.toFixed(2);
};

const currentOrderNeedsPayment = computed(() => {
  return !!(
    currentCard?.value.cardData?.id &&
    currentCard?.value.cardData?.order_uuid &&
    !currentCard?.value.cardData?.card_uuid &&
    currentCard?.value.cardData?.own_type === 'physical'
  );
});
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.card-status-column {
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.payment-timer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(0, 199, 243, 0.1);
  border: 1px solid rgba(0, 199, 243, 0.3);
  border-radius: 8px;

  .timer-icon {
    color: $primary-cyan;
    font-size: 20px;
  }

  .timer-text {
    font-family: 'Courier New', monospace;
    font-size: $font-size-base;
    font-weight: $font-weight-semibold;
    letter-spacing: 0.05rem;
    color: $primary-cyan;
  }
}

.complete-payment-btn {
  :deep(.v-icon) {
    color: #0c0e12 !important;
  }
}

.balance-section {
  justify-self: center;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  flex-shrink: 0;
  min-width: 300px;

  .balance-container {
    align-self: center;
    text-align: center;
  }

  .balance-label {
    justify-self: center;
    font-family: $font-family-primary;
    font-size: $font-size-sm;
    font-weight: $font-weight-medium;
    color: $text-secondary;
    margin: 0 0 0.5rem 0;
    text-transform: uppercase;
    letter-spacing: 0.05rem;
  }

  .balance-amount {
    justify-self: center;
    font-family: $font-family-primary;
    font-size: $font-size-3xl;
    font-weight: $font-weight-bold;
    color: $text-primary;
    margin: 0 0 0.5rem 0;
  }

  .balance-conversion {
    justify-self: center;
    font-family: $font-family-primary;
    font-size: $font-size-base;
    font-weight: $font-weight-medium;
    color: $text-muted;
    margin: 0 0 $spacing-lg 0;
  }

  .balance-actions {
    display: flex;
    gap: $spacing-md;
    justify-content: center;
    align-items: center;
    flex-wrap: wrap;
  }

  .action-btn {
    font-family: $font-family-primary;
    font-weight: $font-weight-semibold;
    text-transform: none;
    border-radius: $border-radius-md;
    box-shadow: $shadow-button;

    &.top-up-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: $background-card;
      color: $text-primary;
      border: 1px solid $primary-cyan !important;

      &:hover {
        background: lighten($background-card, 5%);
      }

      &:focus {
        outline: none;
      }

      .btn-icon {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
        margin-right: 6px;
      }
    }

    &.eye-btn {
      background: $background-card;
      border: 1px solid $primary-cyan !important;
      color: $text-primary;

      &:hover {
        background: lighten($background-card, 5%);
      }

      &:focus {
        outline: none;
      }
    }
  }
}

.order-card-section {
  max-width: 600px;
  width: 100%;
  min-height: 180px;
  margin: 0 auto;
  text-align: center;
  padding: 24px;
  background: linear-gradient(135deg, rgba(12, 14, 18, 0.6) 0%, rgba(20, 24, 30, 0.6) 100%);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
  position: relative;
  overflow: hidden;
  box-sizing: border-box;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: linear-gradient(
      90deg,
      rgba(0, 199, 243, 0.8) 0%,
      rgba(0, 255, 209, 0.8) 50%,
      rgba(0, 199, 243, 0.8) 100%
    );
    background-size: 200% 100%;
    animation: gradientShift 3s ease infinite;
  }

  .order-title {
    font-family: $font-family-primary;
    font-size: 1.5rem;
    font-weight: $font-weight-bold;
    color: $text-primary;
    margin: 0 0 8px 0;
    letter-spacing: 0.02em;
    position: relative;
    z-index: 1;
  }

  .order-description {
    font-family: $font-family-primary;
    font-size: $font-size-sm;
    color: rgba($text-secondary, 0.9);
    line-height: 1.6;
    max-width: 500px;
    margin: 0 auto 16px;
    position: relative;
    z-index: 1;
  }

  .promo-button-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 32px;
    margin-top: 24px;
    position: relative;
    z-index: 1;
  }

  .promo-section {
    display: flex;
    flex-direction: column;
    align-items: center;

    .promo-title {
      font-family: $font-family-primary;
      font-size: $font-size-base;
      font-weight: $font-weight-semibold;
      color: $text-primary;
      text-align: center;
      margin: 0 0 12px 0;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;

      .clickable-text {
        color: $primary-cyan;
        border-bottom: 1px dotted $primary-cyan;
        transition: all 0.2s ease;
      }

      &:hover {
        .clickable-text {
          color: lighten($primary-cyan, 10%);
          border-bottom-color: lighten($primary-cyan, 10%);
        }

        .info-icon {
          color: lighten($primary-cyan, 10%);
        }
      }

      .info-icon {
        color: $primary-cyan;
        transition: all 0.2s ease;
      }
    }

    .promo-features {
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: flex-start;
    }

    .promo-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .promo-icon {
      font-size: 16px;
      color: rgba(0, 199, 243, 0.7);
    }

    .promo-text {
      font-family: $font-family-primary;
      font-size: $font-size-sm;
      color: $text-secondary;
    }
  }

  .order-card-btn {
    background: linear-gradient(135deg, #00c7f3 0%, #00ffd1 100%) !important;
    color: #0c0e12 !important;
    font-family: $font-family-primary;
    font-size: $font-size-base;
    font-weight: $font-weight-bold;
    text-transform: none;
    letter-spacing: 0.02em;
    border-radius: 12px;
    padding: 10px 24px !important;
    height: auto !important;
    min-height: 44px;
    box-shadow: 0 4px 16px rgba(0, 199, 243, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2);
    transition: all 0.3s ease;
    position: relative;
    z-index: 1;

    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 24px rgba(0, 199, 243, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3);
    }

    &:active {
      transform: translateY(0);
    }

    :deep(.v-icon) {
      color: #0c0e12 !important;
    }
  }
}

.waiting-status-card {
  max-width: 600px;
  width: 100%;
  margin: 0 auto;
  position: relative;
  background: linear-gradient(135deg, rgba(12, 14, 18, 0.6) 0%, rgba(20, 24, 30, 0.6) 100%);
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 16px;
  backdrop-filter: blur(10px);
  overflow: hidden;
  box-sizing: border-box;

  .status-card-gradient {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: linear-gradient(
      90deg,
      rgba(0, 199, 243, 0.8) 0%,
      rgba(0, 255, 209, 0.8) 50%,
      rgba(0, 199, 243, 0.8) 100%
    );
    background-size: 200% 100%;
    animation: gradientShift 3s ease infinite;
  }

  .status-card-content {
    display: flex;
    gap: 24px;
    align-items: center;
    padding: 32px 24px !important;
    position: relative;
    z-index: 1;
    min-height: 132px;
  }

  .status-icon-wrapper {
    position: relative;
    flex-shrink: 0;
    width: 56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, rgba(0, 199, 243, 0.15) 0%, rgba(0, 255, 209, 0.1) 100%);
    border-radius: 12px;
    border: 1px solid rgba(0, 199, 243, 0.2);

    .status-icon {
      font-size: 28px !important;
      color: $primary-cyan;
      animation: pulse 2s ease-in-out infinite;
    }

    .status-loading {
      color: $primary-cyan !important;
    }
  }

  .status-text-wrapper {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .status-title-wrapper {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }

  .status-title {
    font-family: $font-family-primary;
    font-size: 1.5rem;
    font-weight: $font-weight-bold;
    color: $text-primary;
    margin: 0 !important;
    letter-spacing: 0.02em;
  }

  .status-subtitle {
    font-family: $font-family-primary;
    font-size: $font-size-sm;
    color: rgba($text-secondary, 0.9);
    line-height: 1.6;
    margin: 0 !important;
  }

  .complete-payment-btn {
    background: linear-gradient(135deg, #00c7f3 0%, #00ffd1 100%) !important;
    color: #0c0e12 !important;
    font-family: $font-family-primary;
    font-size: $font-size-sm;
    font-weight: $font-weight-bold;
  }

  .order-new-card-btn {
    background: linear-gradient(135deg, #00c7f3 0%, #00ffd1 100%) !important;
    color: #0c0e12 !important;
    font-family: $font-family-primary;
    font-size: $font-size-sm;
    font-weight: $font-weight-bold;
    text-transform: none;
    border-radius: 8px;
    padding: 8px 20px !important;
    height: auto !important;
    min-height: 40px;
    box-shadow: 0 4px 12px rgba(0, 199, 243, 0.3);
    transition: all 0.3s ease;

    &:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 6px 18px rgba(0, 199, 243, 0.4);
    }

    &:active {
      transform: translateY(0);
    }

    &.v-btn--disabled,
    &:disabled {
      opacity: 0.4 !important;
      background: #2a2f3a none !important;
      color: #888 !important;
      box-shadow: none !important;
      filter: grayscale(1) !important;
      pointer-events: none !important;
      cursor: not-allowed !important;

      :deep(.v-icon) {
        color: #888 !important;
      }
    }

    :deep(.v-icon) {
      color: #0c0e12 !important;
    }
  }

  .acknowledgment-section {
    margin-top: $spacing-md;
  }

  .acknowledgment-checkbox {
    :deep(.v-input__control) {
      .v-input__slot {
        .v-input--selection-controls__input {
          .v-icon {
            color: $primary-cyan;
          }
        }
      }
    }

    :deep(.v-label) {
      color: $text-secondary;
      font-size: $font-size-sm;
    }
  }

  .rejection-icon {
    color: #f44336 !important;
  }
}

@keyframes gradientShift {
  0%,
  100% {
    background-position: 0 50%;
  }
  50% {
    background-position: 100% 50%;
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.7;
    transform: scale(0.95);
  }
}

@media (max-width: $breakpoint-md) {
  .order-card-section {
    padding: 24px;

    .order-title {
      font-size: 1.5rem;
    }

    .order-description {
      font-size: $font-size-sm;
    }
  }
}

@media (max-width: 425px) {
  .order-card-section {
    padding: 20px;

    .order-title {
      font-size: 1.25rem;
    }

    .order-description {
      font-size: 0.875rem;
      margin-bottom: 24px;
    }

    .order-card-btn {
      width: 100%;
    }
  }
}
</style>
