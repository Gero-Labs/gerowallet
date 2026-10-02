<template>
  <div class="hero-section">
    <div class="hero-section__card">
      <!-- The 3D card carousel is unchanged; it reads the same status values as before. -->
      <CardCarousel
        :cards="cardsWithOrderSlot"
        :current-card-index="currentCardIndex"
        :current-card-status="carouselStatus"
        :current-card-has-u-u-i-d="currentCardHasUUID"
        :show-card-details="showCardDetails"
        :loading-order-details="loadingCurrentOrder"
        @update:current-card-index="cardStoreModule.setCurrentCardIndex($event)"
        @card-click="handleCardClick"
      />
    </div>

    <CardStatusSection
      class="hero-section__status"
      :card="currentCard"
      :tracker="currentTracker"
      :expires-at="currentExpiresAt"
      :can-order="canOrderNewCard"
      :show-card-details="showCardDetails"
      :details-loading="detailsLoading"
      :exchange-rate="exchangeRate"
      :activating="isCurrentCardActivating"
      @top-up="showTopUpModal = true"
      @manage="showManageCardModal = true"
      @toggle-card-visibility="toggleCardVisibility"
      @open-order-card-flow="showOrderCardFlowModal = true"
      @complete-payment="openPaymentModal"
      @show-promotion-modal="showPromotionModal = true"
      @activated="handleActivated"
    />

    <ManageCardModal :open="showManageCardModal" @close="handleManageCardClose" />
    <TopUpModal :open="showTopUpModal" @close="handleTopUpClose" />
    <PromotionModal :open="showPromotionModal" @close="showPromotionModal = false" />
    <OrderCardFlowModal :open="showOrderCardFlowModal" @close="handleOrderCardFlowClose" />
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
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { CardInfo } from '@/models/card';
import cardStoreModule from '@/stores/modules/card';
import { useTranslation } from '@/shared/composables/useTranslation';
import snackbar from '@/plugins/snackbar';
import { useOrderTracking } from '@/modules/wallet/composables/useOrderTracking';
import { deliveryPaymentState, orderTracker, type OrderTrackerView } from '@/modules/wallet/utils/cardOrderTracker';
import ManageCardModal from './dashboard/ManageCardModal.vue';
import TopUpModal from './dashboard/TopUpModal.vue';
import PromotionModal from './PromotionModal.vue';
import OrderCardFlowModal from './dashboard/OrderCardFlowModal.vue';
import PayOrderModal from './dashboard/PayOrderModal.vue';
import CardCarousel from './dashboard/CardCarousel.vue';
import CardStatusSection from './dashboard/CardStatusSection.vue';

const { t } = useTranslation();

const currentCardIndex = computed({
  get: () => cardStoreModule.state.currentCardIndex,
  set: value => cardStoreModule.setCurrentCardIndex(value),
});
const showCardDetails = ref(false);
const detailsLoading = ref(false);
const showManageCardModal = ref(false);
const showTopUpModal = ref(false);
const showPromotionModal = ref(false);
const showOrderCardFlowModal = ref(false);
const showPayOrderModal = ref(false);
const pendingOrderUuid = ref<string | null>(null);

// The "order a card" slot of the carousel.
const emptyCard = {
  cardData: {
    id: null, user_id: null, program_uuid: null, currency: null, account_to_charge: null,
    processing_type: null, cardholder_phone: null, payment_card_type: null, own_type: null,
    card_holder_name: null, order_uuid: null, card_uuid: null, status: null, card_status: null,
    balance: null, pan: null, currentBalance: null, created_at: null, updated_at: null,
  },
  cardDetails: { pan: null, cvc2: null, expiryDate: null, cardHolderName: null },
  cardPin: null,
  cardNumber: null,
  cardBalance: { currentBalance: { amount: 0, currencyCode: 'EUR' }, state: null },
  cardHistory: null,
  totalDeposits: 0,
  activities: [],
} as unknown as CardInfo;

const cards = computed<CardInfo[]>(() => cardStoreModule.state.cards || []);
const { snapshotOf, checking, refreshAll } = useOrderTracking(cards);

function trackerFor(card: CardInfo): OrderTrackerView {
  const snapshot = snapshotOf(card.cardData.order_uuid);
  return orderTracker({
    physical: card.cardData.own_type === 'physical',
    orderStatus: snapshot?.status ?? card.cardData.status,
    payment: snapshot?.payment ?? deliveryPaymentState(card.cardData.delivery?.payment_status),
  });
}

