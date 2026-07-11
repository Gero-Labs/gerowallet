<template>
  <div class="card-carousel">
    <v-window
      v-model="localCardIndex"
      :show-arrows="cards.length > 1"
      continuous
    >
      <v-window-item
        v-for="(card, index) in cards"
        :key="card.cardData?.card_uuid || card.cardData?.order_uuid || `empty-${index}`"
        style="height: 280px"
      >
        <div
          class="credit-card"
          @mousemove="handleCardMouseMove"
          @mouseleave="handleCardMouseLeave"
          @click="$emit('card-click', card)"
          :style="cardTiltStyle"
        >
          <div class="card-shine" :style="cardShineStyle"></div>
          <div v-if="card.cardData.own_type" class="card-type-badge">{{ card.cardData.own_type }} Card</div>
          <p class="card-number">
            {{ getFormattedCardNumber(card) }}
          </p>

          <div class="card-bottom" style="max-width: 310px">
            <div class="card-holder">
              <p class="label"></p>
              <p class="value">{{ card.cardData.card_holder_name || $t('card.geroWallet') }}</p>
            </div>
            <div class="card-cvv">
              <p class="label">{{ $t('card.cvv') }}</p>
              <p class="value">
                {{ showCardDetails && card.cardDetails?.cvc2 ? card.cardDetails.cvc2 : '***' }}
              </p>
            </div>
            <div class="card-expiry">
              <p class="label">{{ $t('card.exp') }}</p>
              <p class="value">{{ formatExpiryDate(card) }}</p>
            </div>
          </div>
        </div>
      </v-window-item>
    </v-window>
    <div class="card-status-chip-container">
      <v-chip v-if="currentCardHasUUID" class="card-status-chip active-chip t-label" small>
        <v-icon small left>mdi-check-circle</v-icon>
        {{ $t('card.active') }}
      </v-chip>
      <v-chip
        v-else-if="isCurrentCardEmpty"
        class="card-status-chip order-chip t-label"
        small
      >
        <v-icon small left>mdi-credit-card-plus</v-icon>
        {{ $t('card.orderNewCard') }}
      </v-chip>
      <v-chip
        v-else-if="loadingOrderDetails && cards[currentCardIndex]?.cardData.id"
        class="card-status-chip loading-chip t-label"
        small
        style="width: 100px"
      >
        <v-progress-circular
          indeterminate
          size="12"
          width="2"
          color="primary"
        />
        &nbsp;&nbsp;{{ $t('card.loading') }}
      </v-chip>
      <v-chip
        v-else-if="cards[currentCardIndex]?.cardData.id && (normalizedCurrentCardStatus === 'rejected' || normalizedCurrentCardStatus === 'expired')"
        class="card-status-chip rejected-chip t-label"
        small
        style="width: 100px"
      >
        <v-icon small left>mdi-close-circle</v-icon>
        {{ normalizedCurrentCardStatus === 'expired' ? $t('card.expired') : $t('card.rejected') }}
      </v-chip>
      <v-chip
        v-else-if="cards[currentCardIndex]?.cardData.id && currentCardStatus === 'pending'"
        class="card-status-chip pending-chip t-label"
        small
        style="width: 100px"
      >
        <v-icon small left>mdi-clock-outline</v-icon>
        {{ $t('card.pending') }}
      </v-chip>
      <v-chip
        v-else-if="cards[currentCardIndex]?.cardData.id && currentCardStatus === 'new'"
        class="card-status-chip pending-chip t-label"
        small
      >
        <v-icon small left>mdi-clock-outline</v-icon>
        {{ $t('card.pending') }}
      </v-chip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, withDefaults } from 'vue';
import { CardInfo } from '@/models/card';
import cardStoreModule from '@/stores/modules/card';

interface Props {
  cards: CardInfo[];
  currentCardIndex: number;
  currentCardStatus?: string | null;
  currentCardHasUUID: boolean;
  showCardDetails: boolean;
  loadingOrderDetails?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  currentCardStatus: null,
  loadingOrderDetails: false,
});

const normalizeStatus = (status: string | null | undefined): string | null => {
  if (!status) return null;
  return status.toLowerCase();
};

const normalizedCurrentCardStatus = computed(() => {
  return normalizeStatus(props.currentCardStatus);
});

const isCurrentCardEmpty = computed(() => {
  const card = props.cards[props.currentCardIndex];
  return !card?.cardData?.id && !card?.cardData?.card_uuid && !card?.cardData?.order_uuid;
});

const localCardIndex = ref(props.currentCardIndex);

let isUpdatingFromProps = false;
let isUpdatingFromWindow = false;

