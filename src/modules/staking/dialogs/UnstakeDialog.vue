<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    :min-height="300"
    :title="t('staking.unstakeFromPool')"
    :subtitle="t('staking.unstakeSubtitle')"
    :loading="loading"
    :persistent="false"
  >
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1">
      <v-alert
        outlined
        border="left"
        color="warning"
        type="warning"
        prominent
        class="text-left"
      >
        {{ $t('staking.unstakingWillClaimRewards') }}<br>{{ $t('staking.verifyUnstakeDetails') }}
      </v-alert>
    </v-card-text>
    <v-card-actions class="justify-center text-center pt-0" v-if="account && tx">
      <v-form ref="form" v-model="valid" style="width: 100%">
        <v-row no-gutters >
          <v-col :cols="cols">
            <h4>{{ $t('staking.rewardsAmount') }}</h4>
            <h4><strong>{{ filters.toCurrency(withdrawals) }}</strong></h4>
          </v-col>
          <v-col :cols="cols" v-if="depositFee > 0">
            <h4>{{ $t('staking.depositFeeReturn') }}</h4>
            <h4><strong>{{ filters.toCurrency(depositFee) }}</strong></h4>
          </v-col>
          <v-col :cols="cols">
            <h4>{{ $t('staking.txFee') }}</h4>
            <h4><strong>{{ filters.toCurrency(tx?.body?.fee?.toString() || '0') }}</strong></h4>
          </v-col>
          <v-col :cols="cols">
            <h4>{{ $t('common.total') }}</h4>
            <h4><strong>{{ filters.toCurrency(Number(withdrawals)+Number(depositFee)-Number(tx?.body?.fee?.toString() || '0')) }}</strong></h4>
          </v-col>
          <v-col cols="12" class="pt-6" style="display: flex; justify-content: space-evenly;">
            <!-- Show success state when transaction is signed -->
            <v-alert
              v-if="isSubmit"
              type="success"
              dense
              border="left"
              colored-border
              class="mb-0"
              style="width: 100%;"
            >
              <span>{{ $t('staking.transactionSigned') }}</span>
            </v-alert>
            <!-- Password input (hidden after signing) -->
            <PassKeyPasswordField
              ref="passwordField"
              v-if="loggedWallet?.type === WalletType.Normal && !isSubmit"
              :value="spendingPassword"
              @input="spendingPassword = $event"
              outlined
              dense
              hide-details
              :label="t('wallet.spendingPassword')"
              :rules="passwordRules"
              :disabled="loading"
              required
              @enter="signUnStakeTx"
              @passkey-autofill-success="handlePassKeySuccess"
              @passkey-autofill-error="handlePassKeyError"
              style="width: 295px; max-width: 295px"
            />
            <div v-else-if="isBTSupported" class="py-0" style="align-content: center;">
              <v-card-subtitle class="pa-0 text-center justify-center pt-0" style="color: white">
                <ToggleSwitch :text-left="t('staking.usb')" icon-left="mdi-usb" :text-right="t('staking.bluetooth')" icon-right="mdi-bluetooth" v-model="isBT" :disabled="loading" />
              </v-card-subtitle>
            </div>
            <v-btn color="error" outlined elevation="0" @click="signUnStakeTx" height="40" :disabled="loading || (!valid && !isSubmit)" :loading="loading" class="mx-2" style="margin-bottom: 1px">
              {{ isSubmit ? $t('staking.submitTransaction') : $t('staking.signAndUnstake') }}
            </v-btn>
          </v-col>
        </v-row>
      </v-form>
    </v-card-actions>

    <!-- Keystone Sign Dialog -->
    <KeystoneSignDialog
      :isOpen="overlay && loggedWallet?.type === WalletType.Keystone"
      :keystoneType="keystoneType"
      :keystoneCbor="keystoneCbor"
      @close="overlay = false"
      @scan="onKeystoneScan"
      @error="onKeystoneError"
      @progress="onKeystoneProgress"
    />
  </BaseDialog>
</template>
<script setup lang="ts">
import { useTransactionSigning } from '@/shared/composables/useTransactionSigning';
import { computed, ref, toRefs, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import filters from '@/shared/utils/filters';
import { Cardano } from '@cardano-sdk/core';
import rules from '@/utils/rules';
import { WalletType } from '@/models/types';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { useTranslation } from '@/shared/composables/useTranslation';

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
  }
});

const emit = defineEmits(['close']);

const { loggedWallet, account } = toRefs(walletStore);
const { epochParams } = toRefs(networkStore);

// Use the transaction signing composable
const txRef = computed(() => props.tx);
const {
  loading,
  spendingPassword,
  isSubmit,
  isBT,
  valid,
  passwordRules,
  handleSign,
  resetState,
  handlePassKeySuccess,
  handlePassKeyError,
  setPasswordFieldRef,
  // Keystone state and methods
  overlay,
  keystoneType,
  keystoneCbor,
  onKeystoneScan,
  onKeystoneError,
  onKeystoneProgress,
} = useTransactionSigning({
  tx: txRef,
  successMessageKey: 'staking.unstakeTxSubmitted',
  onClose: () => emit('close'),
});

const form = ref<any>(null);
const passwordField = ref<any>(null);

const withdrawals = computed(() => {
  let withdrawalsAmount = 0;
  if (props.tx?.body?.withdrawals) {
    props.tx.body.withdrawals.forEach((withdrawal: Cardano.Withdrawal) => {
      if (withdrawal.stakeAddress === loggedWallet.value?.stakeAddress) {
        withdrawalsAmount += Number(withdrawal.quantity.toString());
      }
    });
  }
  return withdrawalsAmount;
});

const depositFee = computed(() => {
  const hasDeregistrationCert = props.tx.body.certificates?.some(
    cert => cert.__typename === Cardano.CertificateType.StakeDeregistration ||
      cert.__typename === Cardano.CertificateType.Unregistration
  );

  if (hasDeregistrationCert) {
    return epochParams.value.stakeKeyDeposit;
  }

  return 0;
});

const cols = computed(() => {
  return 3;
});

const signUnStakeTx = async () => {
  await handleSign(form.value || undefined);
};

const isBTSupported = computed(() => {
  return (loggedWallet.value?.type === WalletType.Ledger || loggedWallet.value?.type === WalletType.Trezor) &&
    !isSubmit &&
    loggedWallet.value?.btSupported;
});

watch(() => props.isOpen, (val) => {
  if (val) {
    resetState();
    if (form.value) {
      form.value.resetValidation();
    }
  }
});

watch(spendingPassword, () => {
  passwordRules.value = [rules.required()];
});

watch(passwordField, (newVal) => {
  if (newVal) {
    setPasswordFieldRef(newVal);
  }
});
</script>
<style scoped>

</style>
