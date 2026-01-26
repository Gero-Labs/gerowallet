<template>
  <div class="hero-section">
    <!-- Card Carousel and Balance Section -->
    <v-card flat class="transparent">
      <v-row>
        <v-col cols="12" md="6" class="py-0" style="align-content: center; justify-items: center">
          <div class="card-carousel">
            <v-window v-model="currentCardIndex" :show-arrows="cardsWithOrderSlot.length > 1" continuous>
              <v-window-item
                v-for="(card, index) in cardsWithOrderSlot"
                :key="card.cardData?.card_uuid || card.cardData?.order_uuid || `empty-${index}`"
                style="height: 280px"
              >
                <div
                  class="credit-card"
                  @mousemove="handleCardMouseMove"
                  @mouseleave="handleCardMouseLeave"
                  @click="currentCardHasUUID && (showManageCardConfirmationModal = true)"
                  :style="cardTiltStyle"
                >
                  <!-- Shine effect -->
                  <div class="card-shine" :style="cardShineStyle"></div>

                  <!-- Card Number -->
                  <p class="card-number">
                    {{ getFormattedCardNumber(card) }}
                  </p>

                  <!-- Card Bottom Info -->
                  <div class="card-bottom" style="max-width: 310px">
                    <div class="card-holder">
                      <p class="label">{{ t('card.cardholderName') }}</p>
                      <p class="value">{{ card.cardData.card_holder_name || t('card.geroWallet') }}</p>
                    </div>
                    <div class="card-cvv">
                      <p class="label">{{ t('card.cvv') }}</p>
                      <p class="value">
                        {{ showCardDetails && card.cardDetails?.cvc2 ? card.cardDetails.cvc2 : '***' }}
                      </p>
                    </div>
                    <div class="card-expiry">
                      <p class="label">{{ t('card.exp') }}</p>
                      <p class="value">{{ formatExpiryDate(card) }}</p>
                    </div>
                  </div>
                </div>
              </v-window-item>
            </v-window>
            <!-- Status Chip under the card -->
            <div class="card-status-chip-container">
              <v-chip v-if="currentCardHasUUID" class="card-status-chip active-chip" small>
                <v-icon small left>mdi-check-circle</v-icon>
                {{ t('card.active') }}
              </v-chip>
              <v-chip
                v-else-if="currentCardStatus === 'rejected'"
                class="card-status-chip rejected-chip"
                small
              >
                <v-icon small left>mdi-close-circle</v-icon>
                {{ t('card.rejected') }}
              </v-chip>
              <v-chip
                v-else-if="cardsWithOrderSlot[currentCardIndex]?.cardData.id"
                class="card-status-chip pending-chip"
                small
              >
                <v-icon small left>mdi-clock-outline</v-icon>
                {{ t('card.pending') }}
              </v-chip>
            </div>
          </div>
        </v-col>

        <!-- Order Card Section - Show when ready to order -->
        <v-col cols="12" md="6" class="py-0 card-status-column" style="align-content: center; justify-items: center">
          <div class="balance-section" v-if="currentCardHasUUID">
            <div class="balance-container">
              <p class="balance-label">{{ t('card.totalBalance') }}</p>
              <p class="balance-amount">
                {{
                  cards[currentCardIndex]?.cardBalance?.currentBalance?.amount
                    ? formatCurrency(cards[currentCardIndex].cardBalance.currentBalance.amount)
                    : '€0.00'
                }}
              </p>
              <p class="balance-conversion">
                ≈ {{ formatADA(cards[currentCardIndex]?.cardBalance?.currentBalance?.amount || 0) }} ADA
              </p>

              <!-- Action Buttons -->
              <div class="balance-actions">
                <v-btn class="action-btn top-up-btn" variant="outlined" @click="handleTopUp">
                  <img src="@/modules/wallet/icons/currency-euro.svg" :alt="t('card.topUp')" class="btn-icon" />
                  {{ t('card.topUp') }}
                </v-btn>
