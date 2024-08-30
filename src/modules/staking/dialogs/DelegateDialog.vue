<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Delegate Your Stake"
              :subtitle="`Secure the network and earn rewards by delegating your ${networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)} to a stake pool.`">
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1" v-if="pool">
      <v-alert
        border="left"
        color="primary"
        type="info"
        prominent
        class="text-left"
      >
        <ul>
          <li>You can only delegate to one stake pool at a time</li>
          <li>You can switch to delegate to a different stake pool at any time</li>
          <li>You can cancel your delegation at any time</li>
        </ul>
      </v-alert>
      <v-list-item three-line>
        <v-list-item-content class="text-left">
          <v-list-item-title class="text-h5 mb-1">
            {{ `[${pool.ticker}] ${pool.name}` }}
          </v-list-item-title>
          <v-list-item-subtitle>{{ pool.description }}</v-list-item-subtitle>
          <v-list-item-subtitle v-if="pool">{{ pool.pool_id_bech32 | truncate }}&nbsp;<CopyButton :value="pool.pool_id_bech32" x-small></CopyButton></v-list-item-subtitle>
        </v-list-item-content>

        <v-list-item-avatar
          size="80"
          v-if="poolExtendedInfo(pool)?.info?.url_png_icon_64x64"
        >
          <img :src="poolExtendedInfo(pool).info.url_png_icon_64x64" alt="" @error="fallbackImage"/>
        </v-list-item-avatar>
      </v-list-item>
      <v-card-title class="pt-0" style="color: white">{{ pool.block_count.toLocaleString() }}</v-card-title>
      <v-card-subtitle class="text-left pb-2">Lifetime Blocks</v-card-subtitle>
      <v-card-title class="pt-0" style="color: white">{{ pool.live_delegators }}</v-card-title>
      <v-card-subtitle class="text-left pb-2">Live Delegators</v-card-subtitle>
      <v-card-title class="pt-0" style="color: white">{{ pool.live_stake | toCurrency(false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network))}}</v-card-title>
      <v-card-subtitle class="text-left pb-2">Live Stake</v-card-subtitle>
      <v-card-title class="pt-0" style="color: white">{{ pool.ros.toLocaleString(undefined, {maximumFractionDigits: 2}) }}%</v-card-title>
      <v-card-subtitle class="text-left pb-2">ROS</v-card-subtitle>
      <v-card-title class="pt-0" style="color: white">
        <v-progress-linear rounded :color="getColor(pool.live_saturation)" height="32" :value="pool.live_saturation" striped>
          <template v-slot:default="{ value }">
            <strong>{{ Math.ceil(value) }}%</strong>
          </template>
        </v-progress-linear>
      </v-card-title>
      <v-card-subtitle class="text-left pb-0">Live Saturation</v-card-subtitle>
    </v-card-text>
    <v-card-actions class="justify-center text-center pt-0" v-if="pool && accountInfo">
      <v-form ref="form" v-model="valid">
        <v-row no-gutters>
          <v-col :cols="cols">
            <h4>Delegation Amt.
              <v-btn x-small icon>
                <v-icon small>mdi-information-outline</v-icon>
              </v-btn>
            </h4>
            <h4><strong>{{ accountInfo.controlled_amount | toCurrency(false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network))}}</strong></h4>
          </v-col>
          <v-col :cols="cols">
            <h4>Epoch Yield
              <v-btn x-small icon>
                <v-icon small>mdi-information-outline</v-icon>
              </v-btn>
            </h4>
            <h4>~<strong>{{ accountInfo?.controlled_amount * pool.ros/100/73 | toCurrency(false, 2, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</strong></h4>
          </v-col>
          <v-col :cols="cols" v-if="depositFee > 0">
            <h4>Deposit Fee</h4>
            <h4><strong>{{ depositFee | toCurrency(false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</strong></h4>
          </v-col>
          <v-col :cols="cols">
            <h4>Tx Fee</h4>
            <h4><strong>{{ tx.body().fee().to_str() | toCurrency(false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</strong></h4>
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
            <v-btn color="primary" elevation="0" @click="signDelegationTx" height="40" :disabled="loading || !valid" :loading="loading" class="mx-2" style="margin-bottom: 1px">
              Delegate
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
import CopyButton from '@/shared/components/CopyButton.vue';
import { mapState } from 'pinia';
import { appWallet, useStore } from '@/store';
import { BigNum, Transaction, TransactionWitnessSet } from '@emurgo/cardano-serialization-lib-browser';
import rules from '@/shared/utils/rules';
import networks from "@/shared/utils/networks";

export default {
  name: 'DelegateDialog',
  components: { CopyButton, BaseDialog },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
    pool: {
      type: Object,
      default: () => {},
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
    spendingPassword() {
      this.passwordRules = [
        rules.required
      ]
    }
  },
  computed: {
    ...mapState(useStore, ['accountInfo', 'loggedWallet', 'utxos', 'addresses']),
    depositFee() {
      let depositFee = 0;
      const totalAdaBalance = BigNum.from_str(this.accountInfo.controlled_amount.toString())
      let totalAdaOutput = 0
      if (this.tx?.body()?.inputs()) {
        for (let i = 0; i < this.tx?.body()?.inputs().len(); i++) {
          const input = this.tx?.body()?.inputs().get(i)
          const utxo = this.utxos.find(utxo => utxo.tx_hash === input.transaction_id().to_hex() && utxo.tx_index === input.index())
          if (utxo) {
            totalAdaOutput -= Number(utxo.value)
          }
        }
      }
      if (this.tx?.body()?.outputs()) {
        for (let i = 0; i < this.tx?.body()?.outputs().len(); i++) {
          const output = this.tx?.body()?.outputs().get(i)
          totalAdaOutput += Number(output.amount().coin().to_str())
        }
        console.log('totalAdaBalance', totalAdaBalance.to_str())
        console.log('totalAdaOutput', totalAdaOutput)
        depositFee = totalAdaOutput + Number(this.tx.body().fee().to_str())
        return depositFee*-1;
      }
      return 0
    },
    cols() {
      if (this.depositFee > 0) {
        return 3
      } else {
        return 4
      }
    }
  },
  methods: {
    enableToolTip() {
      this.tooltip.enabled = true;
      setTimeout(() => {
        this.tooltip.enabled = false;
      }, 3000);
    },
    async signDelegationTx() {
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
    getColor(value) {
      if (value > 100) {
        value = 100
      }
      value = value / 100
      //value from 0 to 1
      const hue = ((1 - value) * 120).toString(10);
      return ["hsl(", hue, ",57.26%,54.12%)"].join("");
    },
    poolExtendedInfo(pool) {
      if (pool && pool.pool_extended_info) {
        return JSON.parse(pool.pool_extended_info);
      }
      return undefined
    },
    fallbackImage(e) {
      e.target.src = this.errorImage
    }
  },
  filters,
  data: () => ({
    networks,
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
