<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" :min-height="300" title="Unstake from Pool"
              subtitle="Deregister from your current staking pool delegation and withdraw your stake.">
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
    <v-card-actions class="justify-center text-center pt-0" v-if="accountInfo && tx">
      <v-form ref="form" v-model="valid">
        <v-row no-gutters>
          <v-col :cols="cols">
            <h4>Rewards Amount
              <v-btn x-small icon>
                <v-icon small>mdi-information-outline</v-icon>
              </v-btn>
            </h4>
            <h4><strong>{{ withdrawals | toCurrency }}</strong></h4>
          </v-col>
          <v-col :cols="cols" v-if="depositFee > 0">
            <h4>Deposit Fee Return</h4>
            <h4><strong>{{ depositFee | toCurrency }}</strong></h4>
          </v-col>
          <v-col :cols="cols">
            <h4>Tx Fee</h4>
            <h4><strong>{{ Number(tx.body().fee().to_str()) | toCurrency }}</strong></h4>
          </v-col>
          <v-col :cols="cols">
            <h4>Total</h4>
            <h4><strong>{{ (withdrawals+depositFee-Number(tx.body().fee().to_str())) | toCurrency }}</strong></h4>
          </v-col>
          <v-col cols="12" class="pt-6" style="display: ruby">
            <v-tooltip
              v-model="tooltip.enabled"
              top
              color="red"
            >
              <template v-slot:activator="{ }">
                <v-text-field
                  flat
                  style="width: 295px;"
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
            <v-btn color="#F97066" elevation="0" @click="signUnStakeTx" height="40" :disabled="loading || !valid" :loading="loading" class="mx-2" style="margin-bottom: 1px">
              Unstake
            </v-btn>
          </v-col>
        </v-row>
      </v-form>
    </v-card-actions>
  </BaseDialog>
</template>
<script>
import BaseDialog from '@/shared/components/BaseDialog.vue';
import filters from '@/shared/utils/filters';
import { mapState } from 'pinia';
import { appWallet, useStore } from '@/store';
import { BigNum, Transaction, TransactionWitnessSet } from '@emurgo/cardano-serialization-lib-browser';
import rules from '@/shared/utils/rules';

export default {
  name: 'UnstakeDialog',
  components: { BaseDialog },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
    tx: {
      type: Transaction,
      default: () => {},
    }
  },
  watch: {
    isOpen(val) {
      if (val) {
        this.spendingPassword = ''
        if (this.$refs.form) {
          this.$refs.form.resetValidation()
        }
      }
    },
    spendingPassword(val) {
      this.passwordRules = [
        rules.required
      ]
    }
  },
  computed: {
    ...mapState(useStore, ['accountInfo', 'loggedWallet', 'utxos', 'addresses', 'stakeAddress']),
    withdrawals() {
      let withdrawals = 0
      if (this.tx?.body()?.withdrawals()?.keys()) {
        for (let i = 0 ; i < this.tx.body().withdrawals().keys().len() ; i++) {
          const rewardAddress = this.tx.body().withdrawals().keys().get(i);
          if (rewardAddress.to_address().to_bech32() === this.stakeAddress) {
            withdrawals += Number(this.tx.body().withdrawals().get(rewardAddress).to_str())
          }
        }
      }
      return withdrawals;
    },
    depositFee() {
      let depositFee = 0;
      const totalAdaBalance = BigNum.from_str(this.accountInfo.controlled_amount.toString())
      let totalAdaOutput = 0
      if (this.tx?.body()?.inputs()) {
        for (let i = 0; i < this.tx?.body()?.inputs().len(); i++) {
          const input = this.tx?.body()?.inputs().get(i)
          const utxo = this.utxos.find(utxo => utxo.tx_hash === input.transaction_id().to_hex() && utxo.tx_index === input.index())
          totalAdaOutput -= Number(utxo.value)
          console.log(utxo)
        }
      }
      if (this.tx?.body()?.outputs()) {
        for (let i = 0; i < this.tx?.body()?.outputs().len(); i++) {
          const output = this.tx?.body()?.outputs().get(i)
          totalAdaOutput += Number(output.amount().coin().to_str())
        }
        console.log('totalAdaBalance', totalAdaBalance.to_str())
        console.log('totalAdaOutput', totalAdaOutput)
        depositFee = totalAdaOutput + Number(this.tx.body().fee().to_str()) - this.withdrawals
        return depositFee;
      }
      return 0
    },
    cols() {
      return 3
    }
  },
  methods: {
    enableToolTip() {
      this.tooltip.enabled = true;
      setTimeout(() => {
        this.tooltip.enabled = false;
      }, 3000);
    },
    async signUnStakeTx() {
      this.loading = true
      const wallet = appWallet;
      this.passwordRules.push(() => wallet.verifySpendingPassword(this.spendingPassword))
      if (!wallet.verifySpendingPassword(this.spendingPassword)) {
        this.enableToolTip()
      }
      if (this.$refs.form.validate()) {
          const witness = await wallet.signTx(
            this.tx.to_hex(),
            false,
            this.spendingPassword,
            0,
            this.utxos,
            this.addresses,
          );
          const signedTx = Transaction.new(
            this.tx.body(),
            TransactionWitnessSet.from_bytes(Buffer.from(witness.witnesses, "hex")),
            undefined // TODO Transaction metadata
          );
          try {
            console.log(signedTx)
            const txId = await wallet.submitTx(signedTx.to_hex().toString());
            console.log(txId)
            this.$emit('close')
          } catch (e) {
            console.log(e)
          }
      }
      this.loading = false
    },
  },
  filters,
  data: () => ({
    loading: false,
    spendingPassword: '',
    showPassword: false,
    tooltip: {
      enabled: false,
      text: 'Wrong Spending Password!',
    },
    valid: false,
    passwordRules: [
      rules.required
    ]
  }),
}
</script>
<style scoped>

</style>