const isRejected = (card: CardInfo) => card.cardData?.status?.toLowerCase() === 'rejected';
const isOrderOnly = (card: CardInfo) => !!card.cardData?.order_uuid && !card.cardData?.card_uuid;

const hasVirtualCard = computed(() =>
  cards.value.some(card => card.cardData?.own_type === 'virtual' && !!card.cardData?.card_uuid),
);

const hasPhysicalCard = computed(() =>
  cards.value.some(
    card =>
      card.cardData?.own_type === 'physical' &&
      !isRejected(card) &&
      card.cardData.status?.toLowerCase() !== 'expired' &&
      !!card.cardData.card_uuid,
  ),
);

const canOrderNewCard = computed(() => !hasVirtualCard.value || !hasPhysicalCard.value);

const cardsWithOrderSlot = computed<CardInfo[]>(() => {
  const slots: CardInfo[] = [];
  const seen = new Set<string>();
  const add = (card: CardInfo) => {
    const id = card.cardData.card_uuid || card.cardData.order_uuid || String(card.cardData.id ?? '');
    if (id && !seen.has(id)) {
      seen.add(id);
      slots.push(card);
    }
  };

  const virtualCards = cards.value.filter(
    card =>
      card.cardData?.own_type === 'virtual' &&
      (card.cardData.card_uuid || card.cardData.order_uuid) &&
      card.cardData.delivery?.payment_status !== 'expired',
  );
  if (virtualCards.length) add(virtualCards.find(card => card.cardData.card_uuid) || virtualCards[0]);

  const physicalCards = cards.value.filter(card => {
    if (card.cardData?.own_type !== 'physical' || isRejected(card)) return false;
    if (card.cardData.delivery?.payment_status === 'expired') return false;
    if (card.cardData.card_uuid) return true;
    return !!card.cardData.order_uuid && snapshotOf(card.cardData.order_uuid)?.payment !== 'rejected';
  });
  const activePhysical = physicalCards.find(card => card.cardData.card_uuid);
  if (activePhysical) add(activePhysical);
  physicalCards.filter(isOrderOnly).forEach(add);

  if (!slots.length) return [emptyCard];
  const hasPendingOrder = slots.some(isOrderOnly);
  return canOrderNewCard.value && !hasPendingOrder ? [...slots, emptyCard] : slots;
});

const currentCard = computed<CardInfo | undefined>(() => cardsWithOrderSlot.value[currentCardIndex.value]);
const currentCardHasUUID = computed(() => !!currentCard.value?.cardData?.card_uuid);

const currentTracker = computed(() =>
  currentCard.value && isOrderOnly(currentCard.value) ? trackerFor(currentCard.value) : undefined,
);

const currentExpiresAt = computed(() => {
  const card = currentCard.value;
  if (!card || !isOrderOnly(card)) return undefined;
  return snapshotOf(card.cardData.order_uuid)?.expiresAt || card.cardData.delivery?.deposit_expires_at || undefined;
});

// The carousel shows Pending / Rejected / Expired from these values.
const carouselStatus = computed(() => {
  const view = currentTracker.value;
  if (!view) return null;
  return view.ended ?? 'pending';
});

const loadingCurrentOrder = computed(() => {
  const card = currentCard.value;
  return !!card && isOrderOnly(card) && checking.value && !snapshotOf(card.cardData.order_uuid);
});

const exchangeRate = computed(() => {
  const sell = parseFloat(String(cardStoreModule.state.exchangeRate?.sell ?? ''));
  return Number.isFinite(sell) && sell > 0 ? sell : 0;
});

// Keep the selected card in step with the carousel and the store.
watch(
  () => cardStoreModule.state.selectedCardId,
  (newCardId, oldCardId) => {
    const slots = cardsWithOrderSlot.value;
    if (!slots.length) return;
    if (newCardId) {
      const index = slots.findIndex(slot => slot.cardData.card_uuid === newCardId);
      if (index >= 0 && index !== currentCardIndex.value) currentCardIndex.value = index;
      return;
    }
    // On first load (or when the current slot vanished) start at the first real card.
    const current = slots[currentCardIndex.value];
    const onRealSlot = !!(current?.cardData?.id || current?.cardData?.card_uuid || current?.cardData?.order_uuid);
    if (onRealSlot && oldCardId !== undefined) return;
    const first = slots.findIndex(slot => slot.cardData?.id || slot.cardData?.card_uuid || slot.cardData?.order_uuid);
    if (first >= 0) {
      if (first !== currentCardIndex.value) currentCardIndex.value = first;
      const firstUuid = slots[first].cardData.card_uuid;
      if (firstUuid) cardStoreModule.selectCard(firstUuid);
    }
  },
  { immediate: true },
);

