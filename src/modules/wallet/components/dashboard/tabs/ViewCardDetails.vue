<template>
  <div class="view-card-details">
    <div class="form-container">
      <div class="form-row">
        <div class="input-full">
          <label class="input-label">Name on card</label>
          <v-text-field v-model="formData.nameOnCard" dense outlined class="form-input" hide-details />
        </div>

        <div class="input-full small-input">
          <label class="input-label">Expiry</label>
          <v-text-field v-model="formData.expiry" dense outlined class="form-input" hide-details />
        </div>
      </div>

      <div class="form-row">
        <div class="input-full">
          <label class="input-label">Card number</label>
          <div class="card-number-input">
            <div class="payment-method-icon">
              <div class="mastercard-icon">
                <div class="mastercard-left"></div>
                <div class="mastercard-right"></div>
                <div class="mastercard-middle"></div>
              </div>
            </div>
            <span class="card-number-text">{{ formData.cardNumber }}</span>
          </div>
        </div>
        <div class="input-full small-input">
          <label class="input-label">CVV</label>
          <div class="cvv-input">
            <span class="cvv-text">{{ formData.cvv }}</span>
            <v-btn icon small class="eye-btn" @click="toggleCvvVisibility">
              <v-icon small>{{ showCvv ? 'mdi-eye' : 'mdi-eye-off' }}</v-icon>
            </v-btn>
          </div>
        </div>
      </div>

      <div class="form-row">
        <div class="pin-container">
          <label class="input-label">PIN</label>
          <div class="pin-input">
            <span class="pin-text">{{ formData.pin }}</span>
            <v-btn icon small class="eye-btn" @click="togglePinVisibility">
              <v-icon small>{{ showPin ? 'mdi-eye' : 'mdi-eye-off' }}</v-icon>
            </v-btn>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';

const formData = reactive({
  nameOnCard: 'Olivia Rhye',
  expiry: '06 / 2025',
  cardNumber: '1234 1234 1234 1234',
  cvv: '•••',
  pin: '••••',
});

const showCvv = ref(false);
const showPin = ref(false);

const toggleCvvVisibility = () => {
  showCvv.value = !showCvv.value;
  formData.cvv = showCvv.value ? '123' : '•••';
};

const togglePinVisibility = () => {
  showPin.value = !showPin.value;
  formData.pin = showPin.value ? '1234' : '••••';
};
</script>

<style lang="scss" scoped>
@import '../../../styles/variables';
@import '../../../styles/mixins';

.view-card-details {
  width: 100%;
}

.form-container {
  @include flex-column;
  gap: $spacing-md;
}

.form-row {
  display: flex;
  justify-content: space-between;
  gap: $spacing-md;
  width: 100%;
}

.form-input {
  flex: 1;

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
}

.input-full {
  width: 100%;
}

.small-input {
  width: 112px !important;
  flex: none;
}

.input-label {
  @include body-text($font-size-sm);
  font-weight: $font-weight-medium;
  color: $text-secondary;
  margin: 0 0 6px 0;
}

.card-number-input,
.cvv-input,
.pin-input {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  background: $background-dark;
  border: 1px solid $border-primary;
  border-radius: $border-radius-md;
  padding: $spacing-sm $spacing-sm;
  min-height: 44px;
}

.card-number-input {
  padding: $spacing-sm $spacing-sm $spacing-sm $spacing-sm;
}

.payment-method-icon {
  width: 34px;
  height: 24px;
  background: #ffffff;
  border: 1px solid $border-secondary;
  border-radius: $border-radius-sm;
  @include flex-center;
  flex-shrink: 0;
}

.mastercard-icon {
  position: relative;
  width: 22.36px;
  height: 13.4px;
}

.mastercard-left {
  position: absolute;
  left: 0;
  top: 0;
  width: 13.56px;
  height: 13.4px;
  background: #ed0006;
  border-radius: 50%;
}

.mastercard-right {
  position: absolute;
  right: 0;
  top: 0;
  width: 11.18px;
  height: 13.4px;
  background: linear-gradient(45deg, #f9a000 0%, #6d6dbb 100%);
  border-radius: 50%;
}

.mastercard-middle {
  position: absolute;
  left: 8.8px;
  top: 1.6px;
  width: 4.76px;
  height: 10.19px;
  background: #ff5e00;
  border-radius: 2px;
}

.card-number-text,
.cvv-text,
.pin-text {
  @include body-text($font-size-base);
  color: $text-primary;
  flex: 1;
}

.pin-container {
  width: 112px;
}

.eye-btn {
  width: 16px;
  height: 16px;
  min-width: 16px !important;
  background: transparent !important;

  .v-icon {
    color: $text-muted;
    font-size: $font-size-base;
  }

  &:hover {
    background: transparent !important;
  }
}
</style> 