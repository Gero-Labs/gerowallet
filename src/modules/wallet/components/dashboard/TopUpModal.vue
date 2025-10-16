<template>
  <div>
    <v-dialog v-model="open" max-width="584" persistent content-class="order-card-modal">
      <v-card class="modal-card">
        <div class="modal-content">
          <!-- First Card: Amount Input -->
          <AmountInputStep v-if="currentStep === 1" :model-value="amounts" @update:modelValue="updateAmounts" />

          <!-- Second Card: Fee & Order Summary -->
          <SummaryStep
            v-if="currentStep === 2"
            :ada-amount="amounts.adaAmount"
            :eur-amount="amounts.eurAmount"
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
          <div v-if="currentStep < 3" class="modal-actions-wrapper">
            <!-- Password field for Normal wallet on step 2 -->
            <div v-if="currentStep === 2 && walletStore.loggedWallet?.type === WalletType.Normal" class="password-section">
              <v-text-field
                v-model="spendingPassword"
                outlined
                dense
                label="Spending Password"
                :type="showPassword ? 'text' : 'password'"
                hide-details
                class="password-field"
                :disabled="txSubmitLoading"
                @keydown.enter.prevent="handleTopUp"
              >
                <template v-slot:append>
                  <v-icon @click="showPassword = !showPassword" tabindex="-1">
                    {{ showPassword ? 'mdi-eye' : 'mdi-eye-off' }}
                  </v-icon>
                </template>
              </v-text-field>
            </div>

            <!-- Action Buttons -->
            <div class="modal-actions">
              <SecondaryButton text="Cancel" @click="closeModal()" :disabled="txSubmitLoading" />
              <GradientButton
                :text="currentStep === 1 ? 'Continue' : 'Top Up'"
                @click="handleTopUp"
                :disabled="!canTopUp || txSubmitLoading"
                :loading="txSubmitLoading"
              />
            </div>
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
import { ref, computed } from 'vue';
import SecondaryButton from '../SecondaryButton.vue';
import GradientButton from '../GradientButton.vue';
import AmountInputStep from './top-up/AmountInputStep.vue';
import SummaryStep from './top-up/SummaryStep.vue';
import LoadingStep from './top-up/LoadingStep.vue';
import SuccessStep from './top-up/SuccessStep.vue';
import cardStore from '@/stores/modules/card';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import { serializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { Cardano } from '@cardano-sdk/core';
import snackbar from '@/plugins/snackbar';
import { WalletType } from '@/models/types';

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
const feeOption = ref('ADA');
const transactionId = ref('1');
const spendingPassword = ref('');
const showPassword = ref(false);
const txSubmitLoading = ref(false);
const tx = ref<Cardano.Tx | undefined>(undefined);
const txCbor = ref('');
const txWitnesses = ref('');

// Computed: Check if Top Up button should be enabled
const canTopUp = computed(() => {
  if (currentStep.value === 1) {
    // Step 1: Check if amounts are valid
    const adaAmount = parseFloat(amounts.value.adaAmount);
    return !isNaN(adaAmount) && adaAmount > 0 && amounts.value.eurAmount !== '';
  }
  if (currentStep.value === 2) {
    // Step 2: Check if password is required for Normal wallet
    if (walletStore.loggedWallet?.type === WalletType.Normal) {
      return spendingPassword.value !== '';
    }
    return true; // Other wallet types don't need password
  }
  return true;
});

// Store amounts for the transaction (persists during loading)
const transactionAmounts = ref({
  adaAmount: '',
  eurAmount: '',
});

const closeModal = () => {
  emit('close');
  currentStep.value = 1;
  amounts.value = {
    adaAmount: '',
    eurAmount: '',
  };
  transactionAmounts.value = {
    adaAmount: '',
    eurAmount: '',
  };
  spendingPassword.value = '';
  showPassword.value = false;
  txSubmitLoading.value = false;
  tx.value = undefined;
  txCbor.value = '';
  txWitnesses.value = '';
};

const updateAmounts = (newAmounts: { adaAmount: string; eurAmount: string }) => {
  console.log('💰 updateAmounts called with:', newAmounts);
  amounts.value = newAmounts;
  console.log('💰 amounts.value updated to:', JSON.stringify(amounts.value));
  console.log('💰 amounts.value.adaAmount:', amounts.value.adaAmount);
  console.log('💰 amounts.value.eurAmount:', amounts.value.eurAmount);
};

const updateFeeOption = (newFeeOption: string) => {
  feeOption.value = newFeeOption;
};

// Build transaction
const buildTx = async () => {
  try {
    const cardanoAddress = cardStore.state.cardanoAddress?.wallet_address;
    console.log('💰 Cardano address:', cardanoAddress);

    if (!cardanoAddress) {
      throw new Error('Cardano address not found. Please ensure you are authenticated.');
    }

    // Parse ADA amount and convert to Lovelace
    const adaAmount = parseFloat(amounts.value.adaAmount);
    if (isNaN(adaAmount) || adaAmount <= 0) {
      throw new Error('Invalid ADA amount');
    }

    const lovelaceAmount = BigInt(Math.floor(adaAmount * 1_000_000)) as Cardano.Lovelace;
    console.log(`💰 Building transaction: ${adaAmount} ADA (${lovelaceAmount} Lovelace) to ${cardanoAddress}`);

    // Create output
    const outputs: Cardano.TxOut[] = [{
      address: cardanoAddress as Cardano.PaymentAddress,
      value: {
        coins: lovelaceAmount,
        assets: new Map()
      }
    }];

    // Build transaction
    tx.value = await buildCardanoTransaction({
      outputs,
      utxos: walletStore.utxos,
      epochParams: networkStore.epochParams,
      changeAddress: walletStore.loggedWallet.baseAddress,
      tip: networkStore.tip
    });

    console.log('✅ Transaction built successfully');
    return true;
  } catch (e) {
    console.error('❌ Error building transaction:', e);
    snackbar.setError(e instanceof Error ? e.message : 'Failed to build transaction');
    return false;
  }
};

// Sign transaction
const signTx = async (): Promise<boolean> => {
  txSubmitLoading.value = true;
  try {
    console.log('🔏 Signing transaction...');

    // Serialize transaction
    txCbor.value = serializeCardanoJsSdkTx(tx.value);
    console.log('📦 Serialized transaction CBOR');

    // Sign transaction
    const witnessResult = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_TX,
      data: {
        txCbor: txCbor.value,
        partialSign: false,
        password: spendingPassword.value,
        accountIndex: 0,
        utxos: walletStore.utxos,
        addresses: walletStore.keys,
        mergeWitnesses: false,
      }
    }) as { data: { witnesses?: any; error?: string } };

    if (witnessResult.data.error) {
      throw new Error(witnessResult.data.error);
    }

    console.log('✅ Transaction signed successfully');
    txWitnesses.value = witnessResult.data.witnesses;
    return true;
  } catch (e) {
    console.error('❌ Error signing transaction:', e);
    snackbar.setError(e instanceof Error ? e.message : 'Failed to sign transaction');
    return false;
  } finally {
    txSubmitLoading.value = false;
  }
};

