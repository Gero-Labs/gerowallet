<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    :title="t('staking.withdrawStakingRewards')"
    icon="mdi-lock-open-outline"
    :loading="loading"
    :min-height="380"
    :height="620"
    size="lg"
    :persistent="false"
  >
    <div class="withdraw-gate">
      <!-- What is being held back -->
      <div class="withdraw-gate__amount">
        <span class="t-body-sm">{{ $t('staking.rewardsAmount') }}</span>
        <span class="t-title g-num">{{ rewardsDisplay }}</span>
      </div>

      <!-- The gate itself: the on-chain rule, stated plainly -->
      <div class="withdraw-gate__notice">
        <v-icon class="withdraw-gate__notice-icon" size="18">mdi-lock-outline</v-icon>
        <p class="t-body-sm withdraw-gate__notice-text">
          <strong class="withdraw-gate__emph">{{ $t('governance.withdrawGateTitle') }}</strong>
          {{ $t('governance.withdrawGateBody') }}
          <a
            class="withdraw-gate__link"
            :href="GOV_TOOLS_DOCS_URL"
            target="_blank"
            rel="noopener noreferrer"
          >{{ $t('governance.readWhy') }}</a>
        </p>
      </div>

      <ErrorState v-if="buildError" :message="buildError" retryable @retry="withdrawWithAbstain()" />

      <!-- Phase 1: the two ways out -->
      <div v-else-if="!tx" class="withdraw-gate__paths">
        <GButton tier="primary" block :disabled="loading" @click="goToDReps()">
          {{ $t('governance.chooseDRepThenWithdraw') }}
        </GButton>
        <GButton tier="secondary" block :loading="loading" @click="withdrawWithAbstain()">
          {{ $t('governance.withdrawWithAbstain') }}
        </GButton>
        <p class="t-caption withdraw-gate__footnote">{{ $t('governance.withdrawGateFootnote') }}</p>
      </div>

      <!-- Phase 2: review the bundled transaction and sign it -->
      <v-form v-else ref="form" v-model="valid" class="withdraw-gate__review">
        <div class="withdraw-gate__summary">
          <div class="withdraw-gate__summary-cell">
            <span class="t-label">{{ $t('governance.dRepDelegation') }}</span>
            <span class="t-body-sm withdraw-gate__summary-value">{{ $t('governance.alwaysAbstain') }}</span>
          </div>
          <div class="withdraw-gate__summary-cell">
            <span class="t-label">{{ $t('staking.rewardsAmount') }}</span>
            <span class="t-body-sm withdraw-gate__summary-value g-num">{{ rewardsDisplay }}</span>
          </div>
          <div class="withdraw-gate__summary-cell">
            <span class="t-label">{{ $t('governance.txFee') }}</span>
            <span class="t-body-sm withdraw-gate__summary-value g-num">{{ feeDisplay }}</span>
          </div>
        </div>

        <div class="withdraw-gate__auth">
          <TransactionAuthSection
            :wallet-type="loggedWallet.type"
            :is-prf-wallet="isPrfWallet"
            :is-signed="isSubmit"
            :loading="loading"
            :password="spendingPassword"
            @update:password="spendingPassword = $event"
            :password-label="t('wallet.spendingPassword')"
            :password-rules="passwordRules"
            :submit-text="t('governance.submitTransaction')"
            submit-color="primary"
            :submit-elevation="0"
            :show-bt-toggle="isBTSupported"
            :is-b-t="isBT"
            @update:isBT="isBT = $event"
            :usb-text="t('governance.usb')"
            :bluetooth-text="t('governance.bluetooth')"
            @passkey-success="handlePassKeyAuthSuccess"
            @passkey-error="handlePassKeyAuthError"
            @autofill-success="handlePassKeySuccess"
            @autofill-error="handlePassKeyError"
            @submit="signAndSubmit"
            @enter="signAndSubmit"
            @password-field-ref="setPasswordFieldRef"
          />
          <v-btn
            v-if="!isPrfWallet"
            color="primary"
            elevation="0"
            height="40"
            :disabled="loading || !valid"
            :loading="loading"
            @click="signAndSubmit"
          >
            {{ isSubmit ? t('governance.submitTransaction') : t('staking.signAndWithdraw') }}
          </v-btn>
        </div>
      </v-form>

      <div class="withdraw-gate__cancel">
        <GButton tier="tertiary" compact :disabled="loading" @click="$emit('close')">
          {{ $t('common.cancel') }}
        </GButton>
      </div>
    </div>

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
/**
 * The withdrawal gate.
 *
 * CIP-1694 holds staking rewards on a registered stake key until that key has
 * delegated its vote, so `useWithdrawal` cannot build a bare withdrawal for an
 * undelegated wallet. This dialog is what that blocked branch raises, and it
 * exists because the rule has exactly two remedies and the old dead-end
 * dialog offered neither properly:
 *
 *  1. Delegate to a real DRep, then withdraw. Two transactions, but the stake
 *     gets a voice. This is the primary path and it leaves for the directory.
 *  2. Delegate to always-abstain AND withdraw in ONE transaction. One
 *     signature, one fee, no voice. Built locally because neither nexus
 *     builder can carry a certificate and a withdrawal in the same body.
 */
