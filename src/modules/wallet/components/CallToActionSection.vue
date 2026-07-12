<template>
  <section class="call-to-action-section">
    <v-row>
      <!-- Left Column - 3D Card -->
      <v-col cols="12" md="6" class="card-column">
        <div class="card-container">
          <div
            class="credit-card"
            @mousemove="handleCardMouseMove"
            @mouseleave="handleCardMouseLeave"
            :style="cardTiltStyle"
          >
            <!-- Shine effect -->
            <div class="card-shine" :style="cardShineStyle"></div>
          </div>
        </div>
      </v-col>

      <!-- Right Column - KYC Info -->
      <v-col cols="12" md="6" class="kyc-column">
        <div class="kyc-content">
          <h2 class="cta-heading">{{ t('card.spendAdaAnywhere') }}</h2>
          <p class="cta-description">{{ t('card.beforeOrderingKYC') }}</p>
          <GradientButton v-if="kycStatus !== 'verified'" :text="t('card.startKYCProcess')" @click="startKYC" class="kyc-button" />
          <div class="kyc-status-text">
            {{ t('card.yourKYCStatus') }}
            <v-tooltip bottom :open-delay="300" content-class="custom-tooltip kyc-tooltip">
              <template v-slot:activator="{ on, attrs }">
                <b v-bind="attrs" v-on="on" class="kyc-status-hover">{{ filters.capitalize(kycStatus) }}</b>
              </template>
              <div class="tooltip-content">
                <div class="tooltip-item"><strong>{{ t('card.kycRegistered') }}:</strong> {{ t('card.kycRegisteredDesc') }}</div>
                <div class="tooltip-item"><strong>{{ t('card.kycVerificationStarted') }}:</strong> {{ t('card.kycVerificationStartedDesc') }}</div>
              </div>
            </v-tooltip>
          </div>
          <v-alert type="info" color="primary" prominent outlined v-if="!cardanoAddress && kycStatus === 'verified'" class="kyc-alert">
            {{ t('card.documentsReceivedReview') }}
          </v-alert>
        </div>
      </v-col>
    </v-row>
    <OrderCardModal :open="showModal" @close="showModal = false" />
  </section>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import GradientButton from './GradientButton.vue';
import OrderCardModal from './OrderCardModal.vue';
import { ref, computed } from 'vue';
import cardStore from '@/stores/modules/card';
import filters from '@/shared/utils/filters';

const { t } = useTranslation();

const showModal = ref(false);
const cardTiltStyle = ref<any>({});
const cardShineStyle = ref<any>({});

const kycStatus = computed(() => cardStore.state.walletStatus.kycStatus);
const cardanoAddress = computed(() => cardStore.state.cardanoAddress);

const startKYC = () => {
  cardStore.fetchKYCLink();
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
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';

.call-to-action-section {
  width: 100%;
  padding: 32px 0;
}

.card-column {
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-container {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
}

.kyc-column {
  display: flex;
  align-items: center;
  justify-content: center;
}

.kyc-content {
  width: 100%;
  max-width: 500px;
  display: flex;
  flex-direction: column;
  gap: 16px;
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
  transition: opacity var(--g-dur-fast) ease-out;
  z-index: 1;
}

.cta-heading {
  @include heading-style($font-size-3xl);
  margin: 0 0 $spacing-md 0;
  text-align: left;
}

.cta-description {
  @include body-text($font-size-xl);
  margin: 0 0 $spacing-2xl 0;
  text-align: left;
}

.kyc-button {
  margin-bottom: $spacing-sm;
}

.kyc-status-text {
  margin-top: $spacing-md;
  font-size: $font-size-base;
  color: $text-secondary;
}

.kyc-alert {
  border-radius: 16px !important;
  margin-top: $spacing-lg;

  :deep(.v-alert__icon) {
    align-self: center;
    min-width: 32px !important;
    width: 32px !important;
    height: 32px !important;
    padding: 0 !important;
  }

  :deep(.v-icon) {
    font-size: 18px !important;
    width: 32px !important;
    height: 32px !important;
    border-radius: 50% !important;
  }

  :deep(.v-alert__wrapper) {
    align-items: center;
  }
}

.kyc-status-hover {
  cursor: help;
  border-bottom: 1px dotted $primary-cyan;
  transition: color var(--g-dur-base) ease, border-color var(--g-dur-base) ease;

  &:hover {
    color: lighten($primary-cyan, 10%);
    border-bottom-color: lighten($primary-cyan, 10%);
  }
}

:deep(.kyc-tooltip) {
  opacity: 1 !important;

  .v-tooltip__content {
    max-width: 350px !important;
    padding: 12px 16px !important;
    background-color: rgba(0, 0, 0, 0.9) !important;
  }
}

.tooltip-content {
  font-size: $font-size-sm;
  line-height: 1.5;

  .tooltip-item {
    margin-bottom: 8px;

    &:last-child {
      margin-bottom: 0;
    }

    strong {
      color: $primary-cyan !important;
      font-weight: $font-weight-semibold;
    }
  }
}
</style>