// Submit transaction
const submitTx = async () => {
  try {
    txSubmitLoading.value = true;
    console.log('📤 Submitting transaction...');

    const submitResult = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SUBMIT_TX,
      data: {
        txCbor: txCbor.value,
        witnessHex: txWitnesses.value,
        utxos: walletStore.utxos
      }
    }) as { data: { txId?: string; error?: string } };

    if (submitResult.data.error) {
      throw new Error(submitResult.data.error);
    }

    console.log('✅ Transaction submitted successfully');
    transactionId.value = submitResult.data.txId || Math.floor(Math.random() * 100000000).toString();
    console.log('📝 Transaction ID:', transactionId.value);

    snackbar.fireSuccess(`Top-up transaction sent successfully!`);
    return true;
  } catch (e) {
    console.error('❌ Error submitting transaction:', e);
    snackbar.setError(e instanceof Error ? e.message : 'Failed to submit transaction');
    return false;
  } finally {
    txSubmitLoading.value = false;
  }
};

const handleTopUp = async () => {
  console.log(`🔄 handleTopUp called, currentStep: ${currentStep.value}`);

  if (currentStep.value === 1) {
    console.log('📈 Step 1 → Step 2');
    currentStep.value = 2;
  } else if (currentStep.value === 2) {
    console.log('📈 Step 2 → Processing transaction...');

    // Store transaction amounts for later use
    transactionAmounts.value = {
      adaAmount: amounts.value.adaAmount,
      eurAmount: amounts.value.eurAmount,
    };
    console.log(`💾 Stored amounts:`, transactionAmounts.value);

    // Build transaction
    const buildSuccess = await buildTx();
    if (!buildSuccess) {
      console.error('❌ Failed to build transaction');
      return;
    }

    // Verify spending password for Normal wallet
    if (walletStore.loggedWallet?.type === WalletType.Normal) {
      const passwordVerification = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.VERIFY_SPENDING_PASSWORD,
        data: { password: spendingPassword.value }
      }) as { data: { isValid: boolean; error?: string } };
      console.log('🔏 passwordVerification:', passwordVerification);
      if (!passwordVerification.data.isValid) {
        snackbar.setError('Invalid spending password');
        return;
      }
    }

    // Go to loading step
    currentStep.value = 3;

    let success = false;

    // Sign and submit transaction
    if (walletStore.loggedWallet?.type === WalletType.Normal) {
      const signSuccess = await signTx();
      if (signSuccess) {
        success = await submitTx();
      }
    } else {
      // For non-Normal wallets (if needed in future)
      snackbar.setError('Unsupported wallet type');
      currentStep.value = 2;
      return;
    }

    // Wait for loading animation (minimum 3 seconds for UX)
    await new Promise(resolve => setTimeout(resolve, 3000));

    if (success) {
      console.log('✅ Transaction successful!');
      // handleLoadingComplete will be called automatically
    } else {
      console.error('❌ Transaction failed, returning to summary');
      currentStep.value = 2; // Go back to summary
    }
  }
};

const handleLoadingComplete = () => {
  console.log('🎉 Top up completed successfully!');

  // Update card balance and add transaction using stored amounts
  const adaAmt = parseFloat(transactionAmounts.value.adaAmount) || 0;
  const eurAmt = parseFloat(transactionAmounts.value.eurAmount) || 0;

  console.log('🔄 Using stored transaction amounts:', { adaAmt, eurAmt });
  console.log('📝 Transaction ID:', transactionId.value);

  if (adaAmt > 0 && eurAmt > 0) {
    // Update card balance
    cardStore.updateCardBalance(eurAmt);

    // // Add transaction to history
    // cardStore.addTopUpTransaction(adaAmt, eurAmt, transactionId.value);
    //
    // // Add activity to recent activities
    // cardStore.addTopUpActivity(adaAmt, eurAmt);

    console.log(`✅ Balance updated: +€${eurAmt}, Transaction added: ${transactionId.value}, Activity added`);
  } else {
    console.error('❌ Invalid stored amounts:', { adaAmt, eurAmt });
  }

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

.modal-actions-wrapper {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.password-section {
  padding: 0 24px 12px 24px;
  width: 100%;
}

.password-field {
  width: 100%;

  :deep(.v-input__control) {
    background: #0c0e12;
  }

  :deep(.v-text-field__details) {
    display: none;
  }
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
