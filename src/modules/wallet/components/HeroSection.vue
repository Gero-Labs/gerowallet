<template>
  <div class="hero-section">
    <v-card flat class="transparent">
      <v-row>
        <v-col cols="12" md="6" class="py-0" style="align-content: center; justify-items: center">
          <CardCarousel
            :cards="cardsWithOrderSlot"
            :current-card-index="currentCardIndex"
            :current-card-status="currentCardStatus"
            :current-card-has-u-u-i-d="currentCardHasUUID"
            :show-card-details="showCardDetails"
            :loading-order-details="loadingOrderDetails"
            @update:current-card-index="cardStoreModule.setCurrentCardIndex($event)"
            @card-click="handleCardClick"
          />
        </v-col>
        <CardStatusSection
          :cards="cards"
          :current-card-index="currentCardIndex"
          :cards-with-order-slot="cardsWithOrderSlot"
          :current-card-has-u-u-i-d="currentCardHasUUID"
          :current-card-type="currentCardType"
          :current-card-status="currentCardStatus"
          :is-current-card-rejected="isCurrentCardRejected"
          :should-show-order-card-section="shouldShowOrderCardSection"
          :show-order-timer="showOrderTimer"
          :timer-display="timerDisplay"
          :loading-order-details="loadingOrderDetails"
          :ordering-card="orderingCard"
          :show-card-details="showCardDetails"
          :exchange-rate="exchangeRate"
          :payment-details-cache="paymentDetailsCache"
          @top-up="handleTopUp"
          @toggle-card-visibility="toggleCardVisibility"
          @order-new-card-after-rejection="handleOrderNewCardAfterRejection"
          @complete-payment="openPaymentModal"
          @open-order-card-flow="handleOpenOrderCardFlow"
          @show-promotion-modal="showPromotionModal = true"
          @update:timer-display="timerDisplay = $event"
        />
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

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import ManageCardModal from './dashboard/ManageCardModal.vue';
import TopUpModal from './dashboard/TopUpModal.vue';
import PromotionModal from './PromotionModal.vue';
import OrderPhysicalCardModal from './dashboard/OrderPhysicalCardModal.vue';
import OrderCardFlowModal from './dashboard/OrderCardFlowModal.vue';
import PayOrderModal from './dashboard/PayOrderModal.vue';
import CardCarousel from './dashboard/CardCarousel.vue';
import CardStatusSection from './dashboard/CardStatusSection.vue';
import cardStoreModule from '@/stores/modules/card';
import { CardInfo } from '@/models/card';

const currentCardIndex = computed({
  get: () => cardStoreModule.state.currentCardIndex,
  set: (value) => cardStoreModule.setCurrentCardIndex(value),
});
const showCardDetails = ref(false);
const showManageCardModal = ref(false);
const showTopUpModal = ref(false);
const showPromotionModal = ref(false);
const showOrderPhysicalCardModal = ref(false);
const showOrderCardFlowModal = ref(false);
const showPayOrderModal = ref(false);
const orderingCard = ref(false);
const loadingOrderDetails = ref(false);
const pendingOrderUuid = ref<string | null>(null);
const hiddenOrderUuids = ref<string[]>([]);
const orderStatuses = ref<Record<string, string>>({});
const timerDisplay = ref('');
const paymentDetailsCache = ref<Record<string, { expires_at?: string; status?: string }>>({});
let timerInterval: ReturnType<typeof setInterval> | null = null;

// Constants
const TIMER_UPDATE_INTERVAL_MS = 1000;

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
const cards = computed(() => {
  return cardStoreModule.state.cards || [];
});


const hasVirtualCard = computed(() => {
  return cards.value.some(card =>
    card.cardData?.own_type === 'virtual' &&
    card.cardData?.card_uuid
  );
});

const normalizeStatus = (status: string | null | undefined): string | null => {
  if (!status) return null;
  return status.toLowerCase();
};

const isCardRejectedOrExpired = (card: CardInfo): boolean => {
  const status = normalizeStatus(card.cardData?.status);
  return status === 'rejected' || status === 'expired';
};

const hasPhysicalCard = computed(() => {
  return cards.value.some(card => {
    if (card.cardData?.own_type !== 'physical') {
      return false;
    }

    if (isCardRejectedOrExpired(card)) {
      return false;
    }

    return !!card.cardData?.card_uuid;
  });
});

const canOrderNewCard = computed(() => {
  return !hasVirtualCard.value || !hasPhysicalCard.value;
});