<!--                <v-btn-->
<!--                  class="action-btn order-physical-btn"-->
<!--                  variant="outlined"-->
<!--                  @click="showOrderPhysicalCardModal = true"-->
<!--                >-->
<!--                  <v-icon left>mdi-credit-card-outline</v-icon>-->
<!--                  {{ t('card.orderPhysicalCard') }}-->
<!--                </v-btn>-->
                <v-btn
                  class="action-btn eye-btn"
                  variant="outlined"
                  @click="showCardDetails ? (showCardDetails = false) : (showConfirmationModal = true)"
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
                <v-icon 
                  class="status-icon"
                  :class="{ 'rejection-icon': isCurrentCardRejected }"
                >
                  {{ isCurrentCardRejected ? 'mdi-close-circle' : 'mdi-credit-card-clock-outline' }}
                </v-icon>
              </div>
              <div class="status-text-wrapper">
                <!-- Rejected Card Status -->
                <template v-if="isCurrentCardRejected">
                  <div class="status-title-wrapper">
                    <p class="status-title">
                      {{ t('card.cardRejected') }}
                    </p>
                  </div>
                  <p class="status-subtitle">
                    {{ t('card.cardRejectedMessage') }}
                  </p>
                  <!-- Acknowledgment Checkbox -->
                  <div class="acknowledgment-section mt-4">
                    <v-checkbox
                      v-model="rejectionAcknowledged"
                      :label="$t('card.iHaveReadRejectionMessage')"
                      hide-details
                      class="acknowledgment-checkbox"
                    />
                  </div>
                  <!-- Order New Card Button -->
                  <v-btn
                    class="order-new-card-btn mt-4"
                    @click="handleOrderNewCardAfterRejection"
                    :disabled="!rejectionAcknowledged"
                  >
                    <v-icon left>mdi-credit-card-plus</v-icon>
                    {{ t('card.orderNewCard') }}
                  </v-btn>
                </template>
                <!-- Pending Card Status -->
                <template v-else>
                  <div class="status-title-wrapper">
                    <p class="status-title">
                      {{ currentCardType === 'physical' ? t('card.physicalCardOrderInProgress') : t('card.virtualCardOrderInProgress') }}
                    </p>
                  </div>
                  <p class="status-subtitle">
                    <template v-if="currentOrderNeedsPayment">
                      {{ t('card.physicalCardPaymentRequired') }} <br />
                      {{ t('card.completePaymentToProceed') }}
                    </template>
                    <template v-else>
                      {{ t('card.cardOrderProcessing') }} <br />
                      {{ t('card.processingTime') }}
                    </template>
                  </p>
                  <!-- Payment Button - Show if order needs payment (physical cards only) -->
                  <v-btn
                    v-if="currentOrderNeedsPayment"
                    class="complete-payment-btn mt-4"
                    @click="openPaymentModal"
                    :loading="loadingOrderDetails"
                    :disabled="showOrderTimer && timerDisplay"
                  >
                    <template v-if="showOrderTimer && timerDisplay">
                      <v-icon left>mdi-timer-outline</v-icon>
                      <span class="timer-in-button">{{ timerDisplay }}</span>
                    </template>
                    <template v-else>
                      <v-icon left>mdi-credit-card-outline</v-icon>
                      {{ t('card.completePayment') }}
                    </template>
                  </v-btn>
                </template>
              </div>
            </v-card-text>
          </v-card>
          <div v-else class="order-card-section mt-10">
            <h2 class="order-title">{{ t('card.getYourGeroCard') }}</h2>
            <p class="order-description">{{ t('card.spendCryptoAnywhere') }}</p>

            <!-- Promo and Button Row -->
            <div class="promo-button-row">
              <!-- Promo Section -->
              <div class="promo-section">
                <p
                  class="promo-title"
                  @click="showPromotionModal = true"
                  @keydown.enter="showPromotionModal = true"
                  @keydown.space.prevent="showPromotionModal = true"
                  role="button"
                  tabindex="0"
                  aria-label="View promotional details and fee information"
                >
                  <span class="clickable-text">{{ t('card.enjoyZeroFeesUntil') }}</span>
                  <v-icon small class="info-icon">mdi-information-outline</v-icon>
                </p>
                <div class="promo-features">
                  <div class="promo-item">
                    <v-icon class="promo-icon">mdi-check-circle</v-icon>
                    <span class="promo-text">{{ t('card.zeroMonthlyFees') }}</span>
                  </div>
                  <div class="promo-item">
                    <v-icon class="promo-icon">mdi-check-circle</v-icon>
                    <span class="promo-text">{{ t('card.zeroAdaEurFees') }}</span>
                  </div>
                </div>
              </div>

              <!-- Button -->
              <v-btn
                class="order-card-btn"
                large
                :loading="orderingCard"
                @click="showOrderCardFlowModal = true"
              >
                <v-icon left>mdi-credit-card-plus</v-icon>
                {{ t('card.orderNewCard') }}
              </v-btn>
            </div>
          </div>
        </v-col>
      </v-row>
    </v-card>

    <!-- Modals -->
    <ManageCardModal :open="showManageCardModal" @close="handleManageCardClose" />
    <TopUpModal :open="showTopUpModal" @close="handleTopUpClose" />
    <PromotionModal :open="showPromotionModal" @close="showPromotionModal = false" />
    <OrderPhysicalCardModal :open="showOrderPhysicalCardModal" @close="handleOrderPhysicalCardClose" />
    <OrderCardFlowModal
      :open="showOrderCardFlowModal"
      :has-virtual-card="hasVirtualCard"
      :has-physical-card="hasPhysicalCard"
      @close="handleOrderCardFlowClose"
    />
    <PayOrderModal
      v-if="pendingOrderUuid"
      :open="showPayOrderModal"
      :order-uuid="pendingOrderUuid"
      @close="showPayOrderModal = false"
      @success="handlePaymentSuccess"
    />

    <!-- Confirmation Modal -->
    <ConfirmationPasswordModal
      :open="showConfirmationModal"
      @close="showConfirmationModal = false"
      @confirm="toggleCardVisibility"
      :title="t('card.viewCardDetails')"
      :subtitle="t('card.viewCardDetailsSubtitle')"
    />
    <!-- Confirmation Modal Manage Card-->
    <ConfirmationPasswordModal
      :open="showManageCardConfirmationModal"
      @close="showManageCardConfirmationModal = false"
      @confirm="showManageCardModal = true"
      :title="t('card.manageCard')"
      :subtitle="t('card.manageCardSubtitle')"
    />
    <!-- Confirmation Modal Order Card-->
    <ConfirmationPasswordModal
      :open="showOrderCardConfirmationModal"
      @close="showOrderCardConfirmationModal = false"
      @confirm="handleOrderCard"
      :title="t('card.orderCardConfirmTitle')"
      :subtitle="t('card.orderCardConfirmSubtitle')"
    />
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, watch, onUnmounted } from 'vue';
import ManageCardModal from './dashboard/ManageCardModal.vue';
import TopUpModal from './dashboard/TopUpModal.vue';
import PromotionModal from './PromotionModal.vue';
import OrderPhysicalCardModal from './dashboard/OrderPhysicalCardModal.vue';
import OrderCardFlowModal from './dashboard/OrderCardFlowModal.vue';
import PayOrderModal from './dashboard/PayOrderModal.vue';
import cardStoreModule from '@/stores/modules/card';
import ConfirmationPasswordModal from './dashboard/ConfirmationPasswordModal.vue';
import snackbar from '@/plugins/snackbar';
import { CardInfo } from '@/models/card';

