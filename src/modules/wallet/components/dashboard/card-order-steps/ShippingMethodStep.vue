<template>
  <div class="shipping-method-selection">
    <!-- Shipping Options -->
    <div class="shipping-options">
      <div
        v-for="option in shippingOptions"
        :key="option.id"
        class="shipping-option"
        :class="{ selected: localSelectedMethod === option.id, disabled: option.disabled }"
        @click="!option.disabled && selectMethod(option.id)"
        @keydown.enter="!option.disabled && selectMethod(option.id)"
        @keydown.space.prevent="!option.disabled && selectMethod(option.id)"
        role="button"
        :tabindex="option.disabled ? -1 : 0"
      >
        <div class="option-left">
          <div class="option-icon">
            <v-icon>{{ option.icon }}</v-icon>
          </div>
          <div class="option-content">
            <h4 class="option-title">
              {{ option.label }}
              <span v-if="option.disabled" class="disabled-badge">{{ $t('common.comingSoon') }}</span>
            </h4>
            <p class="option-description">{{ option.description }}</p>
          </div>
        </div>
        <div class="option-right">
          <span class="option-price" :class="{ muted: option.disabled }">{{ option.price }}</span>
          <div class="selection-indicator">
            <v-icon v-if="!option.disabled && localSelectedMethod === option.id" color="#00c7f3">mdi-check-circle</v-icon>
            <v-icon v-else color="#373a41">mdi-circle-outline</v-icon>
          </div>
        </div>
      </div>
    </div>

    <!-- Cost Summary -->
    <div class="cost-summary">
      <div class="summary-row">
        <span class="summary-label">{{ $t('card.shippingFee') }}</span>
        <span class="summary-value">{{ selectedOptionPrice }}</span>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-row total">
        <span class="summary-label">{{ $t('card.total') }}</span>
        <span class="summary-value">{{ selectedOptionPrice }}</span>
      </div>
    </div>

    <!-- Actions -->
    <div class="step-actions">
      <SecondaryButton :text="$t('card.back')" @click="handleBack" :disabled="isLoading" />
      <GradientButton 
        :text="$t('card.continueButton')" 
        @click="handleContinue"
        :loading="isLoading"
        :disabled="isLoading"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import SecondaryButton from '../../SecondaryButton.vue';
import GradientButton from '../../GradientButton.vue';

type ShippingMethod = 'regular' | 'express-eu' | 'express-worldwide';

interface Props {
  selectedMethod: ShippingMethod;
  isLoading?: boolean;
}

interface Emits {
  (e: 'back'): void;
  (e: 'select', method: ShippingMethod): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const { t } = useTranslation();

// Local state
const localSelectedMethod = ref<ShippingMethod>(props.selectedMethod);

// Shipping options configuration
const shippingOptions = computed(() => [
  {
    id: 'regular' as ShippingMethod,
    label: t('card.standardShipping'),
    description: t('card.euOrWorldwide'),
    price: '\u20AC10.00',
    icon: 'mdi-truck-delivery-outline',
    disabled: false,
  },
  {
    id: 'express-eu' as ShippingMethod,
    label: t('card.expressShippingEU'),
    description: t('card.expressShippingEUTime'),
    price: t('card.priceNotAvailable'),
    icon: 'mdi-truck-fast-outline',
    disabled: true,
  },
  {
    id: 'express-worldwide' as ShippingMethod,
    label: t('card.expressShippingWorldwide'),
    description: t('card.expressShippingWorldwideTime'),
    price: t('card.priceNotAvailable'),
    icon: 'mdi-airplane',
    disabled: true,
  },
]);

// Get selected option price
const selectedOptionPrice = computed(() => {
  const option = shippingOptions.value.find(o => o.id === localSelectedMethod.value);
  return option?.price || '\u20AC10.00';
});

// Watch for prop changes
watch(
  () => props.selectedMethod,
  newVal => {
    localSelectedMethod.value = newVal;
  }
);

// Handlers
const selectMethod = (method: ShippingMethod) => {
  localSelectedMethod.value = method;
};

const handleBack = () => {
  emit('back');
};

const handleContinue = () => {
  emit('select', localSelectedMethod.value);
};
</script>

<style lang="scss" scoped>
@import '../../../styles/variables';
@import '../../../styles/mixins';

.shipping-method-selection {
  width: 100%;
  @include flex-column;
  gap: $spacing-xl;
}

.shipping-options {
  @include flex-column;
  gap: $spacing-md;
}

.shipping-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: $spacing-lg;
  background: $background-card;
  border: 2px solid $border-primary;
  border-radius: $border-radius-lg;
  cursor: pointer;
  transition: all 0.3s ease;

