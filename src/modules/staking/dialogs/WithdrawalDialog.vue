<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" :min-height="300" :title="$t('staking.withdrawStakingRewards')" :loading="loading"
              :subtitle="$t('staking.withdrawSubtitle')">
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1">
      <v-alert
        v-if="!account?.drep_id"
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
            <h4><strong>{{ toCurrency(withdrawals-Number(tx?.body?.fee?.toString() || '0')) }}</strong></h4>
          </v-col>
          <v-col cols="12" class="pt-6" v-if="!account?.drep_id">
            <v-btn color="primary" elevation="2" block to="/governance" class="mx-2">
              {{ $t('staking.goToGovernanceDelegate') }}
            </v-btn>
          </v-col>
          <v-col cols="12" class="pt-6" v-else style="display: flex; justify-content: space-evenly;">
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
            <BiometricPasswordField
              ref="passwordField"
              v-if="loggedWallet?.type === WalletType.Normal && !isSubmit"
              :value="spendingPassword"
              @input="spendingPassword = $event"
              outlined
              dense
              hide-details
              :label="$t('wallet.spendingPassword')"
              :rules="passwordRules"
              :disabled="loading"
              required
              @enter="signWithdrawalTx"
              @biometric-autofill-success="handleBiometricSuccess"
              @biometric-autofill-error="handleBiometricError"
              style="width: 295px; max-width: 295px"
            />
            <div v-else-if="loggedWallet?.type === WalletType.Ledger && !isSubmit" class="py-0" style="align-content: center;">
              <v-card-subtitle class="pa-0 text-center justify-center pt-0" style="color: white">
                <ToggleSwitch :text-left="$t('staking.usb')" icon-left="mdi-usb" :text-right="$t('staking.bluetooth')" icon-right="mdi-bluetooth" v-model="isBT" :disabled="loading" />
              </v-card-subtitle>
            </div>
            <v-btn color="primary" elevation="0" @click="signWithdrawalTx" height="40" :disabled="loading || (!valid && !isSubmit)" :loading="loading" class="mx-2" style="margin-bottom: 1px">
              {{ isSubmit ? 'Submit Transaction' : 'Sign & Withdraw' }}
            </v-btn>
          </v-col>
        </v-row>
      </v-form>
    </v-card-actions>
  </BaseDialog>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, watch, toRefs } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import BiometricPasswordField from '@/shared/components/BiometricPasswordField.vue';
import filters from '@/shared/utils/filters';
import { serializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { Cardano, Serialization } from '@cardano-sdk/core';
import rules from '@/utils/rules';
import snackbar from '@/plugins/snackbar';
import { WalletType } from '@/models/types';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { walletStore } from '@/stores/walletStore';
import ledgerUtils from '@/shared/utils/ledger';
import networks from '@/utils/networks';
import { DeviceStatusError } from '@cardano-foundation/ledgerjs-hw-app-cardano';


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

const { toCurrency } = filters;

const { loggedWallet, utxos, keys, account, config } = toRefs(walletStore);

const loading = ref(false);
const spendingPassword = ref('');
const passwordField = ref<any>(null);
const valid = ref(false);
const passwordRules = ref([rules.required()]);
const isBT = ref(false);
const form = ref<any>(null);
const txCbor = ref<string>('');
const txWitnesses = ref(null);
const isSubmit = ref(false);

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

const cols = computed(() => {
  return 4;
});

const handleBiometricError = (error: string) => {
  console.error('Biometric autofill error in WithdrawalDialog:', error);
  snackbar.setError(error || t('security.biometricAuthFailed'));
};

const handleBiometricSuccess = () => {
  console.log('✅ Biometric autofill successful in WithdrawalDialog - triggering sign');
  // Automatically trigger sign after successful biometric autofill
  setTimeout(() => {
    signWithdrawalTx();
  }, 300); // Small delay for UX feedback
};

const signTx = async (): Promise<boolean> => {
  loading.value = true;
  try {
    console.log('Signing Cardano JS SDK withdrawal transaction');
    console.log('Transaction:', props.tx);

    // First, verify password via a background message
    const passwordVerification = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.VERIFY_SPENDING_PASSWORD,
      data: { password: spendingPassword.value }
    }) as { data: { isValid: boolean; error?: string } };

    if (!passwordVerification.data.isValid) {
      passwordField.value?.showError(t('wallet.wrongSpendingPassword'));
      loading.value = false;
      return false;
    }

    // Serialize the Cardano.Tx to CBOR for Chrome messaging
    txCbor.value = serializeCardanoJsSdkTx(props.tx);
    console.log('Serialized transaction CBOR:', txCbor.value);

      // Sign the transaction via a background message
      const witnessResult = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SIGN_TX,
        data: {
          txCbor: txCbor.value, // Pass serialized CBOR instead of the object
          partialSign: false,
          password: spendingPassword.value,
          accountIndex: 0,
          utxos: utxos.value,
          addresses: keys.value, // Address mappings
          mergeWitnesses: false,
        }
      }) as { data: { witnesses?: any; error?: string } };

    console.log('Transaction signed successfully:', witnessResult);

    if (witnessResult.data.error) {
      throw new Error(witnessResult.data.error);
    }

    console.log('Signed transaction witness:', witnessResult.data.witnesses);
    txWitnesses.value = witnessResult.data.witnesses;
    return true;
  } catch (e) {
    console.error('Error signing withdrawal transaction:', e);
    snackbar.setError(e instanceof Error ? e.message : t('errors.unknownError'))
    return false;
  } finally {
    loading.value = false
  }
}