const { t } = useTranslation();

const currentCardIndex = ref(0);
const cardTiltStyle = ref<any>({});
const cardShineStyle = ref<any>({});
const showCardDetails = ref(false);
const showManageCardModal = ref(false);
const showTopUpModal = ref(false);
const showPromotionModal = ref(false);
const showConfirmationModal = ref(false);
const showManageCardConfirmationModal = ref(false);
const showOrderCardConfirmationModal = ref(false);
const showOrderPhysicalCardModal = ref(false);
const showOrderCardFlowModal = ref(false);
const showPayOrderModal = ref(false);
const orderingCard = ref(false);
const loadingOrderDetails = ref(false);
const pendingOrderUuid = ref<string | null>(null);
const hiddenOrderUuids = ref<string[]>([]);
const orderStatuses = ref<Record<string, string>>({});
const timerDisplay = ref('');
const rejectionAcknowledged = ref(false);
let timerInterval: ReturnType<typeof setInterval> | null = null;
const emptyCard: CardInfo = {
  cardData: {
    id: null,
    user_id: null,
    program_uuid: null,
    currency: null,
    account_to_charge: null,
    processing_type: null,
    cardholder_phone: null,
    payment_card_type: null,
    own_type: null,
    card_holder_name: null,
    order_uuid: null,
    card_uuid: null,
    status: null,
    card_status: null,
    balance: null,
    pan: null,
    currentBalance: null,
    created_at: null,
    updated_at: null,
  },
  cardDetails: {
    pan: null,
    cvc2: null,
    expiryDate: null,
    cardHolderName: null,
  },
  cardPin: null,
  cardNumber: null,
  cardBalance: {
    currentBalance:{
      amount:0,
      currencyCode:"EUR"
    },
    state: null
  },
  cardHistory: null,
  totalDeposits: 0,
  activities: [],
};
// Get cards from the real card store
const cards = computed(() => {
  return cardStoreModule.state.cards || [];
});

const hasVirtualCard = computed(() => {
  return cards.value.some(card =>
    card.cardData?.own_type === 'virtual' &&
    (card.cardData?.card_uuid || card.cardData?.order_uuid)
  );
});

const hasPhysicalCard = computed(() => {
  return cards.value.some(card =>
    card.cardData?.own_type === 'physical' &&
    (card.cardData?.card_uuid || card.cardData?.order_uuid)
  );
});

const canOrderNewCard = computed(() => {
  return !hasVirtualCard.value || !hasPhysicalCard.value;
});

const cardsWithOrderSlot = computed(() => {
  if (cards.value.length === 0) {
    return [emptyCard];
  } else if (canOrderNewCard.value) {
    return [...cards.value, emptyCard];
  } else {
    return cards.value;
  }
});

