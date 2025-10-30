<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    :min-height="300"
    :title="$t('staking.unstakeFromPool')"
    :subtitle="$t('staking.unstakeSubtitle')"
    :loading="loading"
    :persistent="false"
  >
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1">
      <v-alert
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
      <v-form ref="form" v-model="valid">
        <v-row no-gutters>
          <v-col :cols="cols">
            <h4>{{ $t('staking.rewardsAmount') }}
              <v-btn x-small icon>
                <v-icon small>mdi-information-outline</v-icon>
              </v-btn>
            </h4>
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
            <v-tooltip
              v-model="tooltip.enabled"
              top
              color="red"
              v-if="loggedWallet?.type === WalletType.Normal && !isSubmit"
            >
              <template v-slot:activator="{ }">
                <v-text-field
                  flat
                  style="width: 295px; max-width: 295px"
                  block
                  dense
                  v-model="spendingPassword"
                  outlined
                  :label="$t('wallet.spendingPassword')"
                  :type="showPassword ? 'text' : 'password'"
                  :rules="passwordRules"
                  hide-details
                  required
                  :disabled="loading"
                  @keydown.enter.prevent="signUnStakeTx"
                >
                  <template v-slot:append>
                    <v-icon @click="showPassword = !showPassword" tabindex="-1">
                      {{ showPassword ? 'mdi-eye' : 'mdi-eye-off' }}
                    </v-icon>
                  </template>
                </v-text-field>
              </template>
              <span>{{ tooltip.text }}</span>
            </v-tooltip>
            <div v-else-if="loggedWallet?.type === WalletType.Ledger && !isSubmit" class="py-0" style="align-content: center;">
              <v-card-subtitle class="pa-0 text-center justify-center pt-0" style="color: white">
                <ToggleSwitch :text-left="$t('staking.usb')" icon-left="mdi-usb" :text-right="$t('staking.bluetooth')" icon-right="mdi-bluetooth" v-model="isBT" :disabled="loading" />
              </v-card-subtitle>
            </div>
            <v-btn color="#F97066" elevation="0" @click="signUnStakeTx" height="40" :disabled="loading || (!valid && !isSubmit)" :loading="loading" class="mx-2" style="margin-bottom: 1px">
              {{ isSubmit ? $t('staking.submitTransaction') : $t('staking.signAndUnstake') }}
            </v-btn>
          </v-col>
        </v-row>
      </v-form>
    </v-card-actions>
  </BaseDialog>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, ref, toRefs, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import filters from '@/shared/utils/filters';
import { serializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { Cardano, Serialization } from '@cardano-sdk/core';
import rules from '@/utils/rules';
import { WalletType } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import ledgerUtils from '@/shared/utils/ledger';
import networks from '@/utils/networks';


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
const { epochParams } = toRefs(networkStore);

const loading = ref(false);
const spendingPassword = ref('');
const showPassword = ref(false);
const tooltip = ref({
  enabled: false,
  text: t('wallet.wrongSpendingPassword'),
});
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

const enableToolTip = () => {
  tooltip.value.enabled = true;
  setTimeout(() => {
    tooltip.value.enabled = false;
  }, 3000);
};

const signTx = async (): Promise<boolean> => {
  loading.value = true;
  try {
    console.log('Signing Cardano JS SDK unstake transaction');
    console.log('Transaction:', props.tx);

    // First, verify password via a background message
    const passwordVerification = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.VERIFY_SPENDING_PASSWORD,
      data: { password: spendingPassword.value }
    }) as { data: { isValid: boolean; error?: string } };

    if (!passwordVerification.data.isValid) {
      enableToolTip();
      loading.value = false;
      return false;
    }

    // Serialize the Cardano.Tx to CBOR for Chrome messaging
    txCbor.value = serializeCardanoJsSdkTx(props.tx);
    console.log('Serialized transaction CBOR:', txCbor.value);

      // Sign the transaction via background message
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
    console.error('Error signing unstake transaction:', e);
    snackbar.setError(e instanceof Error ? e.message : t('errors.unknownError'));
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
    console.log('[LEDGER-SIGN] Legacy signing successful:', transactionWitnessSet.toCbor());
    txWitnesses.value = transactionWitnessSet.toCbor();
    return true;
  } catch (e) {
    console.error('Error signing with Ledger:', e);
    snackbar.setError(e instanceof Error ? e.message : 'Ledger signing failed');
    return false;
  } finally {
    loading.value = false;
  }
};

const submitTx = async () => {
  try {
    loading.value = true
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
    snackbar.fireSuccess(t('staking.unstakeTxSubmitted', { txId: submitResult.data.txId }));
    emit('close');
  } catch (e) {
    console.error('Error submitting unstake transaction:', e);
    snackbar.setError(e instanceof Error ? e.message : t('errors.unknownError'))
  } finally {
    loading.value = false
    isSubmit.value = false
  }
}

const signUnStakeTx = async () => {
  if (isSubmit.value) {
    await submitTx();
  } else {
    if (loggedWallet.value?.type === WalletType.Normal) {
      if (form.value?.validate()) {
        if (!isSubmit.value) {
          const success = await signTx();
          if (!success) {
            return;
          }
          if (config.value?.txAutoSubmit) {
            await submitTx();
          } else {
            isSubmit.value = true;
          }
        } else {
          await submitTx();
        }
      }
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
};

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
