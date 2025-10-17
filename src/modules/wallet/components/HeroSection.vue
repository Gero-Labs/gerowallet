<template>
  <div class="hero-section">
    <!-- Card Carousel and Balance Section -->
    <v-card v-if="cards.length > 0" flat class="transparent">
      <v-row>
        <v-col cols="12" md="7" class="py-0" style="align-content: center; justify-items: center">
          <div class="card-carousel">
            <v-window v-model="currentCardIndex" :show-arrows="cards.length > 1" continuous>
              <v-window-item v-for="card in cards" :key="card.cardData.card_uuid">
                <div
                  class="credit-card"
                  @mousemove="handleCardMouseMove"
                  @mouseleave="handleCardMouseLeave"
                  @click="showManageCardConfirmationModal = true"
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
        <v-col cols="12" md="5" class="py-0" style="align-content: center; justify-items: center">
          <div class="balance-section">
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
        </v-col>
      </v-row>
      <div class="card-layout">
        <!-- Card Carousel -->

        <!-- Balance Section -->
      </div>
    </v-card>

    <!-- No Cards State -->
    <div v-else class="no-cards">
      <img src="@/modules/wallet/icons/cardBanner.svg" alt="card-banner" class="card-banner" />
      <p class="no-cards-text">No cards available</p>
    </div>

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

// Get cards from the real card store
const cards = computed(() => {
  return cardStoreModule.state.cards || [];
});

// Get exchange rate from store (fallback to mock rate if not available)
const exchangeRate = computed(() => {
  return cardStoreModule.state.exchangeRate?.sell ? parseFloat(cardStoreModule.state.exchangeRate.sell) : 0.35;
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
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $spacing-md;
  padding: $spacing-lg;

  .card-banner {
    object-fit: contain;
    width: 100%;
    max-width: 400px;
    height: auto;
  }

  .no-cards-text {
    font-family: $font-family-primary;
    font-size: $font-size-base;
    color: $text-secondary;
    margin: 0;
  }
}

@media (max-width: $breakpoint-md) {
  .credit-card {
    width: 30rem;
  }
}

@media (max-width: 425px) {
  .credit-card {
    width: 28rem;
  }
}
</style>
