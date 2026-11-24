<template>
  <BaseDialog persistent :width="560" :img="assets.withdrawalSvg" img-color="var(--g-text-1)" :isOpen="isOpen" @close="resetState(); $emit('close')" :min-height="300" :title="t('staking.withdrawStakingRewards')" :loading="loading"
              :subtitle="t('staking.withdrawSubtitle')">
    <!-- What the withdrawal does, as a receipt: rewards, less the fee (and a DRep
         donation when one applies), and what reaches the wallet. -->
    <v-card-text class="px-3 pb-2" style="z-index: 1" v-if="account && tx">
      <div class="wd-receipt glass-tier">
        <div class="wd-row">
          <span class="wd-k">{{ $t('staking.rewards') }}</span>
          <span class="wd-v g-num">{{ toCurrency(withdrawals) }}</span>
        </div>
        <div class="wd-row">
          <span class="wd-k">{{ $t('signTx.networkFee') }}</span>
          <span class="wd-v g-num">−{{ toCurrency(tx?.body?.fee?.toString() || '0') }}</span>
        </div>
        <div class="wd-row" v-if="compensationInfo && !compensationInfo.belowMinimum && !skipCompensation">
          <span class="wd-k">{{ $t('governance.compensationAmount', { percent: (compensationInfo.bps / 10).toFixed(1) + '%' }) }}</span>
          <span class="wd-v g-num">−{{ toCurrency(compensationInfo.donationLovelace) }}</span>
        </div>
        <div class="wd-row wd-row--total">
          <span class="wd-k">{{ $t('governance.youReceive') }}</span>
          <span class="wd-total g-num">{{ toCurrency(netWithdrawal) }}</span>
        </div>
      </div>
    </v-card-text>

    <!-- CIP-0149: DRep Compensation Breakdown -->
    <v-card-text class="px-3 pt-0" v-if="compensationInfo && !compensationInfo.belowMinimum && !skipCompensation">
      <!-- The donation's amount is a line of the receipt above; this explains it and offers the skip. -->
      <div class="wd-note glass-tier">
        <div class="wd-note__head">
          <v-icon size="small" color="primary">mdi-gift-outline</v-icon>
          <span class="t-body font-weight-medium">{{ $t('governance.drepCompensation') }}</span>
        </div>
        <p class="t-caption wd-note__text">
          {{ $t('governance.compensationWithdrawDesc', {
            drepName: currentDRepName,
            percent: (compensationInfo.bps / 10).toFixed(1) + '%'
          }) }}
        </p>
        <v-checkbox
          color="primary"
          :model-value="skipCompensation"
          @update:model-value="emit('update:skipCompensation', $event)"
          :label="$t('governance.skipCompensationThisTime')"
          density="compact"
          hide-details
        />
      </div>
    </v-card-text>

    <!-- CIP-0149: Below minimum notice -->
    <v-card-text class="px-3 pt-0" v-if="compensationInfo && compensationInfo.belowMinimum">
      <v-alert type="info" density="compact" variant="text" border="start" colored-border class="text-caption mb-0">
        {{ $t('governance.compensationSkippedBelowMinimum', {
          amount: toCurrency(compensationInfo.donationLovelace),
          min: toCurrency(compensationInfo.minUtxo)
        }) }}
      </v-alert>
    </v-card-text>

    <!-- Background on rewards: quiet, below the amounts it explains. -->
    <v-card-text class="px-3 pt-0">
      <ul class="wd-about t-caption">
        <li>{{ $t('staking.rewardsEarnedByDelegating') }}</li>
        <li>{{ $t('staking.stakingAllowsPassiveIncome') }}</li>
        <li>{{ $t('staking.rewardsDistributedEveryEpoch') }}</li>
        <li>{{ $t('staking.rewardsAutoRestaked') }}</li>
      </ul>
    </v-card-text>

    <v-card-actions class="wd-actions" v-if="account && tx">
      <v-form ref="form" v-model="valid" class="wd-form">
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
              button-style="width: 100%"
            />
            <!-- Hide action button for PRF wallets (handled above), show for password/hardware wallets -->
            <GButton
              v-if="!isPrfWallet"
              tier="primary"
              block
              :disabled="!valid"
              :loading="loading"
              @click="signWithdrawalTx()"
            >
              {{ isSubmit ? $t('staking.submitTransaction') : $t('staking.signAndWithdraw') }}
            </GButton>
      </v-form>
    </v-card-actions>

    <!-- Keystone Sign Dialog -->
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
import { useTranslation } from '@/shared/composables/useTranslation';
import { useTransactionSigning } from '@/shared/composables/useTransactionSigning';
import { ref, computed, watch, toRefs } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import assets from '@/utils/assets';
import filters from '@/shared/utils/filters';
import { Cardano } from '@cardano-sdk/core';
import { WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { clearWithdrawableAmount } from '@/shared/utils/autoWithdraw';


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
  active: () => props.isOpen,
  tx: txRef,
  successMessageKey: 'staking.withdrawalSubmitted',
  // Zero the local rewards balance so a second withdrawal/send before the
  // next account sync doesn't re-attach the already-claimed amount (issue 941)
  onSuccess: () => clearWithdrawableAmount(),
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
  const name = drep.metadata?.meta_json?.body?.['givenName'];
  if (typeof name === 'string') return name;
  if (name && typeof name === 'object' && '@value' in name && typeof name['@value'] === 'string') return name['@value'];
  return drep.drep_id || '';
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
<style scoped lang="scss">
// The amounts as a receipt: label left, figure right, the amount received last and largest.
.wd-receipt {
  padding: var(--g-s-3) var(--g-s-4);
  border-radius: var(--g-r-card);
}

.wd-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-1) 0;
}

.wd-k {
  color: var(--g-text-2);
}

.wd-v {
  color: var(--g-text-1);
}

.wd-row--total {
  margin-top: var(--g-s-2);
  padding-top: var(--g-s-3);
  border-top: 1px solid var(--g-hairline-1);

  .wd-k {
    color: var(--g-text-1);
    font-weight: 600;
  }
}

.wd-total {
  color: var(--g-accent);
  font-size: 20px;
  font-weight: 650;
}

// The DRep donation: its explanation and the skip; its amount is a receipt line.
.wd-note {
  padding: var(--g-s-3) var(--g-s-4);
  border-radius: var(--g-r-card);

  &__head {
    display: flex;
    align-items: center;
    gap: var(--g-s-2);
  }

  &__text {
    margin: var(--g-s-2) 0 0;
    color: var(--g-text-2);
  }
}

// Background on rewards, quiet beside the amounts.
.wd-about {
  margin: 0;
  padding-left: var(--g-s-4);
  color: var(--g-text-3);
  line-height: 1.6;
}

// The password (or device toggle) and the action, full width.
.wd-actions {
  padding: 0 var(--g-s-3) var(--g-s-3);
}

.wd-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}
</style>
