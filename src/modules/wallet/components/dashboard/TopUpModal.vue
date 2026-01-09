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
            <!-- Show success alert when transaction is signed -->
            <v-alert
              v-if="currentStep === 2 && isSubmit"
              type="success"
              dense
              border="left"
              colored-border
              class="mx-6 mb-0"
            >
              <span>{{ t('card.transactionSigned') }}</span>
            </v-alert>

            <!-- Show info alert when Ledger is signing (buttons disabled) -->
            <v-alert
              v-if="
                currentStep === 2 &&
                walletStore.loggedWallet?.type === WalletType.Ledger &&
                !isSubmit &&
                txSubmitLoading
              "
              type="info"
              dense
              border="left"
              colored-border
              class="mx-6 mb-0"
            >
              <span>{{ t('card.pleaseReviewLedger') }}</span>
            </v-alert>

            <!-- Password field for Normal wallet on step 2 (hidden after signing) -->
            <div
              v-if="currentStep === 2 && walletStore.loggedWallet?.type === WalletType.Normal && !isSubmit"
              class="password-section"
            >
              <PassKeyPasswordField
                ref="passwordField"
                :value="spendingPassword"
                @input="spendingPassword = $event"
                outlined
                dense
                :label="t('wallet.spendingPassword')"
                hide-details
                class="password-field"
                :disabled="txSubmitLoading"
                @enter="handleTopUp"
                @passkey-autofill-success="handlePassKeySuccess"
                @passkey-autofill-error="handlePassKeyError"
              />
            </div>

            <!-- USB/Bluetooth toggle for Ledger wallet on step 2 (hidden after signing) -->
            <div
              v-else-if="currentStep === 2 && loggedWallet.btSupported && !isSubmit"
              class="ledger-section"
            >
              <ToggleSwitch
                :text-left="t('wallet.usb')"
                icon-left="mdi-usb"
                :text-right="t('wallet.bluetooth')"
                icon-right="mdi-bluetooth"
                v-model="isBT"
                :disabled="txSubmitLoading"
              />
            </div>

            <!-- Action Buttons -->
            <div class="modal-actions">
              <SecondaryButton :text="$t('wallet.cancel')" @click="closeModal()" :disabled="txSubmitLoading" />
              <v-tooltip top :disabled="canTopUp || currentStep !== 1">
                <template v-slot:activator="{ on, attrs }">
                  <div v-bind="attrs" v-on="on" style="flex: 1;">
                    <GradientButton
                      :text="currentStep === 1 ? t('card.continueButton') : isSubmit ? t('card.submitTransaction') : t('card.signAndTopUp')"
                      @click="handleTopUp"
                      :disabled="!canTopUp || txSubmitLoading"
                      :loading="txSubmitLoading"
                    />
                  </div>
                </template>
                <span>{{ disabledTooltip }}</span>
              </v-tooltip>
            </div>
          </div>

          <!-- Success Actions -->
          <div v-if="currentStep === 4" class="modal-actions">
            <SecondaryButton :text="t('card.backToYourAccount')" @click="handleBackToAccount" />
          </div>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { useTransactionSigning } from '@/shared/composables/useTransactionSigning';
import { ref, computed, toRefs } from 'vue';
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
import { Cardano } from '@cardano-sdk/core';
import snackbar from '@/plugins/snackbar';
import { WalletType } from '@/models/types';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';

const { t } = useTranslation();
const { loggedWallet } = toRefs(walletStore);

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
const passwordField = ref<any>(null);
const tx = ref<Cardano.Tx | undefined>(undefined);

// Use the transaction signing composable
const txRef = computed(() => tx.value);
const {
  loading: txSubmitLoading,
  spendingPassword,
  isSubmit,
  isBT,
  handleSign,
  resetState,
  handlePassKeySuccess: composableHandlePassKeySuccess,
  handlePassKeyError: composableHandlePassKeyError,
} = useTransactionSigning({
  tx: txRef,
  successMessageKey: 'notifications.transactionSubmitted',
  onSuccess: (txId: string) => {
    transactionId.value = txId;
    // Go to loading step
    currentStep.value = 3;
  },
});