import { ref, computed, watch, toRefs } from 'vue';
import { useRouter } from 'vue-router/composables';
import { Cardano } from '@cardano-sdk/core';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useTransactionSigning } from '@/shared/composables/useTransactionSigning';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import { isStakeKeyRegistered } from '@/shared/utils/stakeRegistration';
import { clearWithdrawableAmount } from '@/shared/utils/autoWithdraw';
import { buildAbstainWithdrawalTx } from './withdrawGateBundle';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import { WalletType } from '@/models/types';

const props = defineProps({
  isOpen: { type: Boolean, default: false },
});

const emit = defineEmits(['close']);

const { t } = useTranslation();
const router = useRouter();
const { toCurrency } = filters;

const { loggedWallet, account, utxos, keys } = toRefs(walletStore);
const { epochParams, tip } = toRefs(networkStore);

/** Cardano Foundation's explanation of the rule. Constant, not author-supplied. */
const GOV_TOOLS_DOCS_URL = 'https://docs.gov.tools/';

// `undefined`, not `null`: useTransactionSigning types its tx as
// `Ref<Cardano.Tx | undefined>` and watches it for the CBOR it signs.
const tx = ref<Cardano.Tx | undefined>(undefined);
const buildError = ref('');

const currencySymbol = computed(() =>
  networks.resolveCurrencySymbol(loggedWallet.value?.chain, loggedWallet.value?.network),
);

const rewardsDisplay = computed(() =>
  toCurrency(account.value?.withdrawable_amount ?? '0', false, 2, currencySymbol.value),
);

/** Straight off the built body, so the number shown is the number signed. */
const feeDisplay = computed(() =>
  toCurrency(tx.value?.body?.fee?.toString() ?? '0', false, 2, currencySymbol.value),
);

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
  tx,
  successMessageKey: 'staking.withdrawalSubmitted',
  // Zero the local rewards balance so a second withdrawal before the next
  // account sync cannot re-attach the amount that was just claimed (issue 941).
  onSuccess: () => clearWithdrawableAmount(),
  onClose: () => emit('close'),
});

const form = ref<{ validate: () => boolean; resetValidation: () => void } | null>(null);

function goToDReps(): void {
  emit('close');
  router.push({ name: 'governanceDReps' });
}

/**
 * Build the one transaction that carries BOTH the always-abstain vote
 * delegation and the withdrawal. The gate only lifts once that body exists,
 * so a build failure surfaces here rather than at signing time.
 */
async function withdrawWithAbstain(): Promise<void> {
  buildError.value = '';
  if (!loggedWallet.value || !keys.value?.stake?.length || !keys.value?.payment?.length) {
    buildError.value = String(t('errors.networkError'));
    return;
  }
  if (!epochParams.value) {
    buildError.value = String(t('common.epochParametersNotAvailable'));
    return;
  }

  loading.value = true;
  try {
    tx.value = await buildAbstainWithdrawalTx(
      {
        stakeKeyHash: keys.value.stake[0].cred,
        stakeAddress: loggedWallet.value.stakeAddress,
        withdrawableAmount: account.value?.withdrawable_amount,
        registered: isStakeKeyRegistered(account.value),
        stakeKeyDeposit: epochParams.value.stakeKeyDeposit,
      },
      {
        utxos: utxos.value as Cardano.Utxo[],
        epochParams: epochParams.value,
        changeAddress: keys.value.payment[0].address,
        tip: tip.value,
        walletContext: {
          keys: keys.value,
          stakeAddress: loggedWallet.value.stakeAddress,
          accountIndex: 0,
        },
      },
      buildCardanoTransaction,
    );
  } catch (error: unknown) {
    console.error('Error building the abstain + withdrawal bundle:', error);
    const message = error instanceof Error ? error.message : String(t('errors.unknownError'));
    buildError.value = `${t('errors.buildTransactionFailed')}: ${message}`;
    tx.value = undefined;
  } finally {
    loading.value = false;
  }
}

async function signAndSubmit(): Promise<void> {
  await handleSign(form.value || undefined);
}

watch(
  () => props.isOpen,
  open => {
    if (!open) return;
    resetState();
    tx.value = undefined;
    buildError.value = '';
    if (form.value) form.value.resetValidation();
  },
);
</script>

<style scoped>
.withdraw-gate {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: 0 var(--g-s-2) var(--g-s-2);
}
.withdraw-gate__amount {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-4) var(--g-s-5);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}
.withdraw-gate__notice {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-3);
  padding: var(--g-s-3) var(--g-s-4);
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
  border-radius: var(--g-r-control);
}
.withdraw-gate__notice-icon {
  color: var(--g-warning);
  flex: none;
}
.withdraw-gate__notice-text {
  margin: 0;
}
.withdraw-gate__emph {
  color: var(--g-text-1);
  font-weight: 550;
}
.withdraw-gate__link {
  color: var(--g-accent);
  font-weight: 550;
}
.withdraw-gate__paths {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.withdraw-gate__footnote {
  margin: 0;
  text-align: center;
}
.withdraw-gate__review {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}
.withdraw-gate__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--g-s-3);
}
.withdraw-gate__summary-cell {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  padding: var(--g-s-3) var(--g-s-4);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}
.withdraw-gate__summary-value {
  color: var(--g-text-1);
  font-weight: 550;
}
.withdraw-gate__auth {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--g-s-3);
  flex-wrap: wrap;
}
.withdraw-gate__cancel {
  display: flex;
  justify-content: center;
  border-top: 1px solid var(--g-hairline-1);
  padding-top: var(--g-s-3);
}
</style>
