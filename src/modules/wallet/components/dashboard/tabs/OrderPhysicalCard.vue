<template>
  <div class="order-physical-card">
    <div class="order-content">
      <div class="info-section">
        <h3 class="info-title">Order a physical card</h3>
        <p class="info-text">Write your delivery details, we will ship the card in 10-20 days.</p>
      </div>

      <div class="form-section">
        <div class="form-row">
          <div class="input-full">
            <label class="input-label">Name *</label>
            <v-text-field
              v-model="formData.name"
              dense
              outlined
              class="form-input"
              hide-details
              :placeholder="userName || 'Enter your name'"
            />
          </div>
        </div>

        <div class="form-row">
          <div class="input-full">
            <label class="input-label">Street address *</label>
            <v-text-field v-model="formData.streetAddress" dense outlined class="form-input" hide-details />
          </div>
        </div>

        <div class="form-row">
          <div class="input-full">
            <label class="input-label">City *</label>
            <v-text-field v-model="formData.city" dense outlined class="form-input" hide-details />
          </div>
        </div>

        <div class="form-row">
          <div class="input-full">
            <label class="input-label">State / Province *</label>
            <div class="state-province-row">
              <v-text-field v-model="formData.state" dense outlined class="form-input state-input" hide-details />
              <v-text-field v-model="formData.postalCode" dense outlined class="form-input postal-input" hide-details />
            </div>
          </div>
        </div>

        <div class="form-row">
          <div class="input-full">
            <label class="input-label">Country *</label>
            <div class="country-select">
              <v-select
                v-model="formData.country"
                :items="countries"
                dense
                outlined
                class="form-input country-input"
                hide-details
              />
            </div>
          </div>
        </div>
      </div>

      <div class="divider"></div>

      <div class="shipping-section">
        <div class="form-row">
          <label class="input-label">Shipping method</label>
          <div class="shipping-options">
            <div
              class="shipping-option"
              :class="{ active: selectedShipping === 'express' }"
              @click="selectedShipping = 'express'"
            >
              <span class="shipping-text">Express - 1 day</span>
            </div>
            <div
              class="shipping-option"
              :class="{ active: selectedShipping === 'normal' }"
              @click="selectedShipping = 'normal'"
            >
              <span class="shipping-text">Normal 7-14 days</span>
            </div>
          </div>
        </div>
      </div>

      <div class="shipping-fee">
        <div class="form-row">
          <label class="input-label">Shipping fee</label>
          <span class="fee-amount">$3.99</span>
        </div>
      </div>
    </div>

    <div class="modal-actions">
      <SecondaryButton text="Back" @click="$emit('close')" />
      <GradientButton text="Place Order" @click="placeOrder" :loading="loading" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed } from 'vue';
import cardStore from '@/stores/modules/card';
import GradientButton from '../../GradientButton.vue';
import SecondaryButton from '../../SecondaryButton.vue';

const loading = ref(false);

// Extract user name from email
const userName = computed(() => {
  if (cardStore.state.userInfo?.email) {
    return cardStore.state.userInfo.email.split('@')[0];
  }
  return '';
});

const formData = reactive({
  name: userName.value,
  streetAddress: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
});

const countries = [
  'United States',
  'Canada',
  'United Kingdom',
  'Germany',
  'France',
  'Spain',
  'Italy',
  'Netherlands',
  'Belgium',
  'Switzerland',
  'Austria',
  'Sweden',
  'Norway',
  'Denmark',
  'Finland',
  'Poland',
  'Czech Republic',
  'Hungary',
  'Slovakia',
  'Slovenia',
  'Croatia',
  'Bulgaria',
  'Romania',
  'Greece',
  'Portugal',
  'Ireland',
  'Luxembourg',
  'Malta',
  'Cyprus',
  'Estonia',
  'Latvia',
  'Lithuania',
];

const selectedShipping = ref('normal');

const placeOrder = async () => {
  loading.value = true;
  try {
    // Here you would call the API to place the order
    console.log('Placing order with data:', {
      ...formData,
      shipping: selectedShipping.value,
      userEmail: cardStore.state.userInfo?.email,
    });

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('Order placed successfully');
    // You could emit an event or navigate to success page
  } catch (error) {
    console.error('Failed to place order:', error);
  } finally {
    loading.value = false;
  }
};
</script>

<style lang="scss" scoped>
@import '../../../styles/variables';
@import '../../../styles/mixins';

.order-physical-card {
  width: 100%;
  @include flex-column;
  gap: $spacing-2xl;
}

.order-content {
  @include flex-column;
  gap: $spacing-2xl;
}

.info-section {
  @include flex-column;
  gap: $spacing-xs;
}

.info-title {
  @include heading-style($font-size-lg);
  margin: 0;
}

.info-text {
  @include body-text($font-size-sm);
  color: $text-muted;
  margin: 0;
}

.form-section {
  @include flex-column;
  gap: $spacing-2xl;
}

.form-row {
  display: flex;
  align-items: center;
  gap: $spacing-2xl;
  width: 100%;
  justify-content: space-between;
}

.input-full {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $spacing-2xl;
}

.input-label {
  @include body-text($font-size-sm);
  font-weight: $font-weight-semibold;
  color: $text-secondary;
  margin: 0;
  min-width: 120px;
  flex-shrink: 0;
}

.form-input {
  max-width: 400px;
  :deep(.v-input__control) {
    background: $background-dark !important;
    border: 1px solid $border-primary !important;
    border-radius: $border-radius-md !important;
  }

  :deep(.v-input__slot) {
    background: transparent !important;
    box-shadow: none !important;
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

.state-province-row {
  display: flex;
  gap: $spacing-xl;
  width: 100%;
  max-width: 400px;

  .state-input {
    flex: 1;
    max-width: 148px;
  }

  .postal-input {
    flex: 1;
    max-width: 148px;
  }
}

.country-select {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  width: 400px;
}

.flag-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
}

.country-input {
  flex: 1;
}

.divider {
  width: 100%;
  height: 1px;
  background: $border-primary;
  margin: $spacing-sm 0;
}

.shipping-section {
  @include flex-column;
  gap: $spacing-2xl;
}

.shipping-options {
  display: flex;
  gap: $spacing-xs;
}

.shipping-option {
  display: flex;
  align-items: center;
  padding: $spacing-xs $spacing-sm;
  border: 1px solid $border-secondary;
  border-radius: $border-radius-md;
  background: $background-dark;
  cursor: pointer;
  transition: all 0.3s ease;

  &.active {
    background: $background-secondary;
    border-color: $primary-cyan;
  }

  &:hover {
    border-color: $border-primary;
  }
}

.shipping-text {
  @include body-text($font-size-sm);
  color: $text-secondary;

  .shipping-option.active & {
    color: $primary-cyan;
  }
}

.fee-amount {
  @include body-text($font-size-sm);
  color: $text-primary;
}

.modal-actions {
  display: flex;
  gap: $spacing-md;
  width: 100%;
  margin-top: $spacing-sm;
  padding: 0 $spacing-2xl $spacing-2xl;
}

.modal-actions :deep(.secondary-button),
.modal-actions :deep(.gradient-button) {
  flex: 1;
  width: 100%;
  height: 44px;
  font-size: $font-size-base;
  font-weight: $font-weight-semibold;
  text-transform: none;
}

@media (max-width: $breakpoint-md) {
  .modal-actions {
    padding: 0 $spacing-lg $spacing-lg;
  }

  .modal-actions :deep(.secondary-button),
  .modal-actions :deep(.gradient-button) {
    height: 40px;
    font-size: $font-size-sm;
  }
}
</style>
