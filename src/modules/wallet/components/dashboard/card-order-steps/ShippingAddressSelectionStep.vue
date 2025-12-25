<template>
  <div class="shipping-address-selection">
    <!-- Address Selection Options -->
    <div class="address-options">
      <v-radio-group v-model="selectedOption" hide-details class="address-radio-group">
        <v-radio value="new" color="#00c7f3">
          <template v-slot:label>
            <div class="radio-label">
              <span class="label-title">{{ $t('card.enterNewAddress') }}</span>
              <span class="label-description">{{ $t('card.provideNewShippingAddress') }}</span>
            </div>
          </template>
        </v-radio>

        <v-radio value="existing" color="#00c7f3" disabled>
          <template v-slot:label>
            <div class="radio-label">
              <span class="label-title">
                {{ $t('card.useExistingAddress') }}
                <span class="disabled-badge">{{ $t('common.comingSoon') }}</span>
              </span>
              <span class="label-description">{{ $t('card.useAddressRegisteredWithKaiserex') }}</span>
            </div>
          </template>
        </v-radio>
      </v-radio-group>
    </div>

    <!-- New Address Form -->
    <div v-if="selectedOption === 'new'" class="address-form">
      <div class="form-row">
        <div class="input-full">
          <label class="input-label">{{ $t('card.streetAddress') }}</label>
          <v-text-field
            v-model="localAddress.streetAddress"
            dense
            outlined
            class="form-input"
            hide-details
            :placeholder="$t('card.enterStreetAddress')"
          />
        </div>
      </div>

      <div class="form-row">
        <div class="input-full">
          <label class="input-label">{{ $t('card.city') }}</label>
          <v-text-field
            v-model="localAddress.city"
            dense
            outlined
            class="form-input"
            hide-details
            :placeholder="$t('card.enterCity')"
          />
        </div>
      </div>

      <div class="form-row two-columns">
        <div class="input-half">
          <label class="input-label">{{ $t('card.stateProvince') }}</label>
          <v-text-field
            v-model="localAddress.stateProvince"
            dense
            outlined
            class="form-input"
            hide-details
            :placeholder="$t('card.enterState')"
          />
        </div>
        <div class="input-half">
          <label class="input-label">{{ $t('card.zipCode') }}</label>
          <v-text-field
            v-model="localAddress.zipCode"
            dense
            outlined
            class="form-input"
            hide-details
            :placeholder="$t('card.enterZipCode')"
          />
        </div>
      </div>

      <div class="form-row">
        <div class="input-full">
          <label class="input-label">{{ $t('card.country') }}</label>
          <v-select
            v-model="localAddress.countryCode"
            :items="countries"
            item-text="label"
            item-value="code"
            dense
            outlined
            class="form-input"
            hide-details
            :placeholder="$t('card.selectCountry')"
            attach
          />
        </div>
      </div>

      <div class="form-row">
        <div class="input-full">
          <label class="input-label">{{ $t('card.phone') }} ({{ $t('common.optional') }})</label>
          <v-text-field
            v-model="localAddress.phone"
            dense
            outlined
            class="form-input"
            hide-details
            :placeholder="$t('card.enterPhone')"
          />
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="step-actions">
      <SecondaryButton :text="$t('card.back')" @click="handleBack" />
      <GradientButton
        :text="$t('card.continueButton')"
        @click="handleContinue"
        :disabled="!isFormValid"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import SecondaryButton from '../../SecondaryButton.vue';
import GradientButton from '../../GradientButton.vue';
import countries from '@/plugins/countries';

interface AddressData {
  streetAddress: string;
  city: string;
  stateProvince: string;
  zipCode: string;
  countryCode: string;
  phone: string;
}

interface Props {
  useExisting: boolean;
  address: AddressData;
}