watch(
  () => cardsWithOrderSlot.value.length,
  length => {
    if (currentCardIndex.value >= length) currentCardIndex.value = Math.max(0, length - 1);
  },
);

watch(currentCardIndex, async (index, previous) => {
  if (index === previous) return;
  showCardDetails.value = false;
  const cardUuid = cardsWithOrderSlot.value[index]?.cardData?.card_uuid;
  cardStoreModule.selectCard(cardUuid || null);
  if (!cardUuid) return;
  try {
    await cardStoreModule.fetchCardBalance(cardUuid);
  } catch {
    // The list's own balance stays on screen.
  }
});

async function toggleCardVisibility(): Promise<void> {
  if (showCardDetails.value) {
    showCardDetails.value = false;
    return;
  }
  const cardUuid = cardStoreModule.state.selectedCardId;
  if (!cardUuid) return;
  detailsLoading.value = true;
  try {
    await cardStoreModule.fetchCardDetails(cardUuid);
    showCardDetails.value = true;
  } catch {
    snackbar.setError(t('card.pleaseTryAgain'));
  } finally {
    detailsLoading.value = false;
  }
}

function openPaymentModal(): void {
  const orderUuid = currentCard.value?.cardData?.order_uuid;
  if (!orderUuid) return;
  pendingOrderUuid.value = orderUuid;
  showPayOrderModal.value = true;
}

function handleCardClick(card: CardInfo): void {
  const isEmpty = !card.cardData?.id && !card.cardData?.card_uuid && !card.cardData?.order_uuid;
  if (isEmpty) showOrderCardFlowModal.value = true;
  else if (card.cardData?.card_uuid) showManageCardModal.value = true;
}

async function reloadCards(): Promise<void> {
  try {
    await cardStoreModule.fetchCardData();
  } catch {
    // The cards on screen stay; the next refresh retries.
  }
  refreshAll();
}

async function handleManageCardClose(): Promise<void> {
  showManageCardModal.value = false;
  await reloadCards();
}

async function handleTopUpClose(): Promise<void> {
  showTopUpModal.value = false;
  await reloadCards();
}

async function handleOrderCardFlowClose(): Promise<void> {
  showOrderCardFlowModal.value = false;
  await reloadCards();
}

async function handlePaymentSuccess(): Promise<void> {
  await reloadCards();
}

// Activation: when the provider returns the card's UUID, follow its state until ACTIVE.
const activatingCards = ref<string[]>([]);
const activationTimers = new Map<string, ReturnType<typeof setInterval>>();
const ACTIVATION_POLL_MS = 5000;
const ACTIVATION_MAX_POLLS = 60;

const isCurrentCardActivating = computed(() => {
  const cardUuid = currentCard.value?.cardData?.card_uuid;
  return !!cardUuid && activatingCards.value.includes(cardUuid);
});

function stopActivationPoll(cardUuid: string): void {
  const timer = activationTimers.get(cardUuid);
  if (timer) clearInterval(timer);
  activationTimers.delete(cardUuid);
  activatingCards.value = activatingCards.value.filter(id => id !== cardUuid);
}

async function handleActivated(cardUuid: string | null): Promise<void> {
  await reloadCards();
  if (!cardUuid || activationTimers.has(cardUuid)) return;
  activatingCards.value = [...activatingCards.value, cardUuid];
  let polls = 0;
  activationTimers.set(cardUuid, setInterval(async () => {
    polls += 1;
    try {
      const state = await cardStoreModule.fetchCardState(cardUuid);
      if (state === 'ACTIVE') {
        stopActivationPoll(cardUuid);
        snackbar.fireSuccess(t('card.cardActivated'));
        await reloadCards();
        return;
      }
    } catch {
      // Keep polling; a transient error must not end the activation follow-up.
    }
    if (polls >= ACTIVATION_MAX_POLLS) stopActivationPoll(cardUuid);
  }, ACTIVATION_POLL_MS));
}

onBeforeUnmount(() => {
  [...activationTimers.keys()].forEach(stopActivationPoll);
});
</script>

<style lang="scss" scoped>
.hero-section {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr));
  gap: var(--g-s-5);
  align-items: center;
  width: 100%;
}

.hero-section__card {
  display: flex;
  justify-content: center;
  min-width: 0;
}

.hero-section__status {
  min-width: 0;
}
</style>
