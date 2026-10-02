<template>
  <div class="kaiserex-auth-page">
    <div class="auth-container">
      <!-- Header -->
      <div class="auth-header">
        <h1 class="page-title">{{ t('card.getYourGeroCryptoCard') }}</h1>
        <p class="page-description">{{ t('card.chooseOptionBelow') }}</p>
      </div>

      <!-- Auth Options Grid (3 columns) -->
      <div class="auth-options">
        <!-- Card Management Option (moved to first position) -->
        <div class="auth-option management-option liquid-glass-card">
          <div class="default-card-view">
            <div class="option-icon">
              <img src="@/assets/front_card_no_mcx2.png" alt="card" class="card-image" />
            </div>

            <div class="option-content">
              <h3 class="option-title">{{ t('card.getCardInSteps') }}</h3>

              <div class="option-features steps-list">
                <div class="feature-item">
                  <span class="step-number-inline">1.</span>
                  <span class="feature-text">{{ t('card.registerOnKaiserex') }}</span>
                </div>
                <div class="feature-item">
                  <span class="step-number-inline">2.</span>
                  <span class="feature-text">{{ t('card.activateViaEmail') }}</span>
                </div>
                <div class="feature-item">
                  <span class="step-number-inline">3.</span>
                  <span class="feature-text">{{ t('card.signInCompleteKYC') }}</span>
                </div>
                <div class="feature-item">
                  <span class="step-number-inline">4.</span>
                  <span class="feature-text">{{ t('card.onceApprovedOrder') }}</span>
                </div>
              </div>

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
                <div class="option-features promo-list">
                  <div class="feature-item">
                    <v-icon class="feature-icon">mdi-check-circle</v-icon>
                    <span class="feature-text">{{ t('card.zeroMonthlyFees') }}</span>
                  </div>
                  <div class="feature-item">
                    <v-icon class="feature-icon">mdi-check-circle</v-icon>
                    <span class="feature-text">{{ t('card.zeroAdaEurFees') }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Register Option -->
        <div class="auth-option register-option liquid-glass-card">
          <div class="default-card-view">
            <div class="option-icon">
            <div class="icon-circle new-user">
              <v-icon>mdi-account-plus</v-icon>
            </div>
          </div>

          <div class="option-content">
            <h3 class="option-title">{{ t('card.registerToOrderCard') }}</h3>
            <p class="option-description">
              {{ t('card.createKaiserexAccount') }}
            </p>
          </div>

          <div class="option-action">
            <p class="new-to-kaiserex">
              {{ t('card.newToKaiserex') }}
              <v-tooltip top :open-delay="300" content-class="custom-tooltip">
                <template v-slot:activator="{ on, attrs }">
                  <span v-bind="attrs" v-on="on" class="kaiserex-hover">{{ t('card.kaiserex') }}</span>
                </template>
                <div class="tooltip-content">
                  {{ t('card.kaiserexTooltip') }}
                </div>
              </v-tooltip>?
            </p>
            <GradientButton
              :text="t('card.orderYourGeroCard')"
              @click="handleRegister"
              class="full-width"
            />
          </div>
          </div>
        </div>

        <!-- Login Option -->
        <div class="auth-option login-option liquid-glass-card">
          <!-- Default Login Card View -->
          <div class="default-card-view">
            <div class="option-icon">
              <div class="icon-circle existing-user">
                <v-icon>mdi-account-check</v-icon>
              </div>
            </div>

            <div class="option-content">
              <h3 class="option-title">{{ t('card.alreadyHaveAccount') }}</h3>
              <p class="option-description">
                {{ t('card.signInTopUpCheck') }}
              </p>

              <div class="option-features">
                <div class="feature-item">
                  <v-icon class="feature-icon">mdi-check-circle</v-icon>
                  <span class="feature-text">{{ t('card.checkOrderStatus') }}</span>
                </div>
                <div class="feature-item">
                  <v-icon class="feature-icon">mdi-check-circle</v-icon>
                  <span class="feature-text">{{ $t('card.topUpCardWithAda') }}</span>
                </div>
                <div class="feature-item">
                  <v-icon class="feature-icon">mdi-check-circle</v-icon>
                  <span class="feature-text">{{ t('card.orderAdditionalCards') }}</span>
                </div>
              </div>
            </div>

            <div class="option-action">
              <SecondaryButton
                :text="kaiserExLoading ? t('card.signingIn') : t('card.signIn')"
                :disabled="kaiserExLoading"
                @click="handleLogin"
                class="full-width gradient-text-button"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Kaiserex Partnership Info -->
      <KaiserexPartnershipSection />
    </div>

    <!-- Modals -->
    <KaiserexRegistrationModal
      :open="showRegistrationModal"
      @close="showRegistrationModal = false"
      @complete="handleRegistrationComplete"
    />
    <PromotionModal :open="showPromotionModal" @close="showPromotionModal = false" />
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref } from 'vue';
import GradientButton from './GradientButton.vue';
import SecondaryButton from './SecondaryButton.vue';
import KaiserexRegistrationModal from './KaiserexRegistrationModal.vue';
import PromotionModal from './PromotionModal.vue';
import KaiserexPartnershipSection from './KaiserexPartnershipSection.vue';
import { receiveKaiserExToken } from '@/services/kaiserEx.service';
import cardStore from '@/stores/modules/card';
import { debugLog } from '@/utils/debug';

