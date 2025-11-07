<template>
  <div class="order-physical-card">
    <div class="order-content">
      <div class="form-section">
        <div class="form-row">
          <div class="input-full">
            <label class="input-label">{{ $t('card.streetAddress') }}</label>
            <v-text-field v-model="formData.address" dense outlined class="form-input" hide-details />
          </div>
        </div>

        <div class="form-row">
          <div class="input-full">
            <label class="input-label">{{ $t('card.city') }}</label>
            <v-text-field v-model="formData.city" dense outlined class="form-input" hide-details />
          </div>
        </div>

        <div class="form-row">
          <div class="input-full">
            <label class="input-label">{{ $t('card.stateProvince') }}</label>
            <div class="state-province-row">
              <v-text-field v-model="formData.region" dense outlined class="form-input state-input" hide-details />
              <v-text-field v-model="formData.zipCode" dense outlined class="form-input postal-input" hide-details />
            </div>
          </div>
        </div>

        <div class="form-row">
          <div class="input-full">
            <label class="input-label">{{ $t('card.country') }}</label>
            <div class="country-select">
              <v-select
                v-model="formData.countryCode"
                :items="countries"
                item-text="label"
                item-value="code"
                dense
                outlined
                class="form-input country-input"
                hide-details
              />
            </div>
          </div>
        </div>

        <div class="form-row">
          <div class="input-full">
            <label class="input-label">{{ $t('card.phone') || 'Phone' }}</label>
            <v-text-field v-model="formData.phone" dense outlined class="form-input" hide-details />
          </div>
        </div>
      </div>

      <div class="divider"></div>

      <div class="shipping-section">
        <div class="form-row">
          <label class="input-label">{{ $t('card.shippingMethod') }}</label>
          <div class="shipping-options">
            <div
              v-for="option in shippingOptions"
              :key="option.id"
              class="shipping-option"
              :class="{ active: formData.deliveryMethod === option.id }"
              @click="formData.deliveryMethod = option.id"
            >
              <span class="shipping-text">{{ option.label }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="shipping-fee">
        <div class="form-row">
          <label class="input-label">{{ $t('card.shippingFee') }}</label>
          <span class="fee-amount">{{ shippingFee }}</span>
        </div>
      </div>
    </div>

    <div class="modal-actions">
      <SecondaryButton :text="String($t('card.back'))" @click="$emit('close')" />
      <GradientButton :text="String($t('card.placeOrder'))" @click="placeOrder" :loading="loading" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import cardStore, { OrderPhysicalCardPayload } from '@/stores/modules/card';
import GradientButton from '../../GradientButton.vue';
import SecondaryButton from '../../SecondaryButton.vue';
import snackbar from '@/plugins/snackbar';
import countries from '@/plugins/countries';
const loading = ref(false);

const { t } = useTranslation();
const emit = defineEmits<{ (e: 'close'): void }>();

const userName = computed(() => {
  if (cardStore.state.userInfo?.email) {
    return cardStore.state.userInfo.email.split('@')[0];
  }
  return '';
});

const translateOrFallback = (key: string, fallback: string) => {
  const translation = t(key);
  return translation === key ? fallback : translation;
};

const shippingOptions = computed(() => [
  {
    id: 'regular',
    label: translateOrFallback('card.normalShipping', 'Normal 7-14 days'),
  },
  {
    id: 'express-eu',
    label: translateOrFallback('card.expressShipping', 'Express (EU)'),
  },
  {
    id: 'express-worldwide',
    label: translateOrFallback('card.expressWorldwide', 'Express (Worldwide)'),
  },
]);

const shippingFee = computed(() => {
  const fees: Record<string, string> = {
    regular: '€3.99',
    'express-eu': '€9.99',
    'express-worldwide': '€19.99',
  };

  return fees[formData.deliveryMethod] || fees.regular;
});

const createInitialFormState = () => ({
  recipientName: userName.value,
  address: '',
  region: '',
  city: '',
  zipCode: '',
  countryCode: '',
  phone: '',
  deliveryMethod: 'regular',
});

const formData = reactive(createInitialFormState());

const resetForm = () => {
  Object.assign(formData, createInitialFormState());
};

const isFormValid = computed(() => {
  return (
    formData.recipientName.trim() &&
    formData.address.trim() &&
    formData.region.trim() &&
    formData.city.trim() &&
    formData.zipCode.trim() &&
    formData.countryCode &&
    formData.phone.trim()
  );
});

const placeOrder = async () => {
  if (!isFormValid.value) {
    snackbar.setError(
      translateOrFallback('card.orderPhysicalCardValidationError', 'Please fill in all required fields.')
    );
    return;
  }

  loading.value = true;

  const payload: OrderPhysicalCardPayload = {
    address: formData.recipientName.trim()
      ? `${formData.recipientName.trim()}, ${formData.address.trim()}`
      : formData.address.trim(),
    region: formData.region.trim(),
    city: formData.city.trim(),
    zipCode: formData.zipCode.trim(),
    countryCode: formData.countryCode,
    phone: formData.phone.trim(),
    deliveryMethod: formData.deliveryMethod,
  };

  try {
    await cardStore.orderPhysicalCard(payload);
    await cardStore.fetchCardData();
    snackbar.fireSuccess(translateOrFallback('card.orderPhysicalCardSuccess', 'Card ordered successfully.'));
    resetForm();
    emit('close');
  } catch (error: any) {
    const responseMessage =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.message ||
      translateOrFallback('card.pleaseTryAgain', 'Please try again.');

    const failedMessage = translateOrFallback('card.failedToOrderCard', 'Failed to order card.');
    snackbar.setError(`${failedMessage} ${responseMessage}`);
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