interface Emits {
  (e: 'back'): void;
  (e: 'submit', payload: { useExisting: boolean; address?: AddressData }): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

// Local state
const selectedOption = ref<'existing' | 'new'>('new'); // Default to 'new'
const localAddress = ref<AddressData>({ ...props.address });

// Form validation
const isFormValid = computed(() => {
  if (selectedOption.value === 'existing') {
    return true;
  }
  return (
    localAddress.value.streetAddress.trim() !== '' &&
    localAddress.value.city.trim() !== '' &&
    localAddress.value.stateProvince.trim() !== '' &&
    localAddress.value.zipCode.trim() !== '' &&
    localAddress.value.countryCode !== ''
    // Phone is now optional
  );
});

// Watch for prop changes
watch(
  () => props.useExisting,
  newVal => {
    selectedOption.value = newVal ? 'existing' : 'new';
  }
);

watch(
  () => props.address,
  newVal => {
    localAddress.value = { ...newVal };
  },
  { deep: true }
);

// Handlers
const handleBack = () => {
  emit('back');
};

const handleContinue = () => {
  if (!isFormValid.value) return;

  if (selectedOption.value === 'existing') {
    emit('submit', { useExisting: true });
  } else {
    emit('submit', {
      useExisting: false,
      address: { ...localAddress.value },
    });
  }
};
</script>

<style lang="scss" scoped>
@import '../../../styles/variables';
@import '../../../styles/mixins';

.shipping-address-selection {
  width: 100%;
  @include flex-column;
  gap: $spacing-xl;
}

.address-options {
  background: $background-card;
  border-radius: $border-radius-lg;
  padding: $spacing-lg;
}

.address-radio-group {
  :deep(.v-input__control) {
    width: 100%;
  }

  :deep(.v-radio) {
    margin-bottom: $spacing-md;
    padding: $spacing-md;
    border-radius: $border-radius-md;
    background: $background-dark;
    border: 1px solid $border-primary;
    transition: all 0.3s ease;

    &:last-child {
      margin-bottom: 0;
    }

    &:hover {
      border-color: rgba($primary-cyan, 0.5);
    }

    &.v-item--active {
      border-color: $primary-cyan;
      background: rgba($primary-cyan, 0.05);
    }

    &.v-radio--is-disabled {
      opacity: 0.5;
      cursor: not-allowed;

      &:hover {
        border-color: $border-primary;
      }
    }
  }

  :deep(.v-label) {
    width: 100%;
  }
}

.radio-label {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs;
}

.label-title {
  font-family: $font-family-primary;
  font-weight: $font-weight-semibold;
  font-size: $font-size-base;
  color: $text-primary;
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

.label-description {
  font-family: $font-family-primary;
  font-size: $font-size-sm;
  color: $text-muted;
}

.address-form {
  @include flex-column;
  gap: $spacing-lg;
  padding: $spacing-lg;
  background: $background-card;
  border-radius: $border-radius-lg;
}

.form-row {
  @include flex-column;
  gap: $spacing-xs;

  &.two-columns {
    flex-direction: row;
    gap: $spacing-lg;
  }
}

.input-full {
  width: 100%;
  @include flex-column;
  gap: $spacing-xs;
}

.input-half {
  flex: 1;
  @include flex-column;
  gap: $spacing-xs;
}

.input-label {
  font-family: $font-family-primary;
  font-weight: $font-weight-medium;
  font-size: $font-size-sm;
  color: $text-secondary;
}

.form-input {
  :deep(.v-input__control) {
    background: $background-dark !important;
    border: 1px solid $border-primary !important;
    border-radius: $border-radius-md !important;
  }

  :deep(.v-input__slot) {
    background: transparent !important;
    box-shadow: none !important;
    min-height: 44px !important;
  }

  :deep(.v-label) {
    color: $text-secondary !important;
    font-weight: $font-weight-medium;
    font-size: $font-size-sm;
  }

  :deep(.v-text-field__details) {
    display: none;
  }

  :deep(input) {
    color: $text-primary !important;
    font-size: $font-size-base;
  }

  :deep(.v-select__selections) {
    color: $text-primary !important;
    font-size: $font-size-base;
  }

  :deep(.v-select__selection) {
    color: $text-primary !important;
  }
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
  .form-row.two-columns {
    flex-direction: column;
    gap: $spacing-lg;
  }
}
</style>
