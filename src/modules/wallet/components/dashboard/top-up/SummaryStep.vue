<template>
  <div class="summary-step">
    <!-- Title and Subtitle -->
    <div class="header-text">
      <h2 class="modal-title">Fee & Order Summary</h2>
      <p class="modal-subtitle">Confirm your preferred payment</p>
    </div>

    <!-- Exchange Rate Table -->
    <div class="exchange-rate-table">
      <div class="rate-row">
        <span class="rate-label">Today's Rate</span>
      </div>
      <div class="rate-row">
        <span class="rate-value">₳1 ADA</span>
        <span class="rate-equals">=</span>
        <span class="rate-value">€{{ EXCHANGE_RATE?.toFixed(2) }} EUR</span>
      </div>
    </div>

    <!-- GERO Info -->
    <div class="gero-info-container">
      <div class="gero-info-row">
        <span class="gero-info-label">Your $GERO Balance:</span>
        <span class="gero-info-value">{{ geroBalance }} GERO</span>
      </div>
      <div class="gero-info-row">
        <span class="gero-info-label">Your Tier:</span>
        <span class="gero-tier-badge" :class="geroTier.toLowerCase()">{{ geroTier }}</span>
      </div>
    </div>

    <!-- Summary Section -->
    <div class="summary-section">
      <!-- Fee Payment Options -->
      <div class="summary-container">
        <div class="summary-header">
          <span class="summary-label">Fee Payment</span>
          <div class="fee-options">
            <div
              class="fee-option"
              :class="{ selected: selectedFeeOption === 'ADA' }"
              @click="selectedFeeOption = 'ADA'"
            >
              <div class="radio-button" :class="{ selected: selectedFeeOption === 'ADA' }">
                <div class="radio-dot"></div>
              </div>
              <span class="fee-option-text">ADA</span>
            </div>
            <div
              class="fee-option"
              :class="{ selected: selectedFeeOption === 'GERO' }"
              @click="selectedFeeOption = 'GERO'"
            >
              <div class="radio-button" :class="{ selected: selectedFeeOption === 'GERO' }">
                <div class="radio-dot"></div>
              </div>
              <span class="fee-option-text">$GERO</span>
            </div>
          </div>
        </div>

        <!-- Transfer Details -->
        <div class="transfer-details">
          <div class="transfer-row">
            <span class="transfer-label">Transfer Amount</span>
            <div class="transfer-amount">
              <span class="amount-value">₳{{ adaAmount || '1000' }}</span>
              <span class="currency-badge">ADA</span>
            </div>
          </div>

          <div class="transfer-row">
            <span class="transfer-label">Transfer Fee</span>
            <span class="fee-amount">{{ selectedFeeOption === 'GERO' ? '₳0.00 ADA' : '₳1.00 ADA' }}</span>
          </div>

          <div class="divider"></div>

          <div class="transfer-row">
            <span class="transfer-label">Total Spend</span>
            <span class="total-amount"
              >₳{{ (parseFloat(adaAmount || '1') + (selectedFeeOption === 'GERO' ? 0 : 1)).toFixed(2) }} ADA</span
            >
          </div>
        </div>
      </div>

      <!-- You Receive Section -->
      <div class="summary-container">
        <div class="transfer-row">
          <span class="transfer-label">Card will receive exactly</span>
          <span class="receive-amount">€{{ eurAmount || '1' }} EUR</span>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import walletStore from '@/stores/walletStore';
import cardStore from '@/stores/modules/card';

// Props
interface Props {
  adaAmount: string;
  eurAmount: string;
}

const props = defineProps<Props>();

// Emits
const emit = defineEmits<{
  (e: 'update:password', value: string): void;
  (e: 'update:feeOption', value: string): void;
}>();

// Reactive data
const password = ref('');
const selectedFeeOption = ref('GERO');

// Exchange rate
const EXCHANGE_RATE = computed(() => {
  return Number(cardStore.state.exchangeRate?.buy);
});

// Computed properties for GERO token info
const geroBalance = computed(() => {
  // Look for GERO token in the tokens object
  const tokens = walletStore.state.tokens;
  if (tokens) {
    // Find GERO token by checking metadata ticker
    for (const [unit, token] of Object.entries(tokens)) {
      const tok: any = token;
      if (tok.metadata?.ticker === 'GERO' || tok.metadata?.name === 'GERO') {
        // Convert from smallest unit to display unit (assuming 6 decimals)
        const balance = Number(tok.quantity || 0) / 1_000_000;
        return balance.toFixed(2);
      }
    }
  }
  return '0.00';
});

// Determine GERO tier based on balance
const geroTier = computed(() => {
  const balance = parseFloat(geroBalance.value);

  // Force Gold tier for now since user has GERO tokens
  // TODO: Implement proper tier calculation based on actual requirements
  if (balance > 0) return 'Gold';

  // Tier thresholds (example values - adjust as needed)
  // if (balance >= 10000) return 'Gold';
  // if (balance >= 5000) return 'Silver';
  // if (balance >= 1000) return 'Bronze';
  return 'None';
});