const cardsWithOrderSlot = computed(() => {
  const filteredCards: CardInfo[] = [];
  const seenIds = new Set<string>();

  const getCardUniqueId = (card: CardInfo): string | null => {
    if (card.cardData?.card_uuid) {
      return `card_${card.cardData.card_uuid}`;
    }
    if (card.cardData?.order_uuid) {
      return `order_${card.cardData.order_uuid}`;
    }
    if (card.cardData?.id) {
      return `id_${card.cardData.id}`;
    }
    return null;
  };

  const virtualCards = cards.value.filter(card => {
    return card.cardData?.own_type === 'virtual' &&
    (card.cardData?.card_uuid || card.cardData?.order_uuid) && card.cardData?.delivery?.payment_status !== 'expired'
  });
  const physicalCards = cards.value.filter(card => {
    if (card.cardData?.own_type !== 'physical') {
      return false;
    }

    const status = card.cardData?.status;
    if (status === 'rejected' || status === 'REJECTED') {
      return false;
    }

    if (card.cardData?.delivery?.payment_status === 'expired') {
      return false;
    }

    if (card.cardData?.card_uuid) {
      return true;
    }

    if (card.cardData?.order_uuid && !card.cardData?.card_uuid) {
      const paymentDetails = paymentDetailsCache.value[card.cardData.order_uuid];
      if (paymentDetails) {
        if (paymentDetails.status === 'rejected') {
          return false;
        }
      }

      return true;
    }

    return false;
  });
  if (virtualCards.length > 0) {
    const activeVirtual = virtualCards.find(card => card.cardData?.card_uuid);
    const cardToAdd = activeVirtual || virtualCards[0];
    const uniqueId = getCardUniqueId(cardToAdd);

    if (uniqueId && !seenIds.has(uniqueId)) {
      filteredCards.push(cardToAdd);
      seenIds.add(uniqueId);
    }
  }

  if (physicalCards.length > 0) {
    const activePhysical = physicalCards.find(card => card.cardData?.card_uuid);
    const pendingPhysical = physicalCards.filter(card => !card.cardData?.card_uuid && card.cardData?.order_uuid);

    if (activePhysical) {
      const uniqueId = getCardUniqueId(activePhysical);
      if (uniqueId && !seenIds.has(uniqueId)) {
        filteredCards.push(activePhysical);
        seenIds.add(uniqueId);
      }
    }

    for (const pendingCard of pendingPhysical) {
      const uniqueId = getCardUniqueId(pendingCard);
      if (uniqueId && !seenIds.has(uniqueId)) {
        filteredCards.push(pendingCard);
        seenIds.add(uniqueId);
      }
    }
  }

  const hasPendingCards = filteredCards.some(card =>
    card.cardData?.order_uuid && !card.cardData?.card_uuid
  );

  if (filteredCards.length === 0) {
    return [emptyCard];
  } else if (canOrderNewCard.value && !hasPendingCards) {
    return [...filteredCards, emptyCard];
  } else {
    return filteredCards;
  }
});

watch(
  () => cardStoreModule.state.cards,
  (newCards) => {
    for (const storeCard of newCards) {
      if (storeCard.cardData.card_uuid && storeCard.cardBalance) {
        const cardInSlot = cardsWithOrderSlot.value.find(
          c => c.cardData.card_uuid === storeCard.cardData.card_uuid
        );
        if (cardInSlot) {
          cardInSlot.cardBalance = storeCard.cardBalance;
        }
      }
    }
  },
  { deep: true, immediate: true }
);

watch(
  () => cardStoreModule.state.cards,
  () => {
    if (currentCardIndex.value >= 0 && cardsWithOrderSlot.value[currentCardIndex.value]?.cardData?.card_uuid) {
      const cardUuid = cardsWithOrderSlot.value[currentCardIndex.value].cardData.card_uuid;
      const cardInStore = cards.value.find(c => c.cardData.card_uuid === cardUuid);
      if (cardInStore && cardInStore.cardBalance) {
        const cardInSlot = cardsWithOrderSlot.value[currentCardIndex.value];
        if (cardInSlot && cardInSlot.cardData.card_uuid === cardUuid) {
          cardInSlot.cardBalance = cardInStore.cardBalance;
        }
      }
    }
  },
  { deep: true, immediate: true }
);

const exchangeRate = computed(() => {
  return cardStoreModule.state.exchangeRate?.sell ? parseFloat(cardStoreModule.state.exchangeRate.sell) : 0.35;
});