const handleOrderCard = async () => {
  try {
    orderingCard.value = true;
    showOrderCardConfirmationModal.value = false;
    await cardStoreModule.orderCard();
    await cardStoreModule.fetchCardData();

    // Show success message
    snackbar.fireSuccess(t('card.cardOrderedSuccess'));
  } catch (error: any) {
    let errorReason: string;

    // Check if error.response.data is a string (direct error message)
    if (typeof error?.response?.data === 'string' && error.response.data) {
      errorReason = '<b>' + t('card.failedToOrderCard') + '</b><br>' + error.response.data;
    }
    // Otherwise check for object-based error formats
    else {
      errorReason =
        t('card.failedToOrderCard') +
        ' ' +
        (error?.response?.data?.error?.message || // Laravel-style error object
          error?.response?.data?.error || // Direct error string in error field
          error?.response?.data?.reason || // Custom reason field
          error?.response?.data?.message || // Standard message field
          error?.message || // Axios error message
          t('card.pleaseTryAgain')); // Fallback
    }

    // Show error message with reason
    snackbar.setError(errorReason);
  } finally {
    orderingCard.value = false;
  }
};
// Get exchange rate from store (fallback to mock rate if not available)
const exchangeRate = computed(() => {
  return cardStoreModule.state.exchangeRate?.sell ? parseFloat(cardStoreModule.state.exchangeRate.sell) : 0.35;
});

const currentCardHasUUID = computed(() => {
  return cardsWithOrderSlot.value[currentCardIndex.value]?.cardData.card_uuid !== null;
});

// Check if current order needs payment (physical card with order_uuid but no card_uuid)
const currentOrderNeedsPayment = computed(() => {
  const currentCard = cardsWithOrderSlot.value[currentCardIndex.value];
  return (
    currentCard?.cardData?.id &&
    currentCard?.cardData?.order_uuid &&
    !currentCard?.cardData?.card_uuid &&
    currentCard?.cardData?.own_type === 'physical' // Only physical cards need payment
  );
});

// Get current card type
const currentCardType = computed(() => {
  const currentCard = cardsWithOrderSlot.value[currentCardIndex.value];
  return currentCard?.cardData?.own_type || 'virtual';
});

// Get current card status
const currentCardStatus = computed(() => {
  const currentCard = cardsWithOrderSlot.value[currentCardIndex.value];
  if (!currentCard?.cardData?.order_uuid) return null;
  
  // Check if we have stored status for this order
  const orderUuid = currentCard.cardData.order_uuid;
  return orderStatuses.value[orderUuid] || currentCard.cardData.status || null;
});

// Check if current card is rejected
const isCurrentCardRejected = computed(() => {
  const status = currentCardStatus.value;
  return status === 'rejected' || status === 'REJECTED';
});

// Check if we should show order timer (pending physical card within 1 hour)
const showOrderTimer = computed(() => {
  const currentCard = cardsWithOrderSlot.value[currentCardIndex.value];
  if (!currentCard?.cardData?.id || currentCard?.cardData?.card_uuid) return false;
  if (currentCard?.cardData?.own_type !== 'physical') return false;
  if (!currentCard?.cardData?.created_at) return false;
  
  const createdAt = new Date(currentCard.cardData.created_at);
  const oneHourLater = new Date(createdAt.getTime() + 3600000); // 1 hour
  const now = new Date();
  
  return now < oneHourLater;
});