// Watch for password changes
const updatePassword = (value: string) => {
  emit('update:password', value);
};

// Watch for fee option changes
const updateFeeOption = (value: string) => {
  selectedFeeOption.value = value;
  emit('update:feeOption', value);
};

// Watch for changes
watch(password, updatePassword);
watch(selectedFeeOption, updateFeeOption);
</script>

<style lang="scss" scoped>
@import '../../../styles/variables';
@import '../../../styles/mixins';

.summary-step {
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

// GERO Info Styles
.gero-info-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: $spacing-sm $spacing-md;
  background: #0c111d;
  border: 1px solid #1f242f;
  border-radius: $border-radius-md;
  width: fit-content;
}

.gero-info-row {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  justify-content: space-between;
  min-width: 250px;
}

.gero-info-label {
  font-family: Inter;
  font-weight: 500;
  font-size: 14px;
  line-height: 1.43;
  color: #cecfd2;
}

.gero-info-value {
  font-family: Inter;
  font-weight: 600;
  font-size: 14px;
  line-height: 1.43;
  color: #75e0a7;
}

.gero-tier-badge {
  font-family: Inter;
  font-weight: 600;
  font-size: 14px;
  line-height: 1.43;
  padding: 4px 12px;
  border-radius: 16px;
  text-transform: uppercase;

  &.gold {
    background: linear-gradient(135deg, #ffd700 0%, #ffa500 100%);
    color: #000;
  }

  &.silver {
    background: linear-gradient(135deg, #c0c0c0 0%, #808080 100%);
    color: #000;
  }

  &.bronze {
    background: linear-gradient(135deg, #cd7f32 0%, #8b4513 100%);
    color: #fff;
  }

  &.none {
    background: #333741;
    color: #cecfd2;
  }
}

// Summary Section Styles
.summary-section {
  display: flex;
  flex-direction: column;
  gap: $spacing-md;
  width: 100%;
}

.summary-container {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
  padding: 10px 16px;
  background: $background-secondary;
  border: 1px solid #1f242f;
  border-radius: $border-radius-md;
  width: 100%;
}

.summary-header {
  display: flex;
  align-items: center;
  justify-content: space-between;

  gap: $spacing-sm;
}

.summary-label {
  font-family: Inter;
  font-weight: 600;
  font-size: 14px;
  line-height: 1.43;
  color: #f5f5f6;
}

.fee-options {
  display: flex;
  gap: 8px;
}

.fee-option {
  display: flex;
  width: 146px;
  align-items: center;
  gap: $spacing-sm;
  padding: $spacing-md;
  border: 1px solid #22262f;
  border-radius: 12px;
  background: #0c0e12;
  cursor: pointer;

  &.selected {
    border-color: #00dff3;
    border-width: 2px;
  }
}

.radio-button {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid #373a41;
  display: flex;
  align-items: center;
  justify-content: center;

  &.selected {
    background: #00dff3;
    border-color: #00dff3;
  }
}

.radio-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: white;
  opacity: 0;

  .selected & {
    opacity: 1;
  }
}

.fee-option-text {
  font-family: Inter;
  font-weight: 500;
  font-size: 14px;
  line-height: 1.43;
  color: #cecfd2;
}

.transfer-details {
  display: flex;
  flex-direction: column;
  gap: $spacing-2xl;
}

.transfer-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: $spacing-md;
  height: 52px;
}

.transfer-label {
  font-family: Inter;
  font-weight: 600;
  font-size: 14px;
  line-height: 1.43;
  color: $text-primary;
}

.transfer-amount {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
}

.amount-value {
  font-family: Inter;
  font-weight: 600;
  font-size: 16px;
  line-height: 2.375;
  color: $text-primary;
}

.currency-badge {
  font-family: Inter;
  font-weight: 600;
  font-size: 16px;
  line-height: 2.375;
  color: $text-primary;
}

.fee-amount,
.total-amount,
.receive-amount {
  font-family: Inter;
  font-weight: 600;
  font-size: 16px;
  line-height: 1.25;
  color: $text-primary;
}

.divider {
  height: 1px;
  background: #333741;
  width: 100%;
}

// Password Section
.password-section {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
  width: 100%;
}

.password-label {
  font-family: Inter;
  font-weight: 500;
  font-size: 14px;
  line-height: 1.43;
  color: #cecfd2;
}

.password-input {
  width: 100%;
  padding: $spacing-sm $spacing-md;
  background: $background-dark;
  border: 1px solid #373a41;
  border-radius: $border-radius-md;
  font-family: Inter;
  font-weight: 400;
  font-size: 16px;
  line-height: 1.5;
  color: $text-primary;

  &::placeholder {
    color: $text-primary;
  }

  &:focus {
    outline: none;
    border-color: #00dff3;
  }
}
</style>