// Computed: Check if Top Up button should be enabled
const canTopUp = computed(() => {
  if (currentStep.value === 1) {
    // Step 1: Check if amounts are valid and meet minimum requirement (2 ADA)
    const adaAmount = parseFloat(amounts.value.adaAmount);
    return !isNaN(adaAmount) && adaAmount >= 2 && amounts.value.eurAmount !== '';
  }
  if (currentStep.value === 2) {
    // Step 2: Check if password is required for Normal wallet
    if (walletStore.loggedWallet?.type === WalletType.Normal && !isSubmit.value) {
      return spendingPassword.value !== '';
    }
    return true; // Other wallet types don't need password, or transaction is already signed
  }
  return true;
});

// Computed: Tooltip message for disabled button
const disabledTooltip = computed(() => {
  if (currentStep.value === 1) {
    const adaAmount = parseFloat(amounts.value.adaAmount);
    if (isNaN(adaAmount) || adaAmount < 2) {
      return t('card.enterTwoAda');
    }
  }
  return '';
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
  resetState();
  tx.value = undefined;
};

const updateAmounts = (newAmounts: { adaAmount: string; eurAmount: string }) => {
  amounts.value = newAmounts;
};

const updateFeeOption = (newFeeOption: string) => {
  feeOption.value = newFeeOption;
};

// Use composable's passkey handlers
const handlePassKeySuccess = () => {
  composableHandlePassKeySuccess();
};

const handlePassKeyError = (error: string) => {
  composableHandlePassKeyError(error);
};

// Build transaction
const buildTx = async () => {
  try {
    const cardanoAddress = cardStore.state.cardanoAddress?.wallet_address;
    console.log('💰 Cardano address:', cardanoAddress);

    if (!cardanoAddress) {
      throw new Error(t('errors.invalidAddress'));
    }

    // Parse ADA amount and convert to Lovelace
    const adaAmount = parseFloat(amounts.value.adaAmount);
    if (isNaN(adaAmount) || adaAmount <= 0) {
      throw new Error(t('errors.invalidAmount'));
    }

    const lovelaceAmount = BigInt(Math.floor(adaAmount * 1_000_000)) as Cardano.Lovelace;
    console.log(`💰 Building transaction: ${adaAmount} ADA (${lovelaceAmount} Lovelace) to ${cardanoAddress}`);

    // Create output
    const outputs: Cardano.TxOut[] = [
      {
        address: cardanoAddress as Cardano.PaymentAddress,
        value: {
          coins: lovelaceAmount,
          assets: new Map(),
        },
      },
    ];

    // Build transaction with wallet context for accurate fee calculation
    tx.value = await buildCardanoTransaction({
      outputs,
      utxos: walletStore.utxos,
      epochParams: networkStore.epochParams,
      changeAddress: walletStore.loggedWallet.baseAddress,
      tip: networkStore.tip,
      walletContext: {
        keys: walletStore.keys,
        stakeAddress: walletStore.loggedWallet.stakeAddress,
        accountIndex: 0
      }
    });

    console.log('✅ Transaction built successfully');
    return true;
  } catch (e) {
    console.error('❌ Error building transaction:', e);
    snackbar.setError(e instanceof Error ? e.message : t('errors.buildTransactionFailed'));
    return false;
  }
};

// Simplified signing function that uses the composable
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

    // Build transaction first
    if (!isSubmit.value) {
      const buildSuccess = await buildTx();
      if (!buildSuccess) {
        console.error('❌ Failed to build transaction');
        return;
      }
    }

    // Use composable to handle signing and submission
    await handleSign();
  }
};

const handleLoadingComplete = async () => {
  await cardStore.fetchCardBalance();
  await cardStore.fetchCardHistory();

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

.ledger-section {
  padding: 0 24px 12px 24px;
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
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