watch(
  () => props.currentCardIndex,
  (newIndex) => {
    if (!isUpdatingFromWindow && localCardIndex.value !== newIndex) {
      isUpdatingFromProps = true;
      localCardIndex.value = newIndex;
      isUpdatingFromProps = false;
    }
  },
  { immediate: true }
);

watch(localCardIndex, (newIndex) => {
  if (!isUpdatingFromProps) {
    isUpdatingFromWindow = true;
    cardStoreModule.setCurrentCardIndex(newIndex);
    const card = props.cards[newIndex];
    if (card && card.cardData?.card_uuid) {
      cardStoreModule.selectCard(card.cardData.card_uuid);
    } else {
      cardStoreModule.selectCard(null);
    }
    isUpdatingFromWindow = false;
  }
});

const cardTiltStyle = ref<Record<string, string | number>>({});
const cardShineStyle = ref<Record<string, string | number>>({});

const getFormattedCardNumber = (card: CardInfo) => {
  const pan = card.cardDetails?.pan;

  if (!pan || !props.showCardDetails) return '**** **** **** ****';

  return pan.match(/.{1,4}/g)?.join(' ') || pan;
};

const formatExpiryDate = (card: CardInfo) => {
  if (!props.showCardDetails) {
    return '**/**';
  }

  const apiExpiry = card.cardDetails?.expiryDate;

  if (apiExpiry) {
    const [year, month] = apiExpiry.split('-');
    const shortYear = year.slice(-2);
    return `${month}/${shortYear}`;
  }

  if (card.cardData?.created_at) {
    const date = new Date(card.cardData.created_at);
    date.setFullYear(date.getFullYear() + 4);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${month}/${year}`;
  }

  return '**/**';
};

const handleCardMouseMove = (event: MouseEvent) => {
  const card = event.currentTarget as HTMLElement;
  const rect = card.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const centerX = rect.width / 2;
  const centerY = rect.height / 2;

  const rotateX = (y - centerY) / 20;
  const rotateY = (centerX - x) / 20;

  const percentX = (x / rect.width) * 100;
  const percentY = (y / rect.height) * 100;

  const glowOffsetX = rotateY * 2;
  const glowOffsetY = -rotateX * 2;

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
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.card-carousel {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 12px;
}

.card-status-chip-container {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  margin-top: -8px;
  min-height: 28px;
  height: 28px;
}

.card-status-chip {
  font-size: 0.75rem !important;
  font-weight: $font-weight-semibold;
  height: 28px !important;
  padding: 0 12px !important;
  border-radius: var(--g-r-pill) !important;

  &.active-chip {
    background: color-mix(in srgb, var(--g-accent) 20%, transparent) !important;
    border: 1px solid color-mix(in srgb, var(--g-accent) 40%, transparent) !important;
    color: var(--g-accent) !important;

    .v-icon {
      color: var(--g-accent) !important;
    }
  }

  &.pending-chip {
    background: var(--g-warning-fill) !important;
    border: 1px solid var(--g-warning-line) !important;
    color: var(--g-warning) !important;

    .v-icon {
      color: var(--g-warning) !important;
    }
  }

  &.inactive-chip {
    background: var(--g-raised) !important;
    border: 1px solid var(--g-hairline-2) !important;
    color: var(--g-text-3) !important;

    .v-icon {
      color: var(--g-text-3) !important;
    }
  }

  &.rejected-chip {
    background: var(--g-error-fill) !important;
    border: 1px solid var(--g-error-line) !important;
    color: var(--g-error) !important;

    .v-icon {
      color: var(--g-error) !important;
    }
  }

  &.order-chip {
    background: color-mix(in srgb, var(--g-accent) 20%, transparent) !important;
    border: 1px solid color-mix(in srgb, var(--g-accent) 40%, transparent) !important;
    color: var(--g-accent) !important;

    .v-icon {
      color: var(--g-accent) !important;
    }
  }

  &.loading-chip {
    background: var(--g-raised) !important;
    border: 1px solid var(--g-hairline-2) !important;
    color: var(--g-text-3) !important;
    display: flex;
    align-items: center;
    gap: 4px;

    .v-progress-circular {
      margin-right: 0 !important;
    }
  }
}

.credit-card {
  width: 35rem;
  aspect-ratio: 345 / 222;
  max-width: 90%;
  margin: 0 auto;
  background-image: url('@/assets/front_card_no_mcx2.png');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  border-radius: var(--g-r-sheet);
  padding: 2rem;
  color: var(--g-text-1);
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
  border-radius: var(--g-r-sheet);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.1s ease-out;
  z-index: 1;
}

.card-type-badge {
  position: relative;
  z-index: 2;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.08rem;
  text-transform: uppercase;
  color: var(--g-text-1);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}

.card-number {
  font-family: var(--g-font-mono);
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
      font-size: 0.6875rem;
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
