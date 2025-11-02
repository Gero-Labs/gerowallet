<template>
  <div class="progress-section">
    <div class="progress-container">
      <div class="progress-lines">
        <div class="progress-line" :class="{ active: currentStep >= 2 }"></div>
        <div class="progress-line" :class="{ active: currentStep >= 3 }"></div>
      </div>

      <!-- Step 1: Your Details -->
      <div class="step-item">
        <div class="step-icon" :class="{ active: currentStep >= 1 }">
          <div class="step-dot"></div>
        </div>
        <span class="step-text">{{ $t('card.yourDetails') }}</span>
      </div>

      <!-- Step 2: Take a selfie -->
      <div class="step-item">
        <div class="step-icon" :class="{ active: currentStep >= 2 }">
          <div class="step-dot"></div>
        </div>
        <span class="step-text">{{ $t('card.takeASelfie') }}</span>
      </div>

      <!-- Step 3: Pending Approval -->
      <div class="step-item">
        <div class="step-icon" :class="{ active: currentStep >= 3 }">
          <div class="step-dot"></div>
        </div>
        <span class="step-text">{{ $t('card.pendingApproval') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  currentStep: number;
}

defineProps<Props>();
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.progress-section {
  margin-bottom: $spacing-lg;
}

.progress-container {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: $spacing-lg;
  width: 501px;
  margin: 0 auto;
}

.progress-lines {
  position: absolute;
  top: 11px;
  height: 2px;
  display: flex;
  gap: 0;
}

.progress-line {
  width: 165px;
  height: 2px;
  background: $border-primary;
}

.progress-line.active {
  background: $primary-gradient;
}

.step-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $spacing-md;
  width: 172px;
}

.step-icon {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: $background-card;
  border: 1.5px solid $border-secondary;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: $text-muted;
}

.step-icon.active .step-dot {
  background: $text-primary;
}

.step-icon.active {
  background: $primary-cyan;
}

.step-text {
  @include text-style($font-size-sm, $font-weight-semibold);
  color: $text-secondary;
  text-align: center;
}

@media (max-width: $breakpoint-md) {
  .progress-container {
    width: 100%;
    gap: $spacing-sm;
  }

  .step-item {
    width: auto;
  }

  .progress-lines {
    display: none;
  }
}
</style> 