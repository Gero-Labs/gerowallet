<template>
  <div class="view-card-details">
    <div v-if="loading" class="loading-container">
      <v-progress-circular indeterminate color="primary" size="32"></v-progress-circular>
      <span class="loading-text">Loading card details...</span>
    </div>

    <div v-else class="form-container">
      <div class="form-row">
        <!-- <div class="input-full">
          <label class="input-label">Name on card</label>
          <div class="card-number-input">
            <span class="card-number-text">{{ cardData?.pan || 'Loading...' }}</span>
          </div>
        </div> -->        <div class="input-full small-input">
          <label class="input-label">Expiry</label>
          <div class="cvv-input">
            <span class="cvv-text">{{ cardDetailsFull?.details.expiryDate || 'Loading...' }}</span>
          </div>
        </div>
      </div>
      <div class="form-row">
        <div class="input-full">
          <label class="input-label">Card number</label>
          <div class="card-number-input">
            <img src="@/modules/wallet/icons/mastercard.svg" alt="Mastercard" class="card-icon" />
            <span class="card-number-text">{{ cardDetailsFull?.details.pan || 'Loading...' }}</span>
          </div>
        </div>
        <div class="input-full small-input">
          <label class="input-label">CVV</label>
          <div class="cvv-input">
            <span class="cvv-text">{{ showCvv ? cardDetailsFull?.details.cvc2 : '•••' }}</span>
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
            <span class="pin-text">{{ showPin ? cardDetailsFull?.pin : '••••' }}</span>
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
import { ref, computed, onMounted } from 'vue';
import cardStoreModule, { cardStore } from '@/stores/modules/card';

const showCvv = ref(false);
const showPin = ref(false);
const loading = ref(true);

// Get card data from store
const cardData = computed(() => {
  return cardStore.cardData;
});

const cardDetailsFull = computed(() => {
  return { ...cardStore.cardDetails, ...cardStore.cardPin } as any;
});

const toggleCvvVisibility = () => {
  showCvv.value = !showCvv.value;
};

const togglePinVisibility = () => {
  showPin.value = !showPin.value;
};

// Initialize card data when component mounts
onMounted(async () => {
  console.log('ViewCardDetails - Card data:', cardData.value);
  try {
    console.log('ViewCardDetails - Initializing card data...');
    loading.value = true;
    await cardStoreModule.fetchCardDetails(cardData.value?.card_uuid);
    await cardStoreModule.fetchCardPin(cardData.value?.card_uuid);
  } catch (error) {
    console.error('ViewCardDetails - Failed to initialize card data:', error);
  } finally {
    loading.value = false;
    console.log('ViewCardDetails - Card data loaded: 12312', cardData.value);
  }
});
</script>

<style lang="scss" scoped>
@import '../../../styles/variables';
@import '../../../styles/mixins';

.view-card-details {
  width: 100%;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: $spacing-md;
  padding: $spacing-xl;

  .loading-text {
    @include body-text($font-size-base);
    color: $text-secondary;
  }
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

.card-icon {
  width: 24px;
  height: 24px;
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