const currentCardHasUUID = computed(() => {
  return cardsWithOrderSlot.value[currentCardIndex.value]?.cardData.card_uuid !== null;
});

const currentCardType = computed(() => {
  const currentCard = cardsWithOrderSlot.value[currentCardIndex.value];
  return currentCard?.cardData?.own_type || 'virtual';
});

const currentCardStatus = computed(() => {
  const currentCard = cardsWithOrderSlot.value[currentCardIndex.value];
  if (!currentCard?.cardData?.order_uuid) return null;

  const orderUuid = currentCard.cardData.order_uuid;
  const status = orderStatuses.value[orderUuid];

  if (status) return status;

  const paymentDetails = paymentDetailsCache.value[orderUuid];
  if (paymentDetails?.status) {
    return paymentDetails.status;
  }

  if (!currentCard.cardData.card_uuid) {
    return 'pending';
  }

  return null;
});

const isCurrentCardRejected = computed(() => {
  const status = normalizeStatus(currentCardStatus.value);
  return status === 'rejected' || status === 'expired';
});

const isCurrentCardPending = computed(() => {
  const currentCard = cardsWithOrderSlot.value[currentCardIndex.value];
  return !!(currentCard?.cardData?.order_uuid && !currentCard?.cardData?.card_uuid);
});

const isCurrentCardEmpty = computed(() => {
  const currentCard = cardsWithOrderSlot.value[currentCardIndex.value];
  return !currentCard?.cardData?.id && !currentCard?.cardData?.card_uuid && !currentCard?.cardData?.order_uuid;
});

const shouldShowOrderCardSection = computed(() => {
  const currentCard = cardsWithOrderSlot.value[currentCardIndex.value];

  if (!currentCard) return false;

  if (isCurrentCardEmpty.value) return true;

  if (currentCardHasUUID.value) return false;

  if (hasVirtualCard.value && hasPhysicalCard.value) return false;

  if (isCurrentCardPending.value) return false;

  return canOrderNewCard.value;
});

const showOrderTimer = computed(() => {
  const currentCard = cardsWithOrderSlot.value[currentCardIndex.value];
  if (!currentCard?.cardData?.id || currentCard?.cardData?.card_uuid) return false;
  if (currentCard?.cardData?.own_type !== 'physical') return false;
  if (!currentCard?.cardData?.order_uuid) return false;

  if (isCurrentCardRejected.value) return false;

  const orderUuid = currentCard.cardData.order_uuid;
  const paymentDetails = paymentDetailsCache.value[orderUuid];
  if (!paymentDetails) return false;

  if (paymentDetails.status === 'expired' || paymentDetails.status === 'completed') return false;
  if (paymentDetails.status !== 'pending' && paymentDetails.status !== 'completed') return false;

  if (!paymentDetails.expires_at) return false;

  const expiresAt = new Date(paymentDetails.expires_at);
  const now = new Date();
  return now < expiresAt;
});



