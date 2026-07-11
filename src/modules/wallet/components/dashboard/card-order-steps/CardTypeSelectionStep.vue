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
              <span v-if="hasVirtualCard" class="disabled-badge t-label">{{ $t('card.alreadyOrdered') }}</span>
            </v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        <div class="option-content">
          <p class="option-description">{{ $t('card.virtualCardDescription') }}</p>
        </div>
        <div class="option-features">
          <div class="feature-item">
            <v-icon small color="var(--g-accent)">mdi-check-circle</v-icon>
            <span>{{ $t('card.instantActivation') }}</span>
          </div>
          <div class="feature-item">
            <v-icon small color="var(--g-accent)">mdi-check-circle</v-icon>
            <span>{{ $t('card.onlinePayments') }}</span>
          </div>
          <div class="feature-item">
            <v-icon small color="var(--g-accent)">mdi-check-circle</v-icon>
            <span>{{ $t('card.noShippingRequired') }}</span>
          </div>
        </div>
        <div class="option-price">
          <span class="price-label">{{ $t('card.free') }}</span>
        </div>
        <div class="selection-indicator">
          <v-icon v-if="selectedType === 'virtual'" color="var(--g-accent)">mdi-check-circle</v-icon>
          <v-icon v-else color="var(--g-text-3)">mdi-circle-outline</v-icon>
        </div>
      </div>

      <!-- Physical + Virtual Card Option -->
      <div
        class="card-option"
        :class="{
          selected: selectedType === 'physical' && !hasPhysicalCard && isPhysicalCardOrderingEnabled,
          disabled: hasPhysicalCard || !isPhysicalCardOrderingEnabled
        }"
        @click="!hasPhysicalCard && isPhysicalCardOrderingEnabled && selectType('physical')"
        @keydown.enter="!hasPhysicalCard && isPhysicalCardOrderingEnabled && selectType('physical')"
        @keydown.space.prevent="!hasPhysicalCard && isPhysicalCardOrderingEnabled && selectType('physical')"
        role="button"
        :tabindex="hasPhysicalCard || !isPhysicalCardOrderingEnabled ? -1 : 0"
      >
        <v-list-item class="px-0">
          <v-list-item-icon class="option-icon mr-3 my-0">
            <v-icon large>mdi-credit-card-multiple-outline</v-icon>
          </v-list-item-icon>
          <v-list-item-content class="option-content">
            <v-list-item-title class="option-title">
              {{ $t('card.physicalPlusVirtualCard') }}
              <span v-if="hasPhysicalCard" class="disabled-badge t-label">{{ $t('card.alreadyOrdered') }}</span>
            </v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        <div class="option-content">
          <p class="option-description">{{ $t('card.physicalCardDescription') }}</p>
        </div>
        <div class="option-features">
          <div class="feature-item">
            <v-icon small color="var(--g-accent)">mdi-check-circle</v-icon>
            <span>{{ $t('card.physicalCardDelivered') }}</span>
          </div>
          <div class="feature-item">
            <v-icon small color="var(--g-accent)">mdi-check-circle</v-icon>
            <span>{{ $t('card.inStorePayments') }}</span>
          </div>
          <div class="feature-item">
            <v-icon small color="var(--g-accent)">mdi-check-circle</v-icon>
            <span>{{ $t('card.atmWithdrawals') }}</span>
          </div>
        </div>
        <div class="option-price">
          <span class="price-label shipping">{{ $t('card.shippingFeeApplies') }}</span>
        </div>
        <div class="selection-indicator">
          <v-icon v-if="selectedType === 'physical'" color="var(--g-accent)">mdi-check-circle</v-icon>
          <v-icon v-else color="var(--g-text-3)">mdi-circle-outline</v-icon>
        </div>

        <!-- Coming Soon Overlay (when feature flag is disabled) -->
        <div v-if="!isPhysicalCardOrderingEnabled" class="coming-soon-overlay">
          <div class="coming-soon-content">
            <div class="coming-soon-badge">
              <div class="badge-shimmer"></div>
              <h3 class="coming-soon-title">{{ $t('wallet.comingSoon') }}</h3>
              <p class="coming-soon-message">{{ $t('wallet.stayTuned') }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import featureFlagsStore from '@/stores/featureFlagsStore';

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

// Feature flag check for physical card ordering
const isPhysicalCardOrderingEnabled = computed(() =>
  featureFlagsStore.isPhysicalCardOrderingEnabled()
);

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

  &:not(.disabled):hover {
    border-color: rgba($primary-cyan, 0.5);
    background: rgba($primary-cyan, 0.05);
  }

  &.selected {
    border-color: $primary-cyan;
    background: rgba($primary-cyan, 0.1);
  }

  &:not(.disabled):focus {
    outline: none;
    border-color: $primary-cyan;
  }

  &.disabled {
    cursor: not-allowed;
    pointer-events: none;

    // Apply opacity only to card content (not the overlay)
    > *:not(.coming-soon-overlay) {
      opacity: 0.5;
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
  background: var(--g-hairline-2);
  color: var(--g-text-3);
  font-size: $font-size-xs;
  font-weight: $font-weight-medium;
  border-radius: 4px;
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

// Coming Soon Overlay
.coming-soon-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(12, 14, 18, 0.5);
  border-radius: $border-radius-lg;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  opacity: 1 !important;
}

.coming-soon-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: $spacing-lg;
}

.coming-soon-badge {
  position: relative;
  background: var(--g-raised);
  border: 2px solid transparent;
  background-clip: padding-box;
  border-radius: $border-radius-md;
  padding: $spacing-lg $spacing-xl;
  box-shadow: var(--g-shadow-sheet);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  opacity: 1 !important;
  overflow: hidden;

  // Accent border
  &::before {
    content: '';
    position: absolute;
    top: -2px;
    left: -2px;
    right: -2px;
    bottom: -2px;
    background: var(--g-accent);
    border-radius: $border-radius-md;
    z-index: -1;
  }
}

.badge-shimmer {
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  pointer-events: none;
}

.coming-soon-title {
  position: relative;
  z-index: 1;
  font-size: 20px;
  font-weight: $font-weight-bold;
  margin: 0 0 $spacing-xs 0;
  color: var(--g-text-1);
  opacity: 1 !important;
}

.coming-soon-message {
  position: relative;
  z-index: 1;
  color: var(--g-text-1) !important;
  font-size: $font-size-sm;
  margin: 0;
  line-height: $line-height-relaxed;
  opacity: 1 !important;
  font-weight: $font-weight-medium;
}

@media (max-width: $breakpoint-sm) {
  .card-option {
    padding: $spacing-lg;
  }

  .option-features {
    flex-direction: column;
    gap: $spacing-xs;
  }

  .coming-soon-badge {
    padding: $spacing-md $spacing-lg;
  }

  .coming-soon-title {
    font-size: 16px;
  }

  .coming-soon-message {
    font-size: $font-size-xs;
  }
}
</style>
