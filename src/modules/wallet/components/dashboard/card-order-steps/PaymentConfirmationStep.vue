<template>
  <div class="payment-confirmation">
    <div v-if="isLoading" class="confirmation-loading">
      <div class="loading-animation">
        <v-progress-circular indeterminate size="64" width="4" color="#00c7f3" />
      </div>
      <div class="loading-content">
        <h3 class="loading-title">{{ $t('card.confirmingPayment') }}</h3>
        <p class="loading-subtitle">{{ $t('card.mayTakeUpToOneMinute') }}</p>
      </div>
      <div class="loading-steps">
        <div class="step-item" :class="{ active: loadingStep >= 1, completed: loadingStep > 1 }">
          <v-icon small>{{ loadingStep > 1 ? 'mdi-check-circle' : 'mdi-clock-outline' }}</v-icon>
          <span>{{ $t('card.processingPayment') }}</span>
        </div>
        <div class="step-item" :class="{ active: loadingStep >= 2, completed: loadingStep > 2 }">
          <v-icon small>{{ loadingStep > 2 ? 'mdi-check-circle' : 'mdi-clock-outline' }}</v-icon>
          <span>{{ $t('card.verifyingTransaction') }}</span>
        </div>
        <div class="step-item" :class="{ active: loadingStep >= 3 }">
          <v-icon small>{{ loadingStep >= 3 ? 'mdi-check-circle' : 'mdi-clock-outline' }}</v-icon>
          <span>{{ $t('card.placingOrder') }}</span>
        </div>
      </div>
    </div>

    <!-- Success State -->
    <div v-else-if="isSuccess" class="confirmation-success">
      <div class="success-animation">
        <div class="success-circle">
          <v-icon large color="#00c7f3">mdi-check</v-icon>
        </div>
      </div>
      <div class="success-content">
        <h3 class="success-title">{{ $t('card.paymentConfirmed') }}</h3>
        <p class="success-subtitle">{{ $t('card.orderPlacedSuccessfully') }}</p>
      </div>
      <div class="success-details">
        <div class="detail-item">
          <v-icon small color="#00c7f3">mdi-truck-delivery-outline</v-icon>
          <span>{{ $t('card.estimatedDelivery') }}</span>
        </div>
        <div class="detail-item">
          <v-icon small color="#00c7f3">mdi-email-outline</v-icon>
          <span>{{ $t('card.confirmationEmailSent') }}</span>
        </div>
      </div>
      <div class="success-actions">
        <GradientButton :text="t('common.done')" @click="handleComplete" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import GradientButton from '../../GradientButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();

interface Props {
  isLoading: boolean;
  isSuccess: boolean;
}

interface Emits {
  (e: 'complete'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

// Loading step animation
const loadingStep = ref(1);
let stepInterval: NodeJS.Timeout | null = null;

// Start step animation when loading
const startStepAnimation = () => {
  loadingStep.value = 1;
  stepInterval = setInterval(() => {
    if (loadingStep.value < 3) {
      loadingStep.value++;
    }
  }, 1500);
};

// Stop step animation
const stopStepAnimation = () => {
  if (stepInterval) {
    clearInterval(stepInterval);
    stepInterval = null;
  }
};

// Watch loading state
watch(
  () => props.isLoading,
  newVal => {
    if (newVal) {
      startStepAnimation();
    } else {
      stopStepAnimation();
      loadingStep.value = 3;
    }
  },
  { immediate: true }
);

// Cleanup on unmount
onMounted(() => {
  if (props.isLoading) {
    startStepAnimation();
  }
});

onUnmounted(() => {
  stopStepAnimation();
});

// Handlers
const handleComplete = () => {
  emit('complete');
};
</script>

<style lang="scss" scoped>
@import '../../../styles/variables';
@import '../../../styles/mixins';

.payment-confirmation {
  width: 100%;
  min-height: 300px;
  @include flex-column;
  align-items: center;
  justify-content: center;
  padding: $spacing-xl 0;
}

// Loading State
.confirmation-loading {
  @include flex-column;
  align-items: center;
  gap: $spacing-2xl;
  text-align: center;
}

.loading-animation {
  margin-bottom: $spacing-md;
}

.loading-content {
  @include flex-column;
  gap: $spacing-xs;
}

.loading-title {
  font-family: $font-family-primary;
  font-weight: $font-weight-bold;
  font-size: $font-size-xl;
  color: $text-primary;
  margin: 0;
}

.loading-subtitle {
  font-family: $font-family-primary;
  font-size: $font-size-base;
  color: $text-muted;
  margin: 0;
}

.loading-steps {
  @include flex-column;
  gap: $spacing-md;
  padding: $spacing-lg;
  background: $background-card;
  border-radius: $border-radius-lg;
  min-width: 280px;
}

.step-item {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  font-family: $font-family-primary;
  font-size: $font-size-sm;
  color: $text-muted;
  transition: all 0.3s ease;

  .v-icon {
    color: $text-muted;
    transition: all 0.3s ease;
  }

  &.active {
    color: $text-secondary;

    .v-icon {
      color: $primary-cyan;
      animation: pulse 1s infinite;
    }
  }

  &.completed {
    color: $primary-cyan;

    .v-icon {
      color: $primary-cyan;
      animation: none;
    }
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

// Success State
.confirmation-success {
  @include flex-column;
  align-items: center;
  gap: $spacing-xl;
  text-align: center;
}

.success-animation {
  margin-bottom: $spacing-md;
}

.success-circle {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba($primary-cyan, 0.2) 0%, rgba($primary-green, 0.2) 100%);
  border: 3px solid $primary-cyan;
  @include flex-center;
  animation: scaleIn 0.5s ease-out;

  .v-icon {
    font-size: 40px !important;
  }
}

@keyframes scaleIn {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  50% {
    transform: scale(1.1);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.success-content {
  @include flex-column;
  gap: $spacing-xs;
}

.success-title {
  font-family: $font-family-primary;
  font-weight: $font-weight-bold;
  font-size: $font-size-2xl;
  color: $text-primary;
  margin: 0;
}

.success-subtitle {
  font-family: $font-family-primary;
  font-size: $font-size-base;
  color: $text-muted;
  margin: 0;
}

.success-details {
  @include flex-column;
  gap: $spacing-sm;
  padding: $spacing-lg;
  background: $background-card;
  border-radius: $border-radius-lg;
  min-width: 280px;
}

.detail-item {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  font-family: $font-family-primary;
  font-size: $font-size-sm;
  color: $text-secondary;
}

.success-actions {
  width: 100%;
  max-width: 280px;

  :deep(.gradient-button) {
    width: 100%;
    height: 44px;
    font-size: $font-size-base;
    font-weight: $font-weight-semibold;
    text-transform: none;
  }
}
</style>
