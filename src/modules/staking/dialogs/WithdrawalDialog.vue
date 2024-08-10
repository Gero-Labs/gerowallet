<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" :min-height="300" title="Withdraw Staking Rewards"
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
          <v-col :cols="cols">
            <h4>Tx Fee</h4>
            <h4><strong>{{ Number(tx.body().fee().to_str()) | toCurrency }}</strong></h4>
          </v-col>
          <v-col :cols="cols">
            <h4>Total</h4>
            <h4><strong>{{ (withdrawals-Number(tx.body().fee().to_str())) | toCurrency }}</strong></h4>
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
            <v-btn color="primary" elevation="0" @click="signWithdrawalTx" height="40" :disabled="loading || !valid" :loading="loading" class="mx-2" style="margin-bottom: 1px">
              Withdraw
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
  name: 'WithdrawalDialog',
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
    cols() {
      return 4
    }
  },
  methods: {
    enableToolTip() {
      this.tooltip.enabled = true;
      setTimeout(() => {
        this.tooltip.enabled = false;
      }, 3000);
    },
    async signWithdrawalTx() {
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
