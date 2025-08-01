<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" :min-height="300" title="Unstake from Pool"
              subtitle="Deregister from your current staking pool delegation and withdraw your stake." :loading="loading">
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1">
      <v-alert
        border="left"
        color="warning"
        type="warning"
        prominent
        class="text-left"
      >
        Unstaking will also claim your rewards.<br>Please verify your unstake details and enter your spending password to proceed.
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
          <v-col :cols="cols" v-if="depositFee > 0">
            <h4>Deposit Fee Return</h4>
            <h4><strong>{{ toCurrency(depositFee) }}</strong></h4>
          </v-col>
          <v-col :cols="cols">
            <h4>Tx Fee</h4>
            <h4><strong>{{ toCurrency(Number(tx.body().fee().to_str())) }}</strong></h4>
          </v-col>
          <v-col :cols="cols">
            <h4>Total</h4>
            <h4><strong>{{ toCurrency(withdrawals+depositFee-Number(tx.body().fee().to_str())) }}</strong></h4>
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
            <v-btn color="#F97066" elevation="0" @click="signUnStakeTx" height="40" :disabled="loading || !valid" :loading="loading" class="mx-2" style="margin-bottom: 1px">
              Unstake
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
import { BigNum, Transaction, TransactionWitnessSet } from '@emurgo/cardano-serialization-lib-browser';
import rules from '@/utils/rules';
import { WalletType } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { walletStore } from '@/stores/walletStore';

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  tx: {
    type: Transaction,
    default: () => {},
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
  if (props.tx?.body()?.withdrawals()?.keys()) {
    for (let i = 0; i < props.tx.body().withdrawals().keys().len(); i++) {
      const rewardAddress = props.tx.body().withdrawals().keys().get(i);
      if (rewardAddress.to_address().to_bech32() === loggedWallet.value?.stakeAddress.value) {
        withdrawalsAmount += Number(props.tx.body().withdrawals().get(rewardAddress).to_str());
      }
    }
  }
  return withdrawalsAmount;
});

const depositFee = computed(() => {
  let depositFeeAmount = 0;
  const totalAdaBalance = BigNum.from_str(account.value.controlled_amount.toString());
  let totalAdaOutput = 0;
  if (props.tx?.body()?.inputs()) {
    for (let i = 0; i < props.tx?.body()?.inputs().len(); i++) {
      const input = props.tx?.body()?.inputs().get(i);
      const utxo = utxos.value?.find(utxo => utxo.tx_hash === input.transaction_id().to_hex() && utxo.tx_index === input.index());
      if (utxo) {
        totalAdaOutput -= Number(utxo.value);
      }
    }
  }
  if (props.tx?.body()?.outputs()) {
    for (let i = 0; i < props.tx?.body()?.outputs().len(); i++) {
      const output = props.tx?.body()?.outputs().get(i);
      totalAdaOutput += Number(output.amount().coin().to_str());
    }
    depositFeeAmount = totalAdaOutput + Number(props.tx.body().fee().to_str()) - withdrawals.value;
    return depositFeeAmount;
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

const signUnStakeTx = async () => {
  const signAndReturnTx = async () => {
    loading.value = true;
    try {
      const txCbor = props.tx.to_hex();
      const partialSign = false;
      const response = await loggedWallet.value.signTx(
        txCbor,
        partialSign,
        spendingPassword.value,
        0,
        utxos.value,
        addresses.value,
        !isBT.value
      );
      const signedTx = Transaction.new(
        props.tx.body(),
        TransactionWitnessSet.from_bytes(Buffer.from(response.witnesses, "hex")),
        undefined // TODO Transaction metadata
      );
      const txId = await loggedWallet.value.submitTx(signedTx, utxos.value);
      console.log(txId);
      snackbar.fireSuccess(`Unstake Tx Submitted Successfully. Tx ID: ${txId}`);
      emit('close');
    } catch (e) {
      snackbar.setError(e);
      console.log(e);
    }
    loading.value = false;
  };
  if (loggedWallet.value?.type === WalletType.Normal) {
    if (form.value.validate()) {
      if (loggedWallet.value.verifySpendingPassword(spendingPassword.value)) {
        await signAndReturnTx();
      } else {
        enableToolTip();
      }
    }
  } else {
    await signAndReturnTx();
  }
};

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
