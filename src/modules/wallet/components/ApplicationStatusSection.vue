<template>
  <section class="application-status-section">
    <!-- Logout Button -->
    <v-btn
      icon
      class="logout-btn"
      @click="$emit('logout')"
      :title="$t('wallet.logout')"
    >
      <v-icon>mdi-logout</v-icon>
    </v-btn>

    <div class="status-content">
      <!-- Left: Card Visual with Animated Status -->
      <div class="card-visual-container">
        <div class="card-glow"></div>

        <!-- Animated Clock Rings - Centered on Card -->
        <div class="status-animation-container">
          <div class="icon-rings">
            <div class="ring ring-1"></div>
            <div class="ring ring-2"></div>
            <div class="ring ring-3"></div>
          </div>
          <div class="icon-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/>
              <path d="M12 7V12L15 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>

        <img :src="assets.frontCardNoMcx2" alt="Gero Card" class="card-image" />
      </div>

      <!-- Right: Status Information -->
      <div class="status-info">
        <!-- Main Content -->
        <div class="status-main">
          <h2 class="status-title">
            {{ isCardRejected ? $t('card.cardRejected') : (kycStatus === 'verified' ? $t('card.verification') : $t('card.reviewingApplication')) }}
          </h2>

          <p class="status-description">
            {{ isCardRejected ? $t('card.cardRejectedMessage') : (kycStatus === 'verified' ? $t('card.verificationDesc') : $t('card.reviewingApplicationDesc')) }}
          </p>
        </div>

        <!-- Progress Indicator -->
        <div class="progress-section">
          <div class="progress-steps">
            <div class="progress-step completed">
              <div class="step-icon">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M13.3334 4L6.00008 11.3333L2.66675 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <span class="step-label">{{ $t('card.kycRegistered') }}</span>
            </div>
            <div class="progress-line completed"></div>
            <div class="progress-step active">
              <div class="step-icon">
                <div class="step-pulse"></div>
              </div>
              <span class="step-label">{{ $t('card.kycVerificationStarted') }}</span>
            </div>
            <div class="progress-line"></div>
            <div class="progress-step">
              <div class="step-icon empty">
                <span>3</span>
              </div>
              <span class="step-label">{{ $t('card.orderYourCard') }}</span>
            </div>
          </div>
        </div>

        <!-- Contact Support -->
        <div class="support-section">
          <p class="support-text">
            {{ $t('card.pleaseContact') }}
            <a href="mailto:support@kaiserex.com" class="support-link">support@kaiserex.com</a>
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import assets from '@/utils/assets';

interface Props {
  kycStatus?: string;
  isCardRejected?: boolean;
}

withDefaults(defineProps<Props>(), {
  kycStatus: 'verification_started',
  isCardRejected: false
});

defineEmits(['logout']);
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';

.application-status-section {
  padding: $spacing-3xl $spacing-2xl;
  border-radius: $border-radius-xl;
  border: 1px solid rgba($primary-cyan, 0.15);
  background: linear-gradient(135deg, rgba($primary-cyan, 0.08) 0%, $background-dark 25%, $background-dark 100%);
  position: relative;
  overflow: visible;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba($primary-cyan, 0.5), transparent);
  }
}

// Logout Button
.logout-btn {
  position: absolute;
  top: $spacing-lg;
  right: $spacing-lg;
  background: rgba(255, 255, 255, 0.05) !important;
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: all 0.2s ease;
  z-index: 10;

  &:hover {
    background: rgba(255, 77, 77, 0.15) !important;
    border-color: rgba(255, 77, 77, 0.3);
  }

  :deep(.v-icon) {
    color: $text-secondary;
  }

  &:hover :deep(.v-icon) {
    color: #ff4d4d;
  }
}

.status-content {
  display: flex;
  align-items: center;
  gap: 56px;
  position: relative;
  z-index: 1;
}

