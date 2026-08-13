<template>
  <BaseDialog :width="850"
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
        v-if="drepBlocked"
        border="left"
        color="warning"
        type="warning"
        prominent
        class="text-left mb-3"
      >
        <strong>{{ $t('staking.drepDelegationRequiredTitle') }}</strong>
        <p class="mb-0 mt-2">
          {{ $t('staking.unstakeDrepRequiredDesc') }}
        </p>
      </v-alert>
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

    <!-- Blocked: rewards pending but no DRep — the unstake tx cannot succeed
         in Conway, so route the user to Governance instead of the sign form -->
    <v-card-actions class="justify-center text-center pt-0" v-if="drepBlocked">
      <v-btn color="primary" elevation="2" block to="/governance" class="mx-2" @click="$emit('close')">
        {{ $t('staking.goToGovernanceDelegate') }}
      </v-btn>
    </v-card-actions>
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
            <!-- Transaction Authentication Section -->
            <TransactionAuthSection
              :wallet-type="loggedWallet?.type"
              :is-prf-wallet="isPrfWallet"
              :is-signed="isSubmit"
              :loading="loading"
              :password="spendingPassword"
              @update:password="spendingPassword = $event"
              :password-label="t('wallet.spendingPassword')"
              :password-rules="passwordRules"
              :submit-text="$t('staking.submitTransaction')"
              submit-color="error"
              :submit-elevation="0"
              :submit-outlined="true"
              :show-bt-toggle="isBTSupported"
              :is-b-t="isBT"
              @update:isBT="isBT = $event"
              :usb-text="t('staking.usb')"
              :bluetooth-text="t('staking.bluetooth')"
              @passkey-success="handlePassKeyAuthSuccess"
              @passkey-error="handlePassKeyAuthError"
              @autofill-success="handlePassKeySuccess"
              @autofill-error="handlePassKeyError"
              @submit="signUnStakeTx"
              @enter="signUnStakeTx"
              @password-field-ref="setPasswordFieldRef"
              button-style="width: 295px; max-width: 295px"
            />
            <!-- Hide action button for PRF wallets (handled above), show for password/hardware wallets -->
            <v-btn
              v-if="!isPrfWallet && isSubmit"
              color="error"
              outlined
              elevation="0"
              @click="signUnStakeTx"
              height="40"
              :disabled="loading || !valid"
              :loading="loading"
              class="mx-2"
              style="margin-bottom: 1px"
            >
              {{ $t('staking.submitTransaction') }}
            </v-btn>
            <v-btn
              v-else-if="!isPrfWallet && !isSubmit"
              color="error"
              outlined
              elevation="0"
              @click="signUnStakeTx"
              height="40"
              :disabled="loading || !valid"
              :loading="loading"
              class="mx-2"
              style="margin-bottom: 1px"
            >
              {{ $t('staking.signAndUnstake') }}
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
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';
import filters from '@/shared/utils/filters';
import { Cardano } from '@cardano-sdk/core';
import { WalletType, Blockchain } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { clearWithdrawableAmount } from '@/shared/utils/autoWithdraw';
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
  isPrfWallet,
  isBTSupported,
  handleSign,
  resetState,
  handlePassKeySuccess,
  handlePassKeyError,
  handlePassKeyAuthSuccess,
  handlePassKeyAuthError,
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
  // Unstake sweeps outstanding rewards — zero the local balance so a second
  // withdrawal/send before the next account sync doesn't re-attach it (issue 941)
  onSuccess: () => clearWithdrawableAmount(),
  onClose: () => emit('close'),
});

const form = ref<{ validate: () => boolean; resetValidation: () => void } | null>(null);

// Conway blocker (issue 951): with pending rewards and no DRep delegation the
// unstake tx cannot succeed (dereg needs a zero reward balance, withdrawal
// needs a DRep) — show the Governance CTA instead of the sign form
const drepBlocked = computed(() =>
  loggedWallet.value?.chain === Blockchain.CARDANO &&
  !account.value?.drep_id &&
  Number(account.value?.withdrawable_amount || 0) > 0,
);

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
  const hasDeregistrationCert = props.tx?.body?.certificates?.some(
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

watch(() => props.isOpen, (val) => {
  if (val) {
    resetState();
    if (form.value) {
      form.value.resetValidation();
    }
  }
});
</script>
<style scoped>

</style>