  &:hover {
    border-color: rgba($primary-cyan, 0.5);
    background: rgba($primary-cyan, 0.05);
  }

  &.selected {
    border-color: $primary-cyan;
    background: rgba($primary-cyan, 0.1);
  }

  &:focus {
    outline: none;
    border-color: $primary-cyan;
  }

  &.disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;

    &:hover {
      border-color: $border-primary;
      background: $background-card;
    }
  }
}

.option-left {
  display: flex;
  align-items: center;
  gap: $spacing-md;
}

.option-icon {
  width: 44px;
  height: 44px;
  border-radius: $border-radius-md;
  background: rgba($primary-cyan, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  .v-icon {
    color: $primary-cyan;
    font-size: $font-size-xl;
  }
}

.option-content {
  @include flex-column;
  gap: $spacing-xs;
}

.option-title {
  font-family: $font-family-primary;
  font-weight: $font-weight-semibold;
  font-size: $font-size-base;
  color: $text-primary;
  margin: 0;
  display: flex;
  align-items: center;
  gap: $spacing-sm;
}

.disabled-badge {
  display: inline-block;
  padding: 2px 8px;
  background: rgba(#ff9800, 0.15);
  color: #ff9800;
  font-size: $font-size-xs;
  font-weight: $font-weight-medium;
  border-radius: 4px;
}

.option-description {
  font-family: $font-family-primary;
  font-size: $font-size-sm;
  color: $text-muted;
  margin: 0;
}

.option-right {
  display: flex;
  align-items: center;
  gap: $spacing-lg;
}

.option-price {
  font-family: $font-family-primary;
  font-weight: $font-weight-bold;
  font-size: $font-size-lg;
  color: $text-primary;

  &.muted {
    color: $text-muted;
    font-weight: $font-weight-normal;
    font-size: $font-size-sm;
  }
}

.selection-indicator {
  display: flex;
  align-items: center;
}

.cost-summary {
  padding: $spacing-lg;
  background: $background-card;
  border-radius: $border-radius-lg;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: $spacing-sm 0;

  &.total {
    .summary-label,
    .summary-value {
      font-weight: $font-weight-bold;
      font-size: $font-size-lg;
      color: $text-primary;
    }
  }
}

.summary-label {
  font-family: $font-family-primary;
  font-size: $font-size-base;
  color: $text-secondary;
}

.summary-value {
  font-family: $font-family-primary;
  font-weight: $font-weight-semibold;
  font-size: $font-size-base;
  color: $text-primary;
}

.summary-divider {
  height: 1px;
  background: $border-primary;
  margin: $spacing-sm 0;
}

.step-actions {
  display: flex;
  gap: $spacing-md;
  margin-top: $spacing-md;
}

.step-actions :deep(.secondary-button),
.step-actions :deep(.gradient-button) {
  flex: 1;
  width: 100%;
  height: 44px;
  font-size: $font-size-base;
  font-weight: $font-weight-semibold;
  text-transform: none;
}

@media (max-width: $breakpoint-sm) {
  .shipping-option {
    flex-direction: column;
    align-items: flex-start;
    gap: $spacing-md;
  }

  .option-right {
    width: 100%;
    justify-content: space-between;
  }
}
</style>
