<template>
  <div>
    <v-dialog v-model="open" max-width="584" persistent content-class="order-card-modal">
      <v-card class="modal-card">
        <div class="modal-content">
          <!-- First Card: Amount Input -->
          <AmountInputStep v-if="currentStep === 1" :model-value="amounts" @update:model-value="updateAmounts" />

          <!-- Second Card: Fee & Order Summary -->
          <SummaryStep
            v-if="currentStep === 2"
            :ada-amount="amounts.adaAmount"
            :eur-amount="amounts.eurAmount"
            @update:password="updatePassword"
            @update:fee-option="updateFeeOption"
          />

          <!-- Third Card: Loading -->
          <LoadingStep v-if="currentStep === 3" :duration="14000" @complete="handleLoadingComplete" />

          <!-- Fourth Card: Success -->
          <SuccessStep
            v-if="currentStep === 4"
            :transaction-id="transactionId"
            @back-to-account="handleBackToAccount"
          />

          <!-- Actions Section -->
          <div v-if="currentStep < 3" class="modal-actions">
            <SecondaryButton text="Cancel" @click="closeModal()" />
            <GradientButton :text="currentStep === 1 ? 'Top Up' : 'Top Up'" @click="handleTopUp" />
          </div>

          <!-- Success Actions -->
          <div v-if="currentStep === 4" class="modal-actions">
            <SecondaryButton text="Back to Your Account" @click="handleBackToAccount" />
          </div>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import SecondaryButton from '../SecondaryButton.vue';
import GradientButton from '../GradientButton.vue';
import AmountInputStep from './top-up/AmountInputStep.vue';
import SummaryStep from './top-up/SummaryStep.vue';
import LoadingStep from './top-up/LoadingStep.vue';
import SuccessStep from './top-up/SuccessStep.vue';

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

// Reactive data
const currentStep = ref(1);
const amounts = ref({
  adaAmount: '',
  eurAmount: '',
});
const password = ref('');
const feeOption = ref('ADA');
const transactionId = ref('20023952');

const closeModal = () => {
  emit('close');
  currentStep.value = 1;
  password.value = '';
  amounts.value = {
    adaAmount: '',
    eurAmount: '',
  };
};

const updateAmounts = (newAmounts: { adaAmount: string; eurAmount: string }) => {
  amounts.value = newAmounts;
};

const updatePassword = (newPassword: string) => {
  password.value = newPassword;
};

const updateFeeOption = (newFeeOption: string) => {
  feeOption.value = newFeeOption;
};

const handleTopUp = () => {
  if (currentStep.value === 1) {
    currentStep.value = 2;
  } else if (currentStep.value === 2) {
    if (!password.value) {
      console.log('Please enter password');
      return;
    }

    console.log(`Final top up: ${amounts.value.adaAmount} ADA = ${amounts.value.eurAmount} EUR`);
    console.log(`Fee option: ${feeOption.value}`);
    console.log(`Password: ${password.value}`);

    currentStep.value = 3;
  }
};

const handleLoadingComplete = () => {
  console.log('Top up completed successfully!');
  transactionId.value = Math.floor(Math.random() * 100000000).toString();
  currentStep.value = 4;
};

const handleBackToAccount = () => {
  console.log('Back to account clicked');
  closeModal();
};
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.order-card-modal {
  border-radius: $border-radius-lg;
}

.modal-card {
  background: $background-dark;
  border-radius: $border-radius-lg;
  box-shadow: $shadow-md;
  position: relative;
}

.modal-content {
  padding: 12px;
}

.modal-actions {
  display: flex;
  gap: $spacing-md;
  width: 100%;
  margin-top: $spacing-md;
  padding: 24px;
}

.modal-actions :deep(.secondary-button),
.modal-actions :deep(.gradient-button) {
  flex: 1;
  width: 100%;
  height: $spacing-2xl;
  @include button-size($spacing-sm, $spacing-md, $font-size-base);
}
</style>
