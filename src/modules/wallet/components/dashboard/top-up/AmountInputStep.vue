<template>
  <div class="amount-input-step">
    <!-- Title and Subtitle -->
    <div class="header-text">
      <h2 class="modal-title">Top up your Gero card balance</h2>
      <p class="modal-subtitle">Swap your ADA to Euro with real-time exchange rate</p>
    </div>

    <!-- Exchange Rate Table -->
    <div class="exchange-rate-table">
      <div class="rate-row">
        <span class="rate-label">Today's Rate</span>
      </div>
      <div class="rate-row">
        <span class="rate-value">₳1 ADA</span>
        <span class="rate-equals">=</span>
        <span class="rate-value">€0.65 EUR</span>
      </div>
    </div>

    <!-- Wallet Balance -->
    <div class="wallet-balance">
      <span class="balance-label">Your ADA Balance:</span>
      <span class="balance-value">₳{{ adaBalance }}</span>
    </div>

    <!-- Amount Input Section -->
    <div class="amount-section">
      <!-- First Input (ADA or EUR based on switch state) -->
      <div class="amount-input-container">
        <div class="input-header">
          <span class="input-label">Amount</span>
        </div>
        <div class="input-content">
          <span class="currency-badge">{{ isSwitched ? '€' : '₳' }}</span>
          <input
            v-model="firstInputValue"
            type="number"
            placeholder="0"
            class="custom-input"
            @input="handleFirstInput"
            @focus="handleInputFocus"
          />
          <span class="currency-badge">{{ isSwitched ? 'EUR' : 'ADA' }}</span>
        </div>
      </div>

      <!-- Switch Button -->
      <div class="switch-button">
        <v-btn icon class="switch-icon" @click="() => {}">
          <v-icon color="white" size="20">mdi-swap-vertical</v-icon>
        </v-btn>
      </div>

      <!-- Second Input (EUR or ADA based on switch state) -->
      <div class="amount-input-container">
        <div class="input-header">
          <span class="input-label">Amount</span>
        </div>
        <div class="input-content">
          <span class="currency-badge">{{ isSwitched ? '₳' : '€' }}</span>
          <input
            v-model="secondInputValue"
            type="number"
            placeholder="0"
            class="custom-input"
            @input="handleSecondInput"
            @focus="handleInputFocus"
          />
          <span class="currency-badge">{{ isSwitched ? 'ADA' : 'EUR' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import walletStore from '@/stores/walletStore';

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
const isSwitched = ref(false);
const isUpdatingFromFirst = ref(false);
const isUpdatingFromSecond = ref(false);
const activeInput = ref<'first' | 'second' | null>(null);

// Exchange rate
const EXCHANGE_RATE = 0.65;

// Computed property for ADA balance
const adaBalance = computed(() => {
  if (walletStore.state.account?.controlled_amount) {
    // Convert lovelaces to ADA (1 ADA = 1,000,000 lovelaces)
    const ada = Number(walletStore.state.account.controlled_amount) / 1_000_000;
    return ada.toFixed(2);
  }
  return '0.00';
});

// Computed values for inputs based on switch state
const firstInputValue = computed({
  get: () => (isSwitched.value ? eurAmount.value : adaAmount.value),
  set: (value: string) => {
    if (isSwitched.value) {
      eurAmount.value = value;
    } else {
      adaAmount.value = value;
    }
  },
});

const secondInputValue = computed({
  get: () => (isSwitched.value ? adaAmount.value : eurAmount.value),
  set: (value: string) => {
    if (isSwitched.value) {
      adaAmount.value = value;
    } else {
      eurAmount.value = value;
    }
  },
});

const handleInputFocus = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.value === firstInputValue.value) {
    activeInput.value = 'first';
  } else {
    activeInput.value = 'second';
  }
};

const handleFirstInput = () => {
  if (isUpdatingFromSecond.value) return;

  isUpdatingFromFirst.value = true;
  const firstValue = parseFloat(firstInputValue.value) || 0;

  if (isSwitched.value) {
    // First input is EUR, second should be ADA
    adaAmount.value = (firstValue / EXCHANGE_RATE).toFixed(2);
  } else {
    // First input is ADA, second should be EUR
    eurAmount.value = (firstValue * EXCHANGE_RATE).toFixed(2);
  }

  isUpdatingFromFirst.value = false;

  const emitData = {
    adaAmount: adaAmount.value,
    eurAmount: eurAmount.value,
  };
  console.log('🔢 AmountInputStep emitting update:modelValue:', emitData);
  emit('update:modelValue', emitData);
};

const handleSecondInput = () => {
  if (isUpdatingFromFirst.value) return;

  isUpdatingFromSecond.value = true;
  const secondValue = parseFloat(secondInputValue.value) || 0;

  if (isSwitched.value) {
    // Second input is ADA, first should be EUR
    eurAmount.value = (secondValue * EXCHANGE_RATE).toFixed(2);
  } else {
    // Second input is EUR, first should be ADA
    adaAmount.value = (secondValue / EXCHANGE_RATE).toFixed(2);
  }

  isUpdatingFromSecond.value = false;

  const emitData = {
    adaAmount: adaAmount.value,
    eurAmount: eurAmount.value,
  };
  console.log('🔢 AmountInputStep emitting update:modelValue:', emitData);
  emit('update:modelValue', emitData);
};

const switchCurrencies = () => {
  isSwitched.value = !isSwitched.value;
};

// Watch for external changes
watch(
  () => props.modelValue,
  newValue => {
    adaAmount.value = newValue.adaAmount;
    eurAmount.value = newValue.eurAmount;
  },
  { deep: true }
);
</script>

<style lang="scss" scoped>
@import '../../../styles/variables';
@import '../../../styles/mixins';

.amount-input-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
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

.wallet-balance {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  justify-content: center;
  padding: $spacing-sm $spacing-md;
  background: #0c111d;
  border: 1px solid #1f242f;
  border-radius: $border-radius-md;
  width: fit-content;
}

.balance-label {
  font-family: Inter;
  font-weight: 500;
  font-size: 14px;
  line-height: 1.43;
  color: #cecfd2;
}

.balance-value {
  font-family: Inter;
  font-weight: 600;
  font-size: 14px;
  line-height: 1.43;
  color: #75e0a7;
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
  position: relative;
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
  margin-left: -10px;
  width: 100%;
  min-width: 0;

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

  &[type='number'] {
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