const { t } = useTranslation();
const emit = defineEmits<{
  (e: 'auth-complete'): void;
}>();

const showRegistrationModal = ref(false);
const showPromotionModal = ref(false);
const kaiserExLoading = ref(false);

const handleRegister = () => {
  showRegistrationModal.value = true;
};

const handleLogin = async () => {
  try {
    kaiserExLoading.value = true;

    await receiveKaiserExToken(async tokenData => {
      try {
        await cardStore.setKaiserExTokens(tokenData);
        kaiserExLoading.value = false;
        emit('auth-complete');
      } catch (error) {
        console.error('❌ Failed to store card session:', error instanceof Error ? error.message : error);
        kaiserExLoading.value = false;
      }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage === 'Authentication window was closed by user') {
      debugLog('Card sign-in cancelled by user');
    } else {
      console.error('❌ Card sign-in failed:', errorMessage);
    }
    kaiserExLoading.value = false;
  }
};

const handleRegistrationComplete = () => {
  showRegistrationModal.value = false;
  emit('auth-complete');
};
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';

.kaiserex-auth-page {
  display: flex;
  align-items: flex-start; // Changed from center to flex-start
  justify-content: center;
  padding-top: $spacing-2xl; // Reduced top padding
  padding-left: $spacing-xl;
  padding-right: $spacing-xl;
  padding-bottom: $spacing-xl;
  position: relative;

  // Background image with blend mode
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-image: url('@/assets/emptyStateNew.png');
    background-size: 100%;
    background-position: center center;
    background-repeat: no-repeat;
    mix-blend-mode: screen; // Creates a lighter, more ethereal effect
    z-index: 0;
  }
}

.auth-container {
  max-width: 1400px;
  width: 100%;
  position: relative;
  z-index: 1; // Above the background
  margin-top: $spacing-xl; // Add some top margin for better spacing
}

.auth-header {
  text-align: center;
  margin-bottom: $spacing-4xl; // Increased back to original spacing
}

.page-title {
  @include heading-style($font-size-3xl);
  color: $text-primary;
  margin: 0 0 $spacing-md 0;
}

.page-description {
  @include body-text($font-size-lg);
  color: $text-secondary;
  margin: 0;
  margin-left: auto;
  margin-right: auto;
  white-space: nowrap;
}

.auth-options {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: $spacing-2xl;
  margin-bottom: $spacing-4xl;

  @media (max-width: 1400px) {
    grid-template-columns: 1fr;
    gap: $spacing-2xl;
  }
}

.auth-option {
  background: $background-card;
  border: 1px solid $border-secondary;
  border-radius: $border-radius-xl;
  padding: 24px; // Reduced further for compactness
  display: flex;
  flex-direction: column;
  transition: background-color var(--g-dur-slow) ease, border-color var(--g-dur-slow) ease;
  position: relative;
  overflow: hidden;
  min-height: 480px; // Fixed height for consistency

  &:hover {
    border-color: color-mix(in srgb, var(--g-accent) 30%, transparent);
  }

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, var(--g-grad-1) 0%, var(--g-grad-2) 100%);
    opacity: 0;
    transition: opacity var(--g-dur-slow) ease;
  }

  &:hover::before {
    opacity: 1;
  }
}

// Liquid glass effect for cards - using the same style as dialogStyle
.liquid-glass-card {
  -webkit-backdrop-filter: blur(12px) brightness(0.2) !important;
  backdrop-filter: blur(12px) !important;
  background: #000000ab !important;
  border: solid 2px #ffffff44 !important;

  &:hover {
    background: #000000bb !important;
    border-color: rgba(0, 199, 243, 0.4) !important;
    -webkit-backdrop-filter: blur(15px) brightness(0.3) !important;
    backdrop-filter: blur(15px) !important;
  }
}

.option-icon {
  display: flex;
  justify-content: center;
  margin-top: 40px; // Position icon between top and header
  margin-bottom: 30px; // Space before header

  .card-image {
    width: 120px;
    height: auto;
  }
}

