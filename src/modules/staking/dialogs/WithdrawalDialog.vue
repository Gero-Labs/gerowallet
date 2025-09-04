<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" :min-height="300" title="Withdraw Staking Rewards" :loading="loading"
              subtitle="Claim your accumulated rewards from staking. Confirm the details and enter your password to proceed.">
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1">
      <v-alert
        border="left"
        color="primary"
        type="info"
        prominent
        class="text-left"
      >
        <ul>
          <li>Staking rewards are earned by delegating your ADA to a stake pool.</li>
          <li>Staking allows ADA holders to earn passive income.</li>
          <li>Rewards are typically distributed every epoch (about every 5 days).</li>
          <li>Rewards are automatically re-staked, so you don’t need to withdraw them for your earnings to compound.</li>
        </ul>
      </v-alert>
    </v-card-text>
    <v-card-actions class="justify-center text-center pt-0" v-if="account && tx">
      <v-form ref="form" v-model="valid">
        <v-row no-gutters>
          <v-col :cols="cols">
            <h4>Rewards Amount
              <v-btn x-small icon>
                <v-icon small>mdi-information-outline</v-icon>
              </v-btn>
            </h4>
            <h4><strong>{{ toCurrency(withdrawals) }}</strong></h4>
          </v-col>
          <v-col :cols="cols">
            <h4>Tx Fee</h4>
            <h4><strong>{{ toCurrency(tx?.body?.fee?.toString() || '0') }}</strong></h4>
          </v-col>
          <v-col :cols="cols">
            <h4>Total</h4>
            <h4><strong>{{ toCurrency(withdrawals-Number(tx?.body?.fee?.toString() || '0')) }}</strong></h4>
          </v-col>
          <v-col cols="12" class="pt-6" style="display: flex; justify-content: space-evenly;">
            <v-tooltip
              v-model="tooltip.enabled"
              top
              color="red"
              v-if="loggedWallet?.type === WalletType.Normal"
            >
              <template v-slot:activator="{ }">
                <v-text-field
                  flat
                  style="width: 295px; max-width: 295px"
                  block
                  dense
                  v-model="spendingPassword"
                  outlined
                  label="Spending Password"
                  :type="showPassword ? 'text' : 'password'"
                  :rules="passwordRules"
                  hide-details
                  required
                  :disabled="loading"
                  @keydown.enter.prevent="signWithdrawalTx"
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
            <div v-else-if="loggedWallet?.type === WalletType.Ledger" class="py-0" style="align-content: center;">
              <v-card-subtitle class="pa-0 text-center justify-center pt-0" style="color: white">
                <ToggleSwitch text-left="USB" icon-left="mdi-usb" text-right="Bluetooth" icon-right="mdi-bluetooth" v-model="isBT" :disabled="loading" />
              </v-card-subtitle>
            </div>
            <v-btn color="primary" elevation="0" @click="signWithdrawalTx" height="40" :disabled="loading || !valid" :loading="loading" class="mx-2" style="margin-bottom: 1px">
              Withdraw
            </v-btn>
          </v-col>
        </v-row>
      </v-form>
    </v-card-actions>
  </BaseDialog>
</template>
<script setup lang="ts">
import { ref, computed, watch, toRefs } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import filters from '@/shared/utils/filters';
import { serializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { Cardano } from '@cardano-sdk/core';
import rules from '@/utils/rules';
import snackbar from '@/plugins/snackbar';
import { WalletType } from '@/models/types';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { walletStore } from '@/stores/walletStore';

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

const { loggedWallet, utxos, keys, account } = toRefs(walletStore);

const loading = ref(false);
const spendingPassword = ref('');
const showPassword = ref(false);
const tooltip = ref({
  enabled: false,
  text: 'Wrong Spending Password!',
});
const valid = ref(false);
const passwordRules = ref([rules.required()]);
const isBT = ref(false);
const form = ref<any>(null);

const withdrawals = computed(() => {
  let withdrawalsAmount = 0;
  if (props.tx?.body?.withdrawals) {
    props.tx.body.withdrawals.forEach((withdrawal) => {
      if (withdrawal.stakeAddress === loggedWallet.value?.stakeAddress) {
        withdrawalsAmount += Number(withdrawal.quantity);
      }
    })
  }
  return withdrawalsAmount;
});

const cols = computed(() => {
  return 4;
});

const enableToolTip = () => {
  tooltip.value.enabled = true;
  setTimeout(() => {
    tooltip.value.enabled = false;
  }, 3000);
};

const signWithdrawalTx = async () => {
  const signAndReturnTx = async () => {
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
        enableToolTip();
        loading.value = false;
        return;
      }

      // Serialize the Cardano.Tx to CBOR for Chrome messaging
      const txCbor = serializeCardanoJsSdkTx(props.tx);
      console.log('Serialized transaction CBOR:', txCbor);

      // Sign the transaction via background message
      const witnessResult = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SIGN_TX,
        data: {
          txCbor: txCbor, // Pass serialized CBOR instead of the object
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

      // Submit the transaction with original CBOR and witness
      // Let the background script combine them properly
      const submitResult = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SUBMIT_TX,
        data: {
          txCbor: txCbor,
          witnessHex: witnessResult.data.witnesses,
          utxos: utxos.value
        }
      }) as { data: { txId?: string; error?: string } };

      if (submitResult.data.error) {
        throw new Error(submitResult.data.error);
      }

      snackbar.fireSuccess(`Withdrawal Submitted Successfully. Tx ID: ${submitResult.data.txId}`);
      emit('close');
    } catch (e) {
      console.error('Error signing withdrawal transaction:', e);
      snackbar.setError(e instanceof Error ? e.message : 'Unknown error');
    }
    loading.value = false;
  };
  if (loggedWallet.value?.type === WalletType.Normal) {
    if (form.value.validate()) {
      await signAndReturnTx();
    }
  } else {
    await signAndReturnTx();
  }
}

watch(() => props.isOpen, (val) => {
  if (val) {
    spendingPassword.value = '';
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
