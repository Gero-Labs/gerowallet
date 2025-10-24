<template>
  <div class="hero-section">
    <!-- Card Carousel and Balance Section -->
    <v-card flat class="transparent">
      <v-row>
        <v-col cols="12" md="7" class="py-0" style="align-content: center; justify-items: center">
          <div class="card-carousel">
            <v-window v-model="currentCardIndex" show-arrows continuous>
              <v-window-item
                v-for="(card, index) in cardsWithOrderSlot"
                :key="card.cardData?.card_uuid || `empty-${index}`"
              >
                <div
                  class="credit-card"
                  @mousemove="handleCardMouseMove"
                  @mouseleave="handleCardMouseLeave"
                  @click="showManageCardConfirmationModal = true && currentCardHasUUID"
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
                      <p class="label">CARDHOLDER NAME</p>
                      <p class="value">GERO WALLET</p>
                    </div>
                    <div class="card-cvv">
                      <p class="label">CVV</p>
                      <p class="value">
                        {{ showCardDetails && card.cardDetails?.details?.cvc2 ? card.cardDetails.details.cvc2 : '***' }}
                      </p>
                    </div>
                    <div class="card-expiry">
                      <p class="label">EXP.</p>
                      <p class="value">{{ formatExpiryDate(card) }}</p>
                    </div>
                  </div>
                </div>
              </v-window-item>
            </v-window>
          </div>
        </v-col>

        <!-- Order Card Section - Show when ready to order -->

        <v-col cols="12" md="5" class="py-0" style="align-content: center; justify-items: center">
          <div class="balance-section" v-if="currentCardHasUUID">
            <div class="balance-container">
              <p class="balance-label">Total Balance</p>
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
                  <img src="@/modules/wallet/icons/currency-euro.svg" alt="Top up" class="btn-icon" />
                  Top up
                </v-btn>
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
          <v-card v-else-if="cardsWithOrderSlot[currentCardIndex]?.cardData.id" outlined class="waiting-status-card mt-6">
            <div class="status-card-gradient"></div>
            <v-card-text class="status-card-content">
              <div class="status-icon-wrapper">
                <v-progress-circular indeterminate color="primary" size="40" width="3" class="status-spinner" />
                <v-icon class="status-icon">mdi-credit-card-clock-outline</v-icon>
              </div>
              <div class="status-text-wrapper">
                <div class="status-title-wrapper">
                  <p class="status-title mb-1">Card Order in Progress</p>
                  <v-chip small color="primary" class="status-chip">Pending</v-chip>
                </div>
                <p class="status-subtitle mb-0">
                  Your card order is being processed. <br />
                  This process may take up to 24 hours
                </p>
                <div class="status-steps mt-3">
                  <div class="step completed">
                    <v-icon small class="step-icon">mdi-check-circle</v-icon>
                    <span class="step-text">Order Placed</span>
                  </div>
                  <div class="step active">
                    <v-icon small class="step-icon">mdi-progress-clock</v-icon>
                    <span class="step-text">Verification</span>
                  </div>
                  <div class="step">
                    <v-icon small class="step-icon">mdi-circle-outline</v-icon>
                    <span class="step-text">Card Issued</span>
                  </div>
                </div>
              </div>
            </v-card-text>
          </v-card>
          <div v-else class="order-card-section mt-6">
            <h2 class="order-title">Get Your Gero Card</h2>
            <p class="order-description">
              Spend your crypto anywhere with our premium debit card. Convert and use your ADA instantly.
            </p>
            <v-btn class="order-card-btn" large :loading="orderingCard" @click="handleOrderCard">
              <v-icon left>mdi-credit-card-plus</v-icon>
              Order Your Card Now
            </v-btn>
          </div>
        </v-col>
      </v-row>
      <div class="card-layout">
        <!-- Card Carousel -->

        <!-- Balance Section -->
      </div>
    </v-card>

    <!-- Modals -->
    <ManageCardModal :open="showManageCardModal" @close="showManageCardModal = false" />
    <TopUpModal :open="showTopUpModal" @close="showTopUpModal = false" />

    <!-- Confirmation Modal -->
    <ConfirmationPasswordModal
      :open="showConfirmationModal"
      @close="showConfirmationModal = false"
      @confirm="toggleCardVisibility"
      :title="'View Card Details'"
      :subtitle="'View the details of your card. This action cannot be undone.'"
    />
    <!-- Confirmation Modal Manage Card-->
    <ConfirmationPasswordModal
      :open="showManageCardConfirmationModal"
      @close="showManageCardConfirmationModal = false"
      @confirm="showManageCardModal = true"
      :title="'Manage Card'"
      :subtitle="'Manage the details of your card. This action cannot be undone.'"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import ManageCardModal from './dashboard/ManageCardModal.vue';
import TopUpModal from './dashboard/TopUpModal.vue';
import cardStoreModule from '@/stores/modules/card';
import ConfirmationPasswordModal from './dashboard/ConfirmationPasswordModal.vue';

const currentCardIndex = ref(0);
const cardTiltStyle = ref<any>({});
const cardShineStyle = ref<any>({});
const showCardDetails = ref(false);
const showManageCardModal = ref(false);
const showTopUpModal = ref(false);
const showConfirmationModal = ref(false);
const showManageCardConfirmationModal = ref(false);
const orderingCard = ref(false);