// Calculate timer display
const updateTimer = () => {
  const currentCard = cardsWithOrderSlot.value[currentCardIndex.value];
  if (!currentCard?.cardData?.created_at || !showOrderTimer.value) {
    timerDisplay.value = '';
    return;
  }
  
  const createdAt = new Date(currentCard.cardData.created_at);
  const oneHourLater = new Date(createdAt.getTime() + 3600000);
  const now = new Date();
  const remaining = oneHourLater.getTime() - now.getTime();
  
  if (remaining <= 0) {
    timerDisplay.value = '';
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    return;
  }
  
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  timerDisplay.value = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

// Watch for selected card changes and update current index
watch(
  () => cardStoreModule.state.selectedCardId,
  newCardId => {
    if (newCardId && cards.value.length > 0) {
      const index = cards.value.findIndex(c => c.cardData.card_uuid === newCardId);
      if (index >= 0) {
        currentCardIndex.value = index;
      }
    }
  },
  { immediate: true }
);

// Check current card status (for pending cards)
const checkCurrentCardStatus = async () => {
  const currentCard = cardsWithOrderSlot.value[currentCardIndex.value];
  if (!currentCard?.cardData?.order_uuid || currentCard?.cardData?.card_uuid) {
    return; // Not a pending card
  }
  
  if (hiddenOrderUuids.value.includes(currentCard.cardData.order_uuid)) {
    return; // Already hidden
  }
  
  try {
    const orderDetails = await cardStoreModule.getOrderDetails(currentCard.cardData.order_uuid);
    
    // Store order status
    if (orderDetails.status) {
      orderStatuses.value[currentCard.cardData.order_uuid] = orderDetails.status;
    }
    
    if (orderDetails.card_uuid) {
      // Card UUID found, now check card state
      const cardState = await cardStoreModule.getCardState(orderDetails.card_uuid);
      if (cardState?.status) {
        orderStatuses.value[currentCard.cardData.order_uuid] = cardState.status;
      }
      
      // Refresh card data to get the new card with UUID
      await cardStoreModule.fetchCardData();
    }
  } catch (error) {
    // Silent error handling
  }
};


// Update selected card when carousel index changes
watch(currentCardIndex, async (newIndex) => {
  const card = cardsWithOrderSlot.value[newIndex];
  if (card && card.cardData.card_uuid) {
    // Valid card with UUID - select it and fetch its data
    cardStoreModule.selectCard(card.cardData.card_uuid);
  } else {
    // Empty card slot (order card) or pending card without UUID - clear selection
    cardStoreModule.selectCard(null);
  }
  
  // Update timer when card changes
  updateTimer();
  
  // Check status for pending cards
  await checkCurrentCardStatus();
  
  // Reset acknowledgment when card changes
  rejectionAcknowledged.value = false;
});

// Handle order new card after rejection
const handleOrderNewCardAfterRejection = () => {
  if (rejectionAcknowledged.value) {
    showOrderCardFlowModal.value = true;
    rejectionAcknowledged.value = false;
  }
};

// Watch for timer updates
watch(showOrderTimer, (shouldShow) => {
  if (shouldShow) {
    updateTimer();
    if (timerInterval) {
      clearInterval(timerInterval);
    }
    timerInterval = setInterval(updateTimer, 1000);
  } else {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    timerDisplay.value = '';
  }
}, { immediate: true });

// Card visibility toggle
const toggleCardVisibility = async () => {
  try {
    await cardStoreModule.fetchCardDetails(cardStoreModule.state.selectedCardId);
    showCardDetails.value = !showCardDetails.value;
  } catch (error) {
    // Silent error handling
  }
};

// Top up handler
const handleTopUp = () => {
  showTopUpModal.value = true;
};

// Payment handler
const openPaymentModal = async () => {
  const currentCard = cardsWithOrderSlot.value[currentCardIndex.value];
  if (!currentCard?.cardData?.order_uuid) return;

  try {
    loadingOrderDetails.value = true;
    
    // Get delivery object from card data
    const delivery = (currentCard.cardData as any)?.delivery;
    
    if (delivery) {
      // Create new order using delivery data to get fresh payment details
      const payload = {
        address: delivery.address || '',
        region: delivery.region || '',
        city: delivery.city || '',
        zipCode: delivery.zip || '',
        countryCode: delivery.country_code || '',
        phone: delivery.phone || '',
        deliveryMethod: delivery.method || 'regular',
      };
      
      // Create order to get fresh payment details
      const orderResponse = await cardStoreModule.orderPhysicalCard(payload);
      
      if (orderResponse?.orderUuid) {
        // Store new order UUID
        pendingOrderUuid.value = orderResponse.orderUuid;
        
        // Refresh card data to get updated order info
        await cardStoreModule.fetchCardData();
        
        showPayOrderModal.value = true;
      } else {
        throw new Error(t('card.failedToGetPaymentDetails'));
      }
    } else {
      // Fallback: use existing order details if delivery not found
      const orderDetails = await cardStoreModule.getOrderDetails(currentCard.cardData.order_uuid);

      // Store order status
      if (orderDetails.status) {
        orderStatuses.value[currentCard.cardData.order_uuid] = orderDetails.status;
      }

      pendingOrderUuid.value = currentCard.cardData.order_uuid;
      showPayOrderModal.value = true;
    }
  } catch (error: any) {
    snackbar.setError(error?.message || t('card.failedToLoadOrderDetails'));

    if (currentCard.cardData.order_uuid && !hiddenOrderUuids.value.includes(currentCard.cardData.order_uuid)) {
      hiddenOrderUuids.value.push(currentCard.cardData.order_uuid);
    }
  } finally {
    loadingOrderDetails.value = false;
  }
};

const handleManageCardClose = async () => {
  showManageCardModal.value = false;
  await cardStoreModule.fetchCardData();
};

const handleTopUpClose = async () => {
  showTopUpModal.value = false;
  await cardStoreModule.fetchCardData();
};

const handleOrderCardFlowClose = async () => {
  showOrderCardFlowModal.value = false;
  await cardStoreModule.fetchCardData();
  checkPendingOrders();
};

const handleOrderPhysicalCardClose = async () => {
  showOrderPhysicalCardModal.value = false;
  await cardStoreModule.fetchCardData();
  checkPendingOrders();
};

const handlePaymentSuccess = async () => {
  await cardStoreModule.fetchCardData();
  showPayOrderModal.value = false;

  if (pendingOrderUuid.value && hiddenOrderUuids.value.includes(pendingOrderUuid.value)) {
    const index = hiddenOrderUuids.value.indexOf(pendingOrderUuid.value);
    hiddenOrderUuids.value.splice(index, 1);
  }

  checkPendingOrders();
};

// Check order status for pending cards
const checkPendingOrders = async () => {
  const pendingCards = cards.value.filter(
    card =>
      card.cardData?.id &&
      card.cardData?.order_uuid &&
      !card.cardData?.card_uuid &&
      !hiddenOrderUuids.value.includes(card.cardData.order_uuid)
  );

  for (const card of pendingCards) {
    try {
      loadingOrderDetails.value = true;
      const orderDetails = await cardStoreModule.getOrderDetails(card.cardData.order_uuid);

      // Store order status
      if (orderDetails.status) {
        orderStatuses.value[card.cardData.order_uuid] = orderDetails.status;
      }

      if (orderDetails.card_uuid) {
        // Card UUID found, now check card state
        const cardState = await cardStoreModule.getCardState(orderDetails.card_uuid);
        if (cardState?.status) {
          orderStatuses.value[card.cardData.order_uuid] = cardState.status;
        }
        
        await cardStoreModule.fetchCardData();

        if (card.cardData.order_uuid && hiddenOrderUuids.value.includes(card.cardData.order_uuid)) {
          const index = hiddenOrderUuids.value.indexOf(card.cardData.order_uuid);
          hiddenOrderUuids.value.splice(index, 1);
        }
        break;
      }
    } catch (error) {
      if (card.cardData.order_uuid && !hiddenOrderUuids.value.includes(card.cardData.order_uuid)) {
        hiddenOrderUuids.value.push(card.cardData.order_uuid);
      }
    } finally {
      loadingOrderDetails.value = false;
    }
  }
};

// Check pending orders on mount and periodically
let orderCheckInterval: ReturnType<typeof setInterval> | null = null;
const hasCheckedPendingOrders = ref(false);

const startOrderChecking = () => {
  if (orderCheckInterval) return; // Already checking

  // Check every 30 seconds if there are pending orders
  orderCheckInterval = setInterval(() => {
    if (cards.value.some(card => card.cardData?.order_uuid && !card.cardData?.card_uuid)) {
      checkPendingOrders();
    } else {
      if (orderCheckInterval) {
        clearInterval(orderCheckInterval);
        orderCheckInterval = null;
      }
    }
  }, 30000);
};

// Watch for cards changes to check pending orders
watch(
  () => cards.value,
  (newCards) => {
    if (hiddenOrderUuids.value.length > 0) {
      const existingOrderUuids = newCards
        .filter(c => c.cardData?.order_uuid)
        .map(c => c.cardData.order_uuid);

      hiddenOrderUuids.value = hiddenOrderUuids.value.filter(uuid =>
        existingOrderUuids.includes(uuid)
      );
    }

    if (newCards.length > 0 && !hasCheckedPendingOrders.value) {
      const hasPendingOrders = newCards.some(
        card => card.cardData?.order_uuid && !card.cardData?.card_uuid
      );

      if (hasPendingOrders) {
        hasCheckedPendingOrders.value = true;
        checkPendingOrders();
        startOrderChecking();
      }
    }
  },
  { immediate: true, deep: true }
);

onUnmounted(() => {
  if (orderCheckInterval) {
    clearInterval(orderCheckInterval);
    orderCheckInterval = null;
  }
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
});

// 3D Card tilt effect with shine and dynamic glow
const handleCardMouseMove = (event: MouseEvent) => {
  const card = event.currentTarget as HTMLElement;
  const rect = card.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const centerX = rect.width / 2;
  const centerY = rect.height / 2;

  const rotateX = (y - centerY) / 20;
  const rotateY = (centerX - x) / 20;

  // Calculate shine position based on mouse
  const percentX = (x / rect.width) * 100;
  const percentY = (y / rect.height) * 100;

  // Calculate glow offset based on tilt
  const glowOffsetX = rotateY * 2; // Horizontal shift
  const glowOffsetY = -rotateX * 2; // Vertical shift (inverted)

  cardTiltStyle.value = {
    transform: `scale(0.7) perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(5px)`,
    transition: 'transform 0.1s ease-out',
    boxShadow: `
      0 10px 30px rgba(0, 0, 0, 0.3),
      ${glowOffsetX}px ${glowOffsetY}px 120px rgba(0, 200, 200, 0.12),
      ${glowOffsetX * 0.5}px ${glowOffsetY * 0.5}px 60px rgba(0, 200, 200, 0.08)
    `,
  };

  cardShineStyle.value = {
    background: `
      radial-gradient(circle at ${percentX}% ${percentY}%, rgba(255, 255, 255, 0.08) 0%, transparent 50%),
      linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, transparent 50%, rgba(255, 255, 255, 0.02) 100%)
    `,
    opacity: 1,
  };
};

const handleCardMouseLeave = () => {
  cardTiltStyle.value = {
    transform: 'scale(0.7) perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0px)',
    transition: 'transform 0.3s ease-out',
    boxShadow: `
      0 10px 30px rgba(0, 0, 0, 0.3),
      0 0 120px rgba(0, 200, 200, 0.12),
      0 0 60px rgba(0, 200, 200, 0.08)
    `,
  };

  cardShineStyle.value = {
    opacity: 0,
    transition: 'opacity 0.3s ease-out',
  };
};

// Formatting helpers
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(amount);
};