const updateTimer = () => {
  const currentCard = cardsWithOrderSlot.value[currentCardIndex.value];
  if (!currentCard?.cardData?.order_uuid || !showOrderTimer.value) {
    timerDisplay.value = '';
    return;
  }

  const orderUuid = currentCard.cardData.order_uuid;
  const paymentDetails = paymentDetailsCache.value[orderUuid];
  if (!paymentDetails?.expires_at) {
    timerDisplay.value = '';
    return;
  }

  const expiresAt = new Date(paymentDetails.expires_at);
  const now = new Date();
  const remaining = expiresAt.getTime() - now.getTime();

  if (remaining <= 0) {
    timerDisplay.value = '';
    return;
  }

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  timerDisplay.value = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

watch(
  () => cardStoreModule.state.selectedCardId,
  (newCardId, oldCardId) => {
    if (newCardId && cardsWithOrderSlot.value.length > 0) {
      const index = cardsWithOrderSlot.value.findIndex(c => c.cardData.card_uuid === newCardId);
      if (index >= 0 && index !== currentCardIndex.value) {
        currentCardIndex.value = index;
      }
    } else if (!newCardId && cardsWithOrderSlot.value.length > 0) {
      // Only auto-select the first card on initial load (when there was no previous selectedCardId)
      // Don't interfere when user navigates to empty card slot
      const currentCard = cardsWithOrderSlot.value[currentCardIndex.value];
      const isOnValidCard = currentCard && (currentCard.cardData?.id || currentCard.cardData?.card_uuid || currentCard.cardData?.order_uuid !== undefined);

      // Only default to first actual card if we're not already on a valid card/slot
      if (!isOnValidCard || oldCardId === undefined) {
        const firstActualCardIndex = cardsWithOrderSlot.value.findIndex(
          c => c.cardData?.id || c.cardData?.card_uuid || c.cardData?.order_uuid
        );
        if (firstActualCardIndex >= 0) {
          if (firstActualCardIndex !== currentCardIndex.value) {
            currentCardIndex.value = firstActualCardIndex;
          }
          // Also select the card if it has a UUID
          const firstCard = cardsWithOrderSlot.value[firstActualCardIndex];
          if (firstCard?.cardData?.card_uuid) {
            cardStoreModule.selectCard(firstCard.cardData.card_uuid);
          }
        }
      }
    }
  },
  { immediate: true }
);

watch(
  () => cardsWithOrderSlot.value.length,
  (newLength) => {
    if (currentCardIndex.value >= newLength) {
      currentCardIndex.value = Math.max(0, newLength - 1);
    }
  }
);

const checkCurrentCardStatus = async () => {
  const currentCard = cardsWithOrderSlot.value[currentCardIndex.value];
  if (!currentCard?.cardData?.order_uuid || currentCard?.cardData?.card_uuid) {
    return;
  }

  if (hiddenOrderUuids.value.includes(currentCard.cardData.order_uuid)) {
    return;
  }

  try {
    loadingOrderDetails.value = true;
    const orderDetails = await cardStoreModule.getOrderDetails(currentCard.cardData.order_uuid);

    if (orderDetails?.status) {
      orderStatuses.value = {
        ...orderStatuses.value,
        [currentCard.cardData.order_uuid]: orderDetails.status,
      };
    }

    if (orderDetails?.card_uuid && !currentCard.cardData.card_uuid) {
      await cardStoreModule.fetchCardData();
      return;
    }

    if (currentCard.cardData?.own_type === 'virtual') {
      return;
    }

    const paymentDetails = await cardStoreModule.getDeliveryPayment(currentCard.cardData.order_uuid);

    if (paymentDetails) {
      if (paymentDetails.status === 'rejected') {
        orderStatuses.value = {
          ...orderStatuses.value,
          [currentCard.cardData.order_uuid]: 'rejected',
        };
      } else if (paymentDetails.status === 'expired') {
        orderStatuses.value = {
          ...orderStatuses.value,
          [currentCard.cardData.order_uuid]: 'expired',
        };
      }

      if (paymentDetails.expires_at && paymentDetails.status === 'pending') {
        const expiresAt = new Date(paymentDetails.expires_at);
        const now = new Date();
        if (now >= expiresAt) {
          paymentDetails.status = 'expired';
          orderStatuses.value = {
            ...orderStatuses.value,
            [currentCard.cardData.order_uuid]: 'expired',
          };
        }
      }

      paymentDetailsCache.value = {
        ...paymentDetailsCache.value,
        [currentCard.cardData.order_uuid]: {
          expires_at: paymentDetails.expires_at,
          status: paymentDetails.status,
        },
      };

      updateTimer();
    }

  } catch (error) {
    // Silent error handling - status check failed, but don't block UI
  } finally {
    loadingOrderDetails.value = false;
  }
};

watch(currentCardIndex, async (newIndex, oldIndex) => {
  if (newIndex === oldIndex) return;

  const card = cardsWithOrderSlot.value[newIndex];

  if (!card) return;

  const isEmpty = !card.cardData?.id && !card.cardData?.card_uuid && !card.cardData?.order_uuid;

  if (isEmpty) {
    cardStoreModule.selectCard(null);
    return;
  }

  if (card.cardData.card_uuid) {
    cardStoreModule.selectCard(card.cardData.card_uuid);
    try {
      await cardStoreModule.fetchCardBalance(card.cardData.card_uuid);
      const updatedCard = cards.value.find(c => c.cardData.card_uuid === card.cardData.card_uuid);
      if (updatedCard && updatedCard.cardBalance) {
        const cardInSlot = cardsWithOrderSlot.value[newIndex];
        if (cardInSlot && cardInSlot.cardData.card_uuid === card.cardData.card_uuid) {
          cardInSlot.cardBalance = updatedCard.cardBalance;
        }
      }
    } catch (error) {
      // Silent error handling
    }
  } else if (card.cardData.order_uuid) {
    cardStoreModule.selectCard(null);
  } else {
    cardStoreModule.selectCard(null);
  }
  updateTimer();
});

const handleOrderNewCardAfterRejection = () => {
  showOrderCardFlowModal.value = true;
};

watch(showOrderTimer, (shouldShow) => {
  if (shouldShow) {
    updateTimer();
    if (timerInterval) {
      clearInterval(timerInterval);
    }
    timerInterval = setInterval(updateTimer, TIMER_UPDATE_INTERVAL_MS);
  } else {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    timerDisplay.value = '';
  }
}, { immediate: true });

watch(
  () => {
    const currentCard = cardsWithOrderSlot.value[currentCardIndex.value];
    if (!currentCard?.cardData?.order_uuid) return null;
    return paymentDetailsCache.value[currentCard.cardData.order_uuid];
  },
  () => {
    updateTimer();
  },
  { deep: true }
);

const toggleCardVisibility = async () => {
  try {
    await cardStoreModule.fetchCardDetails(cardStoreModule.state.selectedCardId);
    showCardDetails.value = !showCardDetails.value;
  } catch (error) {
    // Silent error handling
  }
};

const handleTopUp = () => {
  showTopUpModal.value = true;
};

const openPaymentModal = () => {
  const currentCard = cardsWithOrderSlot.value[currentCardIndex.value];
  if (!currentCard?.cardData?.order_uuid) return;

  if (currentCardStatus.value === 'expired') {
    showOrderCardFlowModal.value = true;
  } else {
    pendingOrderUuid.value = currentCard.cardData.order_uuid;
    showPayOrderModal.value = true;
  }
};

const handleOpenOrderCardFlow = () => {
  showOrderCardFlowModal.value = true;
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

const checkPendingOrders = async () => {
  const pendingCards = cards.value.filter(
    card =>
      card.cardData?.id &&
      card.cardData?.order_uuid &&
      !card.cardData?.card_uuid &&
      !hiddenOrderUuids.value.includes(card.cardData.order_uuid) &&
      card.cardData.delivery?.payment_status !== 'expired'
  );

  for (const card of pendingCards) {
    try {
      loadingOrderDetails.value = true;

      const orderDetails = await cardStoreModule.getOrderDetails(card.cardData.order_uuid);

      if (orderDetails?.status) {
        orderStatuses.value[card.cardData.order_uuid] = orderDetails.status;
      }

      if (orderDetails?.card_uuid && !card.cardData.card_uuid) {
        await cardStoreModule.fetchCardData();
        continue;
      }

      if (card.cardData?.own_type === 'virtual') {
        continue;
      }

      const paymentDetails = await cardStoreModule.getDeliveryPayment(card.cardData.order_uuid);

      if (paymentDetails) {
        if (paymentDetails.status === 'rejected') {
          orderStatuses.value[card.cardData.order_uuid] = 'rejected';
          continue;
        } else if (paymentDetails.status === 'expired') {
          orderStatuses.value[card.cardData.order_uuid] = 'expired';
        }

        if (paymentDetails.expires_at && paymentDetails.status === 'pending') {
          const expiresAt = new Date(paymentDetails.expires_at);
          const now = new Date();
          if (now >= expiresAt) {
            paymentDetails.status = 'expired';
            orderStatuses.value[card.cardData.order_uuid] = 'expired';
          }
        }

        paymentDetailsCache.value[card.cardData.order_uuid] = {
          expires_at: paymentDetails.expires_at,
          status: paymentDetails.status,
        };

        if (card.cardData.order_uuid === cardsWithOrderSlot.value[currentCardIndex.value]?.cardData?.order_uuid) {
          updateTimer();
        }
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

const hasCheckedPendingOrders = ref(false);

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
        checkPendingOrders().then(() => {
          updateTimer();
        });
      }
    }
  },
  { immediate: true, deep: true }
);

onBeforeUnmount(() => {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
});

const handleCardClick = (card: CardInfo) => {
  const isEmpty = !card.cardData?.id && !card.cardData?.card_uuid && !card.cardData?.order_uuid;

  if (isEmpty) {
    handleOpenOrderCardFlow();
  } else if (currentCardHasUUID.value) {
    showManageCardModal.value = true;
  }
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


// Card Layout (side by side)
.card-layout {
  display: flex;
  align-items: center;
  gap: $spacing-2xl;
  width: 100%;
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


</style>
