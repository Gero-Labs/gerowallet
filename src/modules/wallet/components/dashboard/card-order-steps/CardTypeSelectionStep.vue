<template>
  <div class="card-type-selection">
    <div class="card-options">
      <!-- Virtual Card Option -->
      <div
        class="card-option"
        :class="{ selected: selectedType === 'virtual', disabled: hasVirtualCard }"
        @click="!hasVirtualCard && selectType('virtual')"
        @keydown.enter="!hasVirtualCard && selectType('virtual')"
        @keydown.space.prevent="!hasVirtualCard && selectType('virtual')"
        role="button"
        :tabindex="hasVirtualCard ? -1 : 0"
      >
        <v-list-item class="px-0">
          <v-list-item-icon class="option-icon mr-3 my-0">
            <v-icon large>mdi-credit-card-outline</v-icon>
          </v-list-item-icon>
          <v-list-item-content class="option-content">
            <v-list-item-title class="option-title">
              {{ $t('card.virtualCardOnly') }}
              <span v-if="hasVirtualCard" class="disabled-badge">{{ $t('card.alreadyOrdered') }}</span>
            </v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        <div class="option-content">
          <p class="option-description">{{ $t('card.virtualCardDescription') }}</p>
        </div>
        <div class="option-features">
          <div class="feature-item">
            <v-icon small color="#00c7f3">mdi-check-circle</v-icon>
            <span>{{ $t('card.instantActivation') }}</span>
          </div>
          <div class="feature-item">
            <v-icon small color="#00c7f3">mdi-check-circle</v-icon>
            <span>{{ $t('card.onlinePayments') }}</span>
          </div>
          <div class="feature-item">
            <v-icon small color="#00c7f3">mdi-check-circle</v-icon>
            <span>{{ $t('card.noShippingRequired') }}</span>
          </div>
        </div>
        <div class="option-price">
          <span class="price-label">{{ $t('card.free') }}</span>
        </div>
        <div class="selection-indicator">
          <v-icon v-if="selectedType === 'virtual'" color="#00c7f3">mdi-check-circle</v-icon>
          <v-icon v-else color="#373a41">mdi-circle-outline</v-icon>
        </div>
      </div>

      <!-- Physical + Virtual Card Option -->
      <div
        class="card-option"
        :class="{ selected: selectedType === 'physical', disabled: hasPhysicalCard }"
        @click="!hasPhysicalCard && selectType('physical')"
        @keydown.enter="!hasPhysicalCard && selectType('physical')"
        @keydown.space.prevent="!hasPhysicalCard && selectType('physical')"
        role="button"
        :tabindex="hasPhysicalCard ? -1 : 0"
      >
        <v-list-item class="px-0">
          <v-list-item-icon class="option-icon mr-3 my-0">
            <v-icon large>mdi-credit-card-multiple-outline</v-icon>
          </v-list-item-icon>
          <v-list-item-content class="option-content">
            <v-list-item-title class="option-title">
              {{ $t('card.physicalPlusVirtualCard') }}
              <span v-if="hasPhysicalCard" class="disabled-badge">{{ $t('card.alreadyOrdered') }}</span>
            </v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        <div class="option-content">
          <p class="option-description">{{ $t('card.physicalCardDescription') }}</p>
        </div>
        <div class="option-features">
          <div class="feature-item">
            <v-icon small color="#00c7f3">mdi-check-circle</v-icon>
            <span>{{ $t('card.physicalCardDelivered') }}</span>
          </div>
          <div class="feature-item">
            <v-icon small color="#00c7f3">mdi-check-circle</v-icon>
            <span>{{ $t('card.inStorePayments') }}</span>
          </div>
          <div class="feature-item">
            <v-icon small color="#00c7f3">mdi-check-circle</v-icon>
            <span>{{ $t('card.atmWithdrawals') }}</span>
          </div>
        </div>
        <div class="option-price">
          <span class="price-label shipping">{{ $t('card.shippingFeeApplies') }}</span>
        </div>
        <div class="selection-indicator">
          <v-icon v-if="selectedType === 'physical'" color="#00c7f3">mdi-check-circle</v-icon>
          <v-icon v-else color="#373a41">mdi-circle-outline</v-icon>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  selectedType?: 'virtual' | 'physical' | null;
  hasVirtualCard?: boolean;
  hasPhysicalCard?: boolean;
}

interface Emits {
  (e: 'select', type: 'virtual' | 'physical'): void;
}

withDefaults(defineProps<Props>(), {
  selectedType: null,
  hasVirtualCard: false,
  hasPhysicalCard: false,
});
const emit = defineEmits<Emits>();

const selectType = (type: 'virtual' | 'physical') => {
  emit('select', type);
};
</script>

<style lang="scss" scoped>
@import '../../../styles/variables';
@import '../../../styles/mixins';

.card-type-selection {
  width: 100%;
}

.card-options {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
}

.card-option {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
  padding: $spacing-xl;
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

.option-icon {
  width: 48px;
  height: 48px;
  border-radius: $border-radius-md;
  background: rgba($primary-cyan, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;

  .v-icon {
    color: $primary-cyan;
  }

  &.physical {
    background: linear-gradient(135deg, rgba($primary-cyan, 0.15) 0%, rgba($primary-green, 0.15) 100%);
  }
}

.option-content {
  flex: 1;
}

.option-title {
  font-family: $font-family-primary;
  font-weight: $font-weight-semibold;
  font-size: $font-size-lg;
  color: $text-primary;
  margin: 0 0 $spacing-xs 0;
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  flex-wrap: wrap;
}

.disabled-badge {
  display: inline-block;
  padding: 2px 8px;
  background: rgba(#9e9e9e, 0.15);
  color: #9e9e9e;
  font-size: $font-size-xs;
  font-weight: $font-weight-medium;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.option-description {
  font-family: $font-family-primary;
  font-size: $font-size-sm;
  color: $text-muted;
  margin: 0;
  line-height: $line-height-relaxed;
}

.option-features {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-sm $spacing-lg;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: $spacing-xs;

  span {
    font-family: $font-family-primary;
    font-size: $font-size-sm;
    color: $text-secondary;
  }
}

.option-price {
  .price-label {
    font-family: $font-family-primary;
    font-weight: $font-weight-semibold;
    font-size: $font-size-base;
    color: $primary-cyan;

    &.shipping {
      color: $text-muted;
      font-weight: $font-weight-normal;
      font-size: $font-size-sm;
    }
  }
}

.selection-indicator {
  position: absolute;
  top: $spacing-lg;
  right: $spacing-lg;
}

@media (max-width: $breakpoint-sm) {
  .card-option {
    padding: $spacing-lg;
  }

  .option-features {
    flex-direction: column;
    gap: $spacing-xs;
  }
}
</style>