const getFormattedCardNumber = (card: CardInfo) => {
  const pan = card.cardDetails?.pan;

  if (!pan || !showCardDetails.value) return '**** **** **** ****';

  // Show full number with spacing: 1234 5678 9012 3456
  return pan.match(/.{1,4}/g)?.join(' ') || pan;
};

const formatExpiryDate = (card: CardInfo) => {
  // Only show expiry when card details are visible
  if (!showCardDetails.value) {
    return '**/**';
  }

  // Try to get expiry from card details first (format: "YYYY-MM")
  const apiExpiry = card.cardDetails?.expiryDate;

  if (apiExpiry) {
    // Parse "2028-10" to "10/28"
    const [year, month] = apiExpiry.split('-');
    const shortYear = year.slice(-2);
    return `${month}/${shortYear}`;
  }

  // Fallback to creation date + 4 years
  if (card.cardData?.created_at) {
    const date = new Date(card.cardData.created_at);
    date.setFullYear(date.getFullYear() + 4);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${month}/${year}`;
  }

  return '**/**';
};

const formatADA = (eurAmount: number) => {
  // Use real exchange rate from store (sell rate = EUR -> ADA conversion)
  const adaAmount = eurAmount / exchangeRate.value;
  return adaAmount.toFixed(2);
};
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';

.hero-section {
  width: 100%;
  position: relative;
  min-height: 320px;
  align-content: center;
}

.card-status-column {
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

// Card Layout (side by side)
.card-layout {
  display: flex;
  align-items: center;
  gap: $spacing-2xl;
  width: 100%;
}

.card-carousel {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 12px;
}

// Card Status Chip Container
.card-status-chip-container {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  margin-top: -8px;
  min-height: 28px; // Reserve space for badge even when empty
  height: 28px; // Fixed height to prevent wiggling
}

// Card Status Chips
.card-status-chip {
  font-size: 0.75rem !important;
  font-weight: $font-weight-semibold;
  height: 28px !important;
  padding: 0 12px !important;
  border-radius: 14px !important;
  text-transform: uppercase;
  letter-spacing: 0.5px;

  &.active-chip {
    background: linear-gradient(135deg, rgba(0, 199, 243, 0.2) 0%, rgba(0, 199, 243, 0.15) 100%) !important;
    border: 1px solid rgba(0, 199, 243, 0.4) !important;
    color: $primary-cyan !important;

    .v-icon {
      color: $primary-cyan !important;
    }
  }

  &.pending-chip {
    background: linear-gradient(135deg, rgba(255, 152, 0, 0.2) 0%, rgba(255, 152, 0, 0.15) 100%) !important;
    border: 1px solid rgba(255, 152, 0, 0.4) !important;
    color: #ff9800 !important;

    .v-icon {
      color: #ff9800 !important;
    }
  }

  &.inactive-chip {
    background: linear-gradient(135deg, rgba(158, 158, 158, 0.2) 0%, rgba(158, 158, 158, 0.15) 100%) !important;
    border: 1px solid rgba(158, 158, 158, 0.4) !important;
    color: #9e9e9e !important;

    .v-icon {
      color: #9e9e9e !important;
    }
  }

  &.rejected-chip {
    background: linear-gradient(135deg, rgba(244, 67, 54, 0.2) 0%, rgba(244, 67, 54, 0.15) 100%) !important;
    border: 1px solid rgba(244, 67, 54, 0.4) !important;
    color: #f44336 !important;

    .v-icon {
      color: #f44336 !important;
    }
  }
}

// Timer in button
.complete-payment-btn {
  :deep(.v-icon) {
    color: #0c0e12 !important;
  }
  
  &.v-btn--disabled {
    :deep(.v-icon) {
      color: rgba(#0c0e12, 0.5) !important;
    }
  }
}

.timer-in-button {
  font-family: 'Courier New', monospace;
  font-size: $font-size-sm;
  font-weight: $font-weight-semibold;
  letter-spacing: 0.05rem;
  color: #0c0e12;
}

// Credit Card Styling
.credit-card {
  width: 35rem;
  aspect-ratio: 345 / 222;
  max-width: 90%;
  margin: 0 auto;
  background-image: url('@/assets/front_card_no_mcx2.png');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  border-radius: 1rem;
  padding: 2rem;
  color: white;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3), 0 0 120px rgba(0, 200, 200, 0.12), 0 0 60px rgba(0, 200, 200, 0.08);
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  cursor: pointer;
  transform-style: preserve-3d;
  transform: scale(0.7);
  overflow: hidden;
}

.card-shine {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: 1rem;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.1s ease-out;
  z-index: 1;
}

.card-number {
  font-family: 'Courier New', monospace;
  font-size: 1.5rem;
  letter-spacing: 0.25rem;
  margin-top: auto;
  margin-bottom: 1rem;
  font-weight: 500;
  position: relative;
  z-index: 2;
}

.card-bottom {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1rem;
  position: relative;
  z-index: 2;

  .card-holder,
  .card-cvv,
  .card-expiry {
    .label {
      font-size: 0.625rem;
      letter-spacing: 0.1rem;
      opacity: 0.8;
      margin: 0 0 0.25rem 0;
      font-weight: 500;
    }

    .value {
      font-size: 0.875rem;
      font-weight: 600;
      margin: 0;
      letter-spacing: 0.05rem;
    }
  }

  .card-holder {
    flex: 1;
  }

  .card-cvv {
    margin-right: 0.5rem;
  }
}

// Balance Section
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

    &.order-physical-btn {
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

      :deep(.v-icon) {
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

.no-cards {
  @include flex-center;
  gap: $spacing-md;
  padding: $spacing-lg;

  .card-banner {
    object-fit: contain;
    width: 100%;
    max-width: 400px;
    height: auto;
  }

  .no-cards {
    font-family: $font-family-primary;
    font-size: $font-size-base;
    color: $text-secondary;
    margin: 0;
  }
}

// Order Card Section
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
    margin: 0 0 16px 0;
    line-height: 1.6;
    max-width: 500px;
    margin-left: auto;
    margin-right: auto;
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

@keyframes shimmer {
  0% {
    left: -100%;
  }
  100% {
    left: 200%;
  }
}

.status-chip {
  font-size: 0.75rem !important;
  font-weight: $font-weight-semibold;
  height: 24px !important;
  padding: 0 10px !important;
  background: linear-gradient(135deg, rgba(0, 199, 243, 0.2) 0%, rgba(0, 255, 209, 0.15) 100%) !important;
  border: 1px solid rgba(0, 199, 243, 0.3);
  color: $primary-cyan !important;
}

// Waiting Status Card - Enhanced Design
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

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: transparent;
    pointer-events: none;
  }

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

    .status-spinner {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
    }

    .status-icon {
      font-size: 28px !important;
      color: $primary-cyan;
      animation: pulse 2s ease-in-out infinite;
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

  .order-new-card-btn {
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

    :deep(.v-icon) {
      color: #0c0e12 !important;
    }
  }

  .status-steps {
    display: flex;
    gap: 24px;
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);

    .step {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;

      .step-icon {
        color: rgba($text-secondary, 0.4);
        transition: color 0.3s ease;
      }

      .step-text {
        font-family: $font-family-primary;
        font-size: 0.8125rem;
        font-weight: $font-weight-medium;
        color: rgba($text-secondary, 0.5);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        transition: color 0.3s ease;
      }

      &.completed {
        .step-icon {
          color: #4caf50;
        }

        .step-text {
          color: rgba($text-secondary, 0.7);
        }
      }

      &.active {
        .step-icon {
          color: $primary-cyan;
          animation: pulse 2s ease-in-out infinite;
        }

        .step-text {
          color: $primary-cyan;
          font-weight: $font-weight-semibold;
        }
      }
    }
  }
}

@keyframes gradientShift {
  0%,
  100% {
    background-position: 0% 50%;
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
  .credit-card {
    width: 30rem;
  }

  .order-card-section {
    padding: 24px;

    .order-title {
      font-size: 1.5rem;
    }

    .order-description {
      font-size: $font-size-sm;
    }
  }

  .waiting-status-card {
    .status-steps {
      flex-direction: column;
      gap: 12px;

      .step {
        justify-content: flex-start;
      }
    }
  }
}

@media (max-width: 425px) {
  .credit-card {
    width: 28rem;
  }

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

  .waiting-status-card {
    .status-card-content {
      flex-direction: column;
      gap: 16px;
      padding: 20px !important;
    }

    .status-icon-wrapper {
      width: 48px;
      height: 48px;

      .status-icon {
        font-size: 24px !important;
      }
    }

    .status-title {
      font-size: 1rem;
    }

    .status-steps {
      gap: 10px;

      .step {
        .step-text {
          font-size: 0.75rem;
        }
      }
    }
  }
}
</style>
