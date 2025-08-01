<template>
  <div class="amount-input-step">
    <!-- Currency Icon -->
    <div class="currency-icon">
      <v-icon color="#75E0A7" size="20">mdi-currency-usd</v-icon>
    </div>
    
    <!-- Title and Subtitle -->
    <div class="header-text">
      <h2 class="modal-title">Top up your credit card balance</h2>
      <p class="modal-subtitle">Transfer your ADA to Euro with real-time exchange rate</p>
    </div>
    
    <!-- Exchange Rate Table -->
    <div class="exchange-rate-table">
      <div class="rate-row">
        <span class="rate-label">Today's Rate</span>
      </div>
      <div class="rate-row">
        <span class="rate-value">₳1 ADA</span>
        <span class="rate-equals">=</span>
        <span class="rate-value">€1.00 EUR</span>
      </div>
    </div>
    
    <!-- Amount Input Section -->
    <div class="amount-section">
      <!-- ADA Input -->
      <div class="amount-input-container">
        <div class="input-header">
          <span class="input-label">Amount</span>
        </div>
        <div class="input-content">
          <input
            v-model="adaAmount"
            type="number"
            placeholder="0"
            class="custom-input"
            @input="updateEurAmount"
          />
          <span class="currency-badge">ADA</span>
        </div>
      </div>
      
      <!-- Switch Button -->
      <div class="switch-button">
        <v-btn icon class="switch-icon" @click="switchCurrencies">
          <v-icon color="white" size="20">mdi-swap-vertical</v-icon>
        </v-btn>
      </div>
      
      <!-- EUR Input -->
      <div class="amount-input-container">
        <div class="input-header">
          <span class="input-label">Amount</span>
        </div>
        <div class="input-content">
          <input
            v-model="eurAmount"
            type="number"
            placeholder="0"
            class="custom-input"
            @input="updateAdaAmount"
          />
          <span class="currency-badge">EUR</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

// Props
interface Props {
  modelValue: {
    adaAmount: string;
    eurAmount: string;
  };
}

const props = defineProps<Props>();

// Emits
const emit = defineEmits<{
  (e: 'update:modelValue', value: { adaAmount: string; eurAmount: string }): void;
}>();

// Reactive data
const adaAmount = ref(props.modelValue.adaAmount);
const eurAmount = ref(props.modelValue.eurAmount);
const isUpdatingFromAda = ref(false);
const isUpdatingFromEur = ref(false);

// Exchange rate (1:1)
const EXCHANGE_RATE = 1;

const updateEurAmount = () => {
  if (isUpdatingFromEur.value) return;
  
  isUpdatingFromAda.value = true;
  const ada = parseFloat(adaAmount.value) || 0;
  eurAmount.value = (ada * EXCHANGE_RATE).toFixed(2);
  isUpdatingFromAda.value = false;
  
  emit('update:modelValue', {
    adaAmount: adaAmount.value,
    eurAmount: eurAmount.value
  });
};

const updateAdaAmount = () => {
  if (isUpdatingFromAda.value) return;
  
  isUpdatingFromEur.value = true;
  const eur = parseFloat(eurAmount.value) || 0;
  adaAmount.value = (eur / EXCHANGE_RATE).toFixed(2);
  isUpdatingFromEur.value = false;
  
  emit('update:modelValue', {
    adaAmount: adaAmount.value,
    eurAmount: eurAmount.value
  });
};

const switchCurrencies = () => {
  const tempAda = adaAmount.value;
  const tempEur = eurAmount.value;
  
  adaAmount.value = tempEur;
  eurAmount.value = tempAda;
  
  emit('update:modelValue', {
    adaAmount: adaAmount.value,
    eurAmount: eurAmount.value
  });
};

// Watch for changes to sync the amounts
watch(adaAmount, () => {
  if (!isUpdatingFromEur.value) {
    updateEurAmount();
  }
});

watch(eurAmount, () => {
  if (!isUpdatingFromAda.value) {
    updateAdaAmount();
  }
});

// Watch for external changes
watch(() => props.modelValue, (newValue) => {
  adaAmount.value = newValue.adaAmount;
  eurAmount.value = newValue.eurAmount;
}, { deep: true });
</script>

<style lang="scss" scoped>
@import '../../../styles/variables';
@import '../../../styles/mixins';

.amount-input-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  padding: $spacing-2xl $spacing-2xl $spacing-md;
}

.currency-icon {
  width: 48px;
  height: 48px;
  background: $background-secondary;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $spacing-sm;
  width: 100%;
}

.modal-title {
  @include heading-style($font-size-2xl);
  color: $text-primary;
  margin: 0;
  line-height: 1.17;
  text-align: center;
  font-weight: 600;
  font-size: 24px;
}

.modal-subtitle {
  @include body-text($font-size-base);
  color: $text-secondary;
  margin: 0;
  line-height: 1.5;
  text-align: center;
  font-size: 16px;
}

.exchange-rate-table {
  display: flex;
  gap: 16px;
  padding: $spacing-sm $spacing-md;
  align-items: center;
  justify-content: center;
  background: #0c111d;
  border: 1px solid #1f242f;
  border-radius: $border-radius-md;
  width: fit-content;
}

.rate-row {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  justify-content: center;
}

.rate-label {
  font-family: Inter;
  font-weight: 600;
  font-size: 14px;
  line-height: 1.43;
  color: #cecfd2;
}

.rate-value {
  font-family: Inter;
  font-weight: 600;
  font-size: 14px;
  line-height: 1.43;
  color: $text-primary;
}

.rate-equals {
  font-family: Inter;
  font-weight: 600;
  font-size: 14px;
  line-height: 1.43;
  color: $text-primary;
}

.amount-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $spacing-md;
  width: 100%;
}

.amount-input-container {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
  padding: $spacing-sm $spacing-md;
  background: $background-secondary;
  border: 1px solid #1f242f;
  border-radius: $border-radius-md;
  width: 100%;
}

.input-header {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
}

.input-label {
  font-family: Inter;
  font-weight: 600;
  font-size: 14px;
  line-height: 1.43;
  color: #cecfd2;
}

.input-content {
  display: flex;
  align-items: center;
  gap: $spacing-md;
  width: 100%;
}

.custom-input {
  flex: 1;
  font-family: Inter;
  font-weight: 600;
  font-size: 24px;
  line-height: 1.58;
  color: $text-primary;
  padding: 0;
  text-align: left;
  background: transparent;
  border: none;
  outline: none;
  box-shadow: none;

  &::placeholder {
    color: $text-secondary;
    opacity: 0.7;
  }

  &:focus {
    outline: none;
    border: none;
    box-shadow: none;
  }

  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  &[type="number"] {
    -moz-appearance: textfield;
  }
}

.currency-badge {
  font-family: Inter;
  font-weight: 600;
  font-size: 24px;
  line-height: 1.58;
  color: $text-primary;
  white-space: nowrap;
}

.switch-button {
  display: flex;
  justify-content: center;
  align-items: center;
}

.switch-icon {
  width: 48px;
  height: 48px;
  background: linear-gradient(135deg, #00c7f3 0%, #00ffd1 100%);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: none;
  
  &:hover {
    background: linear-gradient(135deg, #00c7f3 0%, #00ffd1 100%);
  }
}
</style> 