<template>
  <BaseDialog persistent :width="850" :isOpen="isOpen" @close="$emit('close')" :min-height="300" :title="t('staking.withdrawStakingRewards')" :loading="loading"
              :subtitle="t('staking.withdrawSubtitle')">
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1">
      <v-alert
        v-if="!account?.drep_id && loggedWallet?.chain === Blockchain.CARDANO"
        border="left"
        color="warning"
        type="warning"
        prominent
        class="text-left mb-3"
      >
        <strong>{{ $t('staking.drepDelegationRequiredTitle') }}</strong>
        <p class="mb-0 mt-2">
          {{ $t('staking.drepDelegationRequiredDesc') }}
        </p>
      </v-alert>
      <v-alert
        border="left"
        color="primary"
        type="info"
        prominent
        class="text-left"
      >
        <ul>
          <li>{{ $t('staking.rewardsEarnedByDelegating') }}</li>
          <li>{{ $t('staking.stakingAllowsPassiveIncome') }}</li>
          <li>{{ $t('staking.rewardsDistributedEveryEpoch') }}</li>
          <li>{{ $t('staking.rewardsAutoRestaked') }}</li>
        </ul>
      </v-alert>
    </v-card-text>

    <!-- CIP-0149: DRep Compensation Breakdown -->
    <v-card-text class="px-3 pt-0" v-if="compensationInfo && !compensationInfo.belowMinimum && !skipCompensation">
      <v-card flat outlined class="rounded-lg pa-3" style="border-color: var(--v-primary-base) !important">
        <div class="d-flex align-center mb-2">
          <v-icon small color="primary" class="mr-2">mdi-gift-outline</v-icon>
          <span class="text-subtitle-2 white--text font-weight-medium">{{ $t('governance.drepCompensation') }}</span>
        </div>
        <p class="text-caption text--secondary mb-3">
          {{ $t('governance.compensationWithdrawDesc', {
            drepName: currentDRepName,
            percent: (compensationInfo.bps / 10).toFixed(1) + '%'
          }) }}
        </p>
        <div class="d-flex justify-space-between text-caption mb-1">
          <span>{{ $t('governance.rewardsBeingWithdrawn') }}</span>
          <span>{{ toCurrency(withdrawals) }}</span>
        </div>
        <div class="d-flex justify-space-between text-caption mb-1 primary--text">
          <span>{{ $t('governance.compensationAmount', { percent: (compensationInfo.bps / 10).toFixed(1) + '%' }) }}</span>
          <span>−{{ toCurrency(compensationInfo.donationLovelace) }}</span>
        </div>
        <v-divider class="my-1"></v-divider>
        <div class="d-flex justify-space-between text-subtitle-2 font-weight-bold mt-1">
          <span>{{ $t('governance.youReceive') }}</span>
          <span>{{ toCurrency(withdrawals - compensationInfo.donationLovelace) }}</span>
        </div>
        <v-checkbox
          :input-value="skipCompensation"
          @change="emit('update:skipCompensation', $event)"
          :label="$t('governance.skipCompensationThisTime')"
          dense
          hide-details
          class="mt-2 pt-0"
        />
      </v-card>
    </v-card-text>

    <!-- CIP-0149: Below minimum notice -->
    <v-card-text class="px-3 pt-0" v-if="compensationInfo && compensationInfo.belowMinimum">
      <v-alert type="info" dense text border="left" colored-border class="text-caption mb-0">
        {{ $t('governance.compensationSkippedBelowMinimum', {
          amount: toCurrency(compensationInfo.donationLovelace),
          min: toCurrency(compensationInfo.minUtxo)
        }) }}
      </v-alert>
    </v-card-text>

    <v-card-actions class="justify-center text-center pt-0" v-if="account && tx">
      <v-form ref="form" v-model="valid">
        <v-row no-gutters>
          <v-col :cols="cols">
            <h4>{{ $t('staking.rewardsAmount') }}
              <v-btn x-small icon>
                <v-icon small>mdi-information-outline</v-icon>
              </v-btn>
            </h4>
            <h4><strong>{{ toCurrency(withdrawals) }}</strong></h4>
          </v-col>
          <v-col :cols="cols">
            <h4>{{ $t('staking.txFee') }}</h4>
            <h4><strong>{{ toCurrency(tx?.body?.fee?.toString() || '0') }}</strong></h4>
          </v-col>
          <v-col :cols="cols">
            <h4>{{ $t('common.total') }}</h4>
            <h4><strong>{{ toCurrency(netWithdrawal) }}</strong></h4>
          </v-col>
          <v-col cols="12" class="pt-6" v-if="!account?.drep_id && loggedWallet?.chain === Blockchain.CARDANO">
            <v-btn color="primary" elevation="2" block to="/governance" class="mx-2">
              {{ $t('staking.goToGovernanceDelegate') }}
            </v-btn>
          </v-col>
          <v-col cols="12" class="pt-6" v-else style="display: flex; justify-content: space-evenly;">
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
              :submit-text="t('staking.submitTransaction')"
              submit-color="primary"
              :submit-elevation="0"
              :show-bt-toggle="isBTSupported"
              :is-b-t="isBT"
              @update:isBT="isBT = $event"
              :usb-text="t('staking.usb')"
              :bluetooth-text="t('staking.bluetooth')"
              @passkey-success="handlePassKeyAuthSuccess"
              @passkey-error="handlePassKeyAuthError"
              @autofill-success="handlePassKeySuccess"
              @autofill-error="handlePassKeyError"
              @submit="signWithdrawalTx"
              @enter="signWithdrawalTx"
              @password-field-ref="setPasswordFieldRef"
              button-style="width: 295px; max-width: 295px"
            />
            <!-- Hide action button for PRF wallets (handled above), show for password/hardware wallets -->
            <v-btn
              v-if="!isPrfWallet && isSubmit"
              color="primary"
              elevation="0"
              @click="signWithdrawalTx"
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
              color="primary"
              elevation="0"
              @click="signWithdrawalTx"
              height="40"
              :disabled="loading || !valid"
              :loading="loading"
              class="mx-2"
              style="margin-bottom: 1px"
            >
              {{ $t('staking.signAndWithdraw') }}
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
import { useTranslation } from '@/shared/composables/useTranslation';
import { useTransactionSigning } from '@/shared/composables/useTransactionSigning';
import { ref, computed, watch, toRefs } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';
import filters from '@/shared/utils/filters';
import { Cardano } from '@cardano-sdk/core';
import { WalletType, Blockchain } from '@/models/types';
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
  compensationInfo: {
    type: Object as () => { bps: number; donationLovelace: number; belowMinimum: boolean; minUtxo: number } | null,
    default: null,
  },
  skipCompensation: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['close', 'update:skipCompensation']);

const { toCurrency } = filters;

const { loggedWallet, account } = toRefs(walletStore);

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
  successMessageKey: 'staking.withdrawalSubmitted',
  onClose: () => emit('close'),
});

const form = ref(null);

import { governanceStore } from '@/stores/governanceStore';

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

// CIP-0149: Net withdrawal after compensation
const netWithdrawal = computed(() => {
  const fee = Number(props.tx?.body?.fee?.toString() || '0');
  const donation = (props.compensationInfo && !props.compensationInfo.belowMinimum && !props.skipCompensation)
    ? props.compensationInfo.donationLovelace : 0;
  return withdrawals.value - fee - donation;
});

// CIP-0149: Current DRep name for display
const currentDRepName = computed(() => {
  const drep = governanceStore.currentDRep;
  if (!drep) return '';
  if (drep.metadata?.meta_json?.body?.givenName) {
    const name = drep.metadata.meta_json.body.givenName;
    return name['@value'] || name;
  }
  return drep.drep_id || '';
});

const cols = computed(() => {
  return 4;
});

const signWithdrawalTx = async () => {
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