.icon-circle {
  width: 72px; // Reduced from 80px
  height: 72px; // Reduced from 80px
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;

  .v-icon {
    font-size: 32px; // Reduced from 36px
  }

  &.new-user {
    background: color-mix(in srgb, var(--g-accent) 10%, transparent);
    color: $primary-cyan;
  }

  &.existing-user {
    background: var(--g-hairline-2);
    color: $text-secondary;
  }
}

.option-content {
  flex: 1;
  text-align: center;
  display: flex;
  flex-direction: column;
  justify-content: flex-start; // Align headers at same position
}

.option-title {
  @include heading-style($font-size-xl);
  color: $text-primary;
  margin: 0 0 $spacing-sm 0; // Reduced from $spacing-md
}

.option-description {
  @include body-text($font-size-base);
  color: $text-secondary; // Slightly off-white color (same as management description)
  margin: 0 0 $spacing-md 0; // Reduced from $spacing-lg
  line-height: 1.6;
}

.new-to-kaiserex {
  @include body-text($font-size-sm);
  color: $text-secondary;
  margin: 0 0 $spacing-sm 0;
  text-align: center;
}

.option-steps {
  display: flex;
  justify-content: center;
  gap: $spacing-lg;
}

.step-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $spacing-xs;
}

.step-number {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--g-accent) 20%, transparent);
  color: $primary-cyan;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: $font-size-sm;
  font-weight: $font-weight-semibold;
}

.step-text {
  @include text-style($font-size-xs, $font-weight-medium, $line-height-normal);
  color: $text-muted;
  text-align: center;
}

.option-features {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
}

.feature-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: $spacing-sm;
}

.feature-icon {
  font-size: 16px;
  color: color-mix(in srgb, var(--g-accent) 70%, transparent);
}

.feature-text {
  @include body-text($font-size-sm);
  color: $text-secondary;
}

.step-number-inline {
  @include text-style($font-size-sm, $font-weight-semibold);
  color: $primary-cyan;
  min-width: 20px;
}

.steps-list {
  margin-bottom: $spacing-lg;

  .feature-item {
    justify-content: flex-start;
    text-align: left;
  }
}

.promo-section {
  margin-top: $spacing-lg;
  padding-top: $spacing-lg;
  border-top: 1px solid var(--g-hairline-2);

  .promo-title {
    @include text-style($font-size-base, $font-weight-semibold);
    color: $text-primary;
    text-align: center;
    margin: 0 0 $spacing-md 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    cursor: pointer;

    .clickable-text {
      color: $primary-cyan;
      border-bottom: 1px dotted $primary-cyan;
      transition: color var(--g-dur-base) ease, border-bottom-color var(--g-dur-base) ease;
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
      transition: color var(--g-dur-base) ease;
    }
  }

  .promo-list {
    .feature-item {
      justify-content: center;
    }
  }
}

.option-action {
  margin-top: auto;
  flex-shrink: 0;
  width: 100%;

  .gradient-button,
  .secondary-button,
  :deep(.gradient-button),
  :deep(.secondary-button) {
    width: 100% !important;
    height: 48px;
    font-size: $font-size-base;
    font-weight: $font-weight-semibold;
  }
}

.full-width {
  width: 100%;

  :deep(.gradient-button),
  :deep(.secondary-button) {
    width: 100% !important;
    height: 48px;
    font-size: $font-size-base;
    font-weight: $font-weight-semibold;
  }
}

.gradient-text-button {
  :deep(.button-text) {
    background: linear-gradient(135deg, var(--g-grad-1) 0%, var(--g-grad-2) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    font-weight: $font-weight-semibold;
  }
}

// Responsive Design
@media (max-width: $breakpoint-lg) {
  .auth-options {
    grid-template-columns: 1fr;
    gap: $spacing-2xl;
  }

  .auth-option {
    padding: $spacing-2xl;
  }
}

@media (max-width: $breakpoint-md) {
  .kaiserex-auth-page {
    padding: $spacing-lg;
  }

  .page-title {
    font-size: $font-size-2xl;
  }

  .auth-option {
    padding: $spacing-xl;
  }

  .option-steps {
    flex-direction: column;
    gap: $spacing-md;
  }
}

// Kaiserex hover tooltip styling
.kaiserex-hover {
  color: $primary-cyan;
  cursor: help;
  border-bottom: 1px dotted $primary-cyan;
  transition: color var(--g-dur-base) ease, border-bottom-color var(--g-dur-base) ease;

  &:hover {
    color: lighten($primary-cyan, 10%);
    border-bottom-color: lighten($primary-cyan, 10%);
  }
}

// Tooltip content styling
.tooltip-content {
  font-size: $font-size-sm;
  line-height: 1.5;

  strong {
    color: $primary-cyan;
    font-weight: $font-weight-semibold;
  }
}

// Card view consistency
.default-card-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  justify-content: space-between; // Distribute content evenly
}
</style>