const signLedgerTx = async () => {
  loading.value = true;
  try {
    if (!props.tx) {
      throw new Error(t('common.noTransactionToSign'));
    }
    txCbor.value = serializeCardanoJsSdkTx(props.tx);
    const signatures: Cardano.Signatures = await ledgerUtils.txToLedger(
      props.tx,
      keys.value,
      utxos.value,
      !isBT.value, // isUsb flag (inverted from isBT)
      networks.resolveNetwork(loggedWallet.value.chain, loggedWallet.value.network),
    );
    const transactionWitnessSet: Serialization.TransactionWitnessSet = Serialization.TransactionWitnessSet.fromCore({
      signatures,
    })
    console.log('[LEDGER-SIGN] signing successful:', transactionWitnessSet.toCbor());
    txWitnesses.value = transactionWitnessSet.toCbor();
    return true;
  } catch (e) {
    ledgerUtils.ledgerErrorHandling(e)
    return false;
  } finally {
    loading.value = false;
  }
};

const submitTx = async () => {
  try {
    loading.value = true
    // Submit the transaction with the original CBOR and witness
    // Let the background script combine them properly
    const submitResult = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SUBMIT_TX,
      data: {
        txCbor: txCbor.value,
        witnessHex: txWitnesses.value,
        utxos: utxos.value
      }
    }) as { data: { txId?: string; error?: string } };

    if (submitResult.data.error) {
      throw new Error(submitResult.data.error);
    }

    snackbar.fireSuccess(t('staking.withdrawalSubmitted', { txId: submitResult.data.txId }));
    emit('close');
  } catch (e) {
    console.error('Error submitting withdrawal transaction:', e);
    snackbar.setError(e instanceof Error ? e.message : t('errors.unknownError'));
  } finally {
    loading.value = false;
  }
}

const signWithdrawalTx = async () => {
  if (isSubmit.value) {
    await submitTx();
  } else {
    if (loggedWallet.value?.type === WalletType.Normal) {
      if (form.value.validate()) {
        const isValid: boolean = await signTx();
        if (!isValid) {
          return;
        }
        if (config.value?.txAutoSubmit) {
          await submitTx();
        } else {
          isSubmit.value = true;
        }
      }
      // TODO: Keystone hardware wallet signing flow - currently disabled
      // This would generate a QR code for the Keystone device to scan and sign
      // } else if (loggedWallet.value?.type === WalletType.Keystone) {
      //   if (qrCode.value) {
      //     qrCode.value = null;
      //     if (qrCodeRef.value)
      //       qrCodeRef.value.innerHTML = '';
      //   }
      //
      //   const ur = createKeystoneSignRequest(props.tx, loggedWallet.value, utxos.value, keys.value)
      //   type.value = ur.type
      //   cbor.value = Buffer.from(ur.cbor).toString('hex')
      //   qrCode.value = new QRCodeStyling(qrCodeOptions(UREncoder.encodeSinglePart(ur), 450))
      //   overlay.value = true
      //   nextTick(() => {
      //     qrCode.value.append(qrCodeRef.value);
      //   });
    } else if (loggedWallet.value?.type === WalletType.Ledger) {
      const isValid: boolean = await signLedgerTx();
      if (!isValid) {
        return;
      }
      if (config.value?.txAutoSubmit) {
        await submitTx();
      } else {
        isSubmit.value = true;
      }
    }
  }
}

watch(() => props.isOpen, (val) => {
  if (val) {
    spendingPassword.value = '';
    isSubmit.value = false;
    if (form.value) {
      form.value.resetValidation();
    }
  }
});

watch(spendingPassword, () => {
  passwordRules.value = [rules.required()];
});

</script>
<style scoped>

</style>