// Get cards from the real card store
const cards = computed(() => {
  return cardStoreModule.state.cards || [];
});

// Cards array with empty slot at the end for ordering new card
const cardsWithOrderSlot = computed(() => {
  const emptyCard = {
    cardData: {
      id: null,
      card_uuid: null,
    },
    cardDetails: null,
    cardPin: null,
    cardNumber: null,
    cardBalance: null,
    cardHistory: null,
    totalDeposits: 0,
    activities: [],
  };
  return [...cards.value, emptyCard];
});

const handleOrderCard = async () => {
  try {
    orderingCard.value = true;
    await cardStoreModule.orderCard();
    await cardStoreModule.fetchCardData();
  } catch (error) {
    console.error('Failed to order card:', error);
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

// Update selected card when carousel index changes
watch(currentCardIndex, newIndex => {
  if (cards.value[newIndex]) {
    cardStoreModule.selectCard(cards.value[newIndex].cardData.card_uuid);
  }
});

// Card visibility toggle
const toggleCardVisibility = async () => {
  try {
    await cardStoreModule.fetchCardDetails(cardStoreModule.state.selectedCardId);
    showCardDetails.value = !showCardDetails.value;
  } catch (error) {
    console.error('Failed to fetch card details:', error);
  }
};

// Top up handler
const handleTopUp = () => {
  console.log('Top up clicked');
  showTopUpModal.value = true;
};

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

const getFormattedCardNumber = (card: any) => {
  const pan = card.cardDetails?.details?.pan;

  if (!pan) return '**** **** **** ****';

  if (showCardDetails.value) {
    // Show full number with spacing: 1234 5678 9012 3456
    return pan.match(/.{1,4}/g)?.join(' ') || pan;
  }

  // Format as: **** **** **** 1234 (masked)
  const lastFour = pan.slice(-4);
  return `**** **** **** ${lastFour}`;
};

const formatExpiryDate = (card: any) => {
  // Try to get expiry from card details first (format: "YYYY-MM")
  const apiExpiry = card.cardDetails?.details?.expiryDate;

  if (apiExpiry) {
    // Parse "2028-10" to "10/28"
    const [year, month] = apiExpiry.split('-');
    const shortYear = year.slice(-2);
    return `${month}/${shortYear}`;
  }

  // Fallback to creation date + 4 years
  if (card.cardData?.createdAt) {
    const date = new Date(card.cardData.createdAt);
    date.setFullYear(date.getFullYear() + 4);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${month}/${year}`;
  }

  return 'MM/YY';
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
  justify-content: center;
}

// Credit Card Styling
.credit-card {
  width: 35rem;
  aspect-ratio: 345 / 222;
  max-width: 90%;
  margin: 0 auto;
  background-image: url('@/modules/wallet/icons/card.svg');
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
  margin: 0 auto;
  text-align: center;
  padding: 32px;
  background: linear-gradient(135deg, rgba(12, 14, 18, 0.6) 0%, rgba(20, 24, 30, 0.6) 100%);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(0, 199, 243, 0.1), transparent);
    animation: shimmer 3s infinite;
  }

  .order-title {
    font-family: $font-family-primary;
    font-size: 2rem;
    font-weight: $font-weight-bold;
    color: $text-primary;
    margin: 0 0 16px 0;
    letter-spacing: -0.02em;
    position: relative;
    z-index: 1;
  }

  .order-description {
    font-family: $font-family-primary;
    font-size: $font-size-base;
    color: rgba($text-secondary, 0.9);
    margin: 0 0 32px 0;
    line-height: 1.6;
    max-width: 500px;
    margin-left: auto;
    margin-right: auto;
    position: relative;
    z-index: 1;
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
    padding: 12px 32px !important;
    height: auto !important;
    min-height: 52px;
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

// Waiting Status Card - Enhanced Design
.waiting-status-card {
  max-width: 600px;
  margin: 0 auto;
  position: relative;
  background: linear-gradient(135deg, rgba(12, 14, 18, 0.95) 0%, rgba(20, 24, 30, 0.95) 100%);
  border: 2px solid transparent !important;
  border-radius: 16px;
  backdrop-filter: blur(20px);
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(0, 199, 243, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  transition: all 0.3s ease;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(135deg, rgba(0, 199, 243, 0.1) 0%, rgba(0, 255, 209, 0.05) 100%);
    pointer-events: none;
  }

  &:hover {
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5), 0 0 0 2px rgba(0, 199, 243, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
    transform: translateY(-2px);
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
    gap: 20px;
    align-items: flex-start;
    padding: 24px !important;
    position: relative;
    z-index: 1;
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
  }

  .status-title-wrapper {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }

  .status-title {
    font-family: $font-family-primary;
    font-size: 1.125rem;
    font-weight: $font-weight-bold;
    color: $text-primary;
    margin: 0;
    letter-spacing: 0.02em;
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

  .status-subtitle {
    font-family: $font-family-primary;
    font-size: $font-size-sm;
    color: rgba($text-secondary, 0.9);
    line-height: 1.6;
    margin: 0;
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
