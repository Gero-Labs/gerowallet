<template>
  <BaseDialog persistent :width="600" :isOpen="isOpen" @close="resetState(); $emit('close')" :min-height="250"
              :title="t('settings.setCollateral')" :loading="loading" :subtitle="t('settings.collateralDescription')">
    <v-card-actions class="justify-center text-center pt-4" v-if="tx">
      <v-form ref="form" v-model="valid">
        <v-row no-gutters>
          <v-col cols="6">
            <h4>{{ $t('settings.collateralAmount') }}</h4>
            <h4><strong>{{ toCurrency(collateralLovelace) }}</strong></h4>
          </v-col>
          <v-col cols="6">
            <h4>{{ $t('send.fee') }}</h4>
            <h4><strong>{{ toCurrency(tx?.body?.fee?.toString() || '0') }}</strong></h4>
          </v-col>
          <v-col cols="12" class="pt-6" style="display: flex; justify-content: space-evenly;">
            <TransactionAuthSection
              :wallet-type="loggedWallet?.type"
              :is-prf-wallet="isPrfWallet"
              :is-signed="isSubmit"
              :loading="loading"
              :password="spendingPassword"
              @update:password="spendingPassword = $event"
              :password-label="t('wallet.spendingPassword')"
              :password-rules="passwordRules"
              :submit-text="t('common.submit')"
              submit-color="primary"
              :submit-elevation="0"
              :show-bt-toggle="isBTSupported"
              :is-b-t="isBT"
              @update:isBT="isBT = $event"
              :usb-text="t('wallet.usb')"
              :bluetooth-text="t('wallet.bluetooth')"
              @passkey-success="handlePassKeyAuthSuccess"
              @passkey-error="handlePassKeyAuthError"
              @autofill-success="handlePassKeySuccess"
              @autofill-error="handlePassKeyError"
              @submit="signCollateralTx"
              @enter="signCollateralTx"
              @password-field-ref="setPasswordFieldRef"
              button-style="width: 295px; max-width: 295px"
            />
            <!-- PRF wallets submit from TransactionAuthSection; password and hardware wallets use this button. -->
            <GButton
              v-if="!isPrfWallet"
              tier="primary"
              class="mx-2"
              :disabled="loading || !valid"
              :loading="loading"
              @click="signCollateralTx"
            >
              {{ isSubmit ? $t('common.submit') : $t('wallet.signAndConfirm') }}
            </GButton>
          </v-col>
        </v-row>
      </v-form>
    </v-card-actions>

    <KeystoneSignDialog
      :isOpen="overlay && loggedWallet?.type === WalletType.Keystone"
      :keystoneType="keystoneType"
      :keystoneCbor="keystoneCbor"
      @close="resetState()"
      @scan="onKeystoneScan"
      @error="onKeystoneError"
      @progress="onKeystoneProgress"
    />
  </BaseDialog>
</template>
<script setup lang="ts">
/**
 * Signs and submits the wallet's own "Set Collateral" transaction (5 ADA to its own address)
 * through the in-wallet signing path (useTransactionSigning → MessageTypes.SIGN_TX), like the
 * staking and governance dialogs. It must not go through the dApp CIP-30 signTx route: that
 * route only serves whitelisted dApp origins and refuses the wallet's own pages (issue 1558).
 */
import { useTranslation } from '@/shared/composables/useTranslation';
import { useTransactionSigning } from '@/shared/composables/useTransactionSigning';
import { ref, computed, watch, toRefs } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import filters from '@/shared/utils/filters';
import { Cardano } from '@cardano-sdk/core';
import { WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';

const { t } = useTranslation();

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  tx: {
    type: Object as () => Cardano.Tx,
    required: false,
    default: undefined,
  },
  collateralLovelace: {
    type: String,
    default: '5000000',
  },
});

const emit = defineEmits(['close', 'success']);

const { toCurrency } = filters;

const { loggedWallet } = toRefs(walletStore);

const txRef = computed(() => props.tx);
const {
  loading,
  spendingPassword,
  isSubmit,
  isBT,
  valid,
  passwordRules,
  isPrfWallet,
  isBTSupported,
  handleSign,
  resetState,
  handlePassKeySuccess,
  handlePassKeyError,
  handlePassKeyAuthSuccess,
  handlePassKeyAuthError,
  setPasswordFieldRef,
  overlay,
  keystoneType,
  keystoneCbor,
  onKeystoneScan,
  onKeystoneError,
  onKeystoneProgress,
} = useTransactionSigning({
  active: () => props.isOpen,
  tx: txRef,
  successMessageKey: 'settings.collateralTxSetSuccess',
  onSuccess: (txId: string) => emit('success', txId),
  onClose: () => emit('close'),
});

const form = ref(null);

const signCollateralTx = async () => {
  await handleSign(form.value || undefined);
};

watch(() => props.isOpen, (val) => {
  if (val) {
    resetState();
    if (form.value) {
      form.value.resetValidation();
    }
  }
});
</script>