// Card Visual Styles
.card-visual-container {
  position: relative;
  flex-shrink: 0;
  padding: 0 $spacing-2xl;
}

.card-glow {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 300px;
  height: 200px;
  background: radial-gradient(ellipse, rgba($primary-cyan, 0.15) 0%, transparent 70%);
  filter: blur(40px);
  pointer-events: none;
}

.card-image {
  position: relative;
  z-index: 1;
  max-width: 380px;
  height: auto;
  filter: drop-shadow(0 20px 40px rgba(0, 0, 0, 0.4));
  transition: transform 0.3s ease;

  &:hover {
    transform: translateY(-4px) scale(1.02);
  }
}

// Animated Clock Rings - Centered on Card
.status-animation-container {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 100px;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
}

.icon-rings {
  position: absolute;
  inset: 0;

  .ring {
    position: absolute;
    border-radius: 50%;
    border: 1px solid rgba($primary-cyan, 0.2);

    &.ring-1 {
      inset: 0;
      animation: ring-pulse 3s ease-in-out infinite;
    }

    &.ring-2 {
      inset: 10px;
      animation: ring-pulse 3s ease-in-out infinite 0.5s;
    }

    &.ring-3 {
      inset: 20px;
      animation: ring-pulse 3s ease-in-out infinite 1s;
    }
  }
}

@keyframes ring-pulse {
  0%, 100% {
    border-color: rgba($primary-cyan, 0.1);
    transform: scale(1);
  }
  50% {
    border-color: rgba($primary-cyan, 0.4);
    transform: scale(1.02);
  }
}

.icon-center {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba($primary-cyan, 0.15) 0%, rgba($primary-cyan, 0.05) 100%);
  border: 1px solid rgba($primary-cyan, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: $primary-cyan;
  animation: icon-glow 3s ease-in-out infinite;
}

@keyframes icon-glow {
  0%, 100% {
    box-shadow: 0 0 20px rgba($primary-cyan, 0.1);
  }
  50% {
    box-shadow: 0 0 30px rgba($primary-cyan, 0.25);
  }
}

// Status Info Styles
.status-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: $spacing-xl;
  max-width: 600px;
}

.status-main {
  display: flex;
  flex-direction: column;
  gap: $spacing-md;
}

.status-title {
  font-family: $font-family-primary;
  font-size: 28px;
  font-weight: $font-weight-bold;
  color: $text-primary;
  margin: 0;
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.status-description {
  font-family: $font-family-primary;
  font-size: $font-size-base;
  font-weight: $font-weight-normal;
  color: $text-secondary;
  margin: 0;
  line-height: 1.6;
}

// Progress Section
.progress-section {
  padding: $spacing-xl 0;
  border-top: 1px solid rgba($border-secondary, 0.5);
  border-bottom: 1px solid rgba($border-secondary, 0.5);
}

.progress-steps {
  display: flex;
  align-items: center;
  gap: 0;
}

.progress-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $spacing-sm;
  flex: 1;

  .step-icon {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: $background-secondary;
    border: 2px solid $border-primary;
    display: flex;
    align-items: center;
    justify-content: center;
    color: $text-muted;
    font-size: $font-size-sm;
    font-weight: $font-weight-semibold;
    position: relative;

    &.empty span {
      color: $text-muted;
    }
  }

  .step-label {
    font-family: $font-family-primary;
    font-size: $font-size-xs;
    font-weight: $font-weight-medium;
    color: $text-muted;
    text-align: center;
    max-width: 100px;
  }

  &.completed {
    .step-icon {
      background: $primary-cyan;
      border-color: $primary-cyan;
      color: $background-dark;
    }

    .step-label {
      color: $text-primary;
    }
  }

  &.active {
    .step-icon {
      background: rgba($primary-cyan, 0.15);
      border-color: $primary-cyan;
      color: $primary-cyan;
    }

    .step-label {
      color: $primary-cyan;
      font-weight: $font-weight-semibold;
    }

    .step-pulse {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: $primary-cyan;
      animation: pulse-glow 2s ease-in-out infinite;
    }
  }
}

.progress-line {
  flex: 0.5;
  height: 2px;
  background: $border-primary;
  margin-bottom: 28px;

  &.completed {
    background: $primary-cyan;
  }
}

@keyframes pulse-glow {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba($primary-cyan, 0.4);
  }
  50% {
    opacity: 0.8;
    transform: scale(1.1);
    box-shadow: 0 0 0 8px rgba($primary-cyan, 0);
  }
}

// Support Section
.support-section {
  padding-top: $spacing-md;
}

.support-text {
  font-family: $font-family-primary;
  font-size: $font-size-sm;
  font-weight: $font-weight-normal;
  color: $text-muted;
  margin: 0;
  line-height: 1.5;
}

.support-link {
  color: $primary-cyan;
  text-decoration: none;
  font-weight: $font-weight-medium;
  transition: all 0.2s ease;

  &:hover {
    text-decoration: underline;
    color: lighten($primary-cyan, 10%);
  }
}

// Responsive Design
@media (max-width: $breakpoint-lg) {
  .status-content {
    flex-direction: column;
    gap: $spacing-4xl;
    text-align: center;
  }

  .card-visual-container {
    order: -1;
    padding: 0 $spacing-xl;
  }

  .card-image {
    max-width: 320px;
  }

  .status-info {
    align-items: center;
    max-width: 100%;
  }

  .progress-steps {
    flex-wrap: nowrap;
  }

  .progress-step .step-label {
    font-size: 11px;
    max-width: 80px;
  }

  .support-section {
    text-align: center;
  }
}

@media (max-width: $breakpoint-md) {
  .application-status-section {
    padding: $spacing-2xl $spacing-lg;
  }

  .logout-btn {
    top: $spacing-lg;
    right: $spacing-lg;
  }

  .card-visual-container {
    padding: 0 $spacing-lg;
  }

  .card-image {
    max-width: 280px;
  }

  .status-animation-container {
    width: 80px;
    height: 80px;
  }

  .icon-center {
    width: 48px;
    height: 48px;

    svg {
      width: 24px;
      height: 24px;
    }
  }

  .icon-rings .ring {
    &.ring-2 {
      inset: 8px;
    }

    &.ring-3 {
      inset: 16px;
    }
  }

  .status-title {
    font-size: $font-size-2xl;
  }

  .progress-section {
    padding: $spacing-lg 0;
  }

  .progress-steps {
    gap: $spacing-xs;
  }

  .progress-step {
    .step-icon {
      width: 28px;
      height: 28px;
    }

    .step-label {
      font-size: 10px;
      max-width: 70px;
    }
  }

  .progress-line {
    margin-bottom: 24px;
  }
}

@media (max-width: $breakpoint-sm) {
  .application-status-section {
    padding: $spacing-xl $spacing-md;
  }

  .logout-btn {
    top: $spacing-md;
    right: $spacing-md;
  }

  .card-visual-container {
    padding: 0 $spacing-md;
  }

  .status-animation-container {
    width: 70px;
    height: 70px;
  }

  .icon-center {
    width: 42px;
    height: 42px;

    svg {
      width: 20px;
      height: 20px;
    }
  }

  .icon-rings .ring {
    &.ring-2 {
      inset: 7px;
    }

    &.ring-3 {
      inset: 14px;
    }
  }

  .card-image {
    max-width: 240px;
  }

  .status-title {
    font-size: $font-size-xl;
  }

  .status-description {
    font-size: $font-size-sm;
  }

  .progress-steps {
    flex-direction: column;
    gap: $spacing-md;
  }

  .progress-line {
    width: 2px;
    height: 20px;
    flex: none;
    margin-bottom: 0;
  }

  .progress-step .step-label {
    max-width: 100%;
  }
}
</style>
