<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Delegate Your Stake" :loading="loading"
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
    <v-card-actions class="justify-center text-center pt-0 px-3" v-if="pool && accountInfo" style="display: block;">
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
          <v-col cols="12" class="pt-6" style="display: flex; justify-content: space-evenly;">
            <v-tooltip
              v-model="tooltip.enabled"
              top
              color="red"
              v-if="loggedWallet.type === WalletType.Normal"
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
            <div v-else-if="loggedWallet.type === WalletType.Ledger" class="py-0" style="align-content: center;">
              <v-card-subtitle class="pa-0 text-center justify-center pt-0" style="color: white">
                <USBBluetoothSwitch v-model="isBT" :disabled="loading" />
              </v-card-subtitle>
            </div>
            <v-btn color="primary" elevation="0" @click="signDelegationTx" height="40" :disabled="loading || !valid" :loading="loading" class="mx-2" style="margin-bottom: 1px">
              Delegate
            </v-btn>
          </v-col>
        </v-row>
      </v-form>
    </v-card-actions>
    <v-overlay
      :absolute="true"
      opacity="0.99"
      :value="overlay"
      class="hardwareOverlay"
    >
      <v-alert
        color="white"
        dense
        outlined
        type="info"
        prominent
        border="left"
        v-if="!keystoneScan"
        class="mt-10 mb-0"
      >
        <b>Instructions</b>
        <div v-if="loggedWallet?.type === WalletType.Keystone">
          <ul class="text-left" style="line-height: 1.5">
            <li>Unlock your Keystone device.</li>
            <li>Select the option to scan a QR code. <v-icon small>mdi-line-scan</v-icon></li>
            <li>Use your Keystone device to scan the QR code.</li>
            <li>Approve on the Keystone device and then click 'Next' to scan it with Gero.</li>
          </ul>
        </div>
      </v-alert>
      <v-card flat class="transparent" v-else-if="loggedWallet?.type === WalletType.Keystone && keystoneScan">
        <v-card-title>
          Scan QR Code
        </v-card-title>
        <v-card-subtitle>
          <ul class="text-left" style="line-height: 1.5">
            <li>Adjust the distance and, if needed, tap on the Keystone QR code to enhance scanning</li>
            <li>Use a low density setting for animated QR codes if required.</li>
          </ul>
        </v-card-subtitle>
        <v-card-text class="text-center">
          <div class="qr-scanner" v-show="isInit">
            <QrcodeStream @decode="onDecode" @init="onInit">
              <div id="qr-shaded-region" style="position: absolute; border-width: 74px 163px; border-style: solid; border-color: rgba(0, 0, 0, 0.48); box-sizing: border-box; inset: 0;">
                <div style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; top: -5px; left: 0;"></div>
                <div style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; top: -5px; right: 0;"></div>
                <div style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; bottom: -5px; left: 0;"></div>
                <div style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; bottom: -5px; right: 0;"></div>
                <div style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; top: -5px; left: -5px;"></div>
                <div style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; bottom: -5px; left: -5px;"></div>
                <div style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; top: -5px; right: -5px;"></div>
                <div style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; bottom: -5px; right: -5px;"></div>
              </div>
            </QrcodeStream>
          </div>
          <div style="flex-flow: column; display: flex;align-items: center;" class="pt-10" v-if="!isInit">
            <v-progress-circular size="150" indeterminate></v-progress-circular>
            <span class="pt-4">Loading ... </span>
          </div>
        </v-card-text>
      </v-card>

      <!--      <AnimatedQRCode :type="type" :cbor="cbor" />-->
      <div id="qr-code" ref="qrCode" class="text-center" v-show="!keystoneScan"> </div>
      <div class="text-center pt-2">
        <v-btn
          text
          @click="backScan"
          class="mr-2"
        >{{ keystoneScan ? 'Back' : 'Cancel' }}
        </v-btn>
        <v-btn
          v-if="!keystoneScan"
          class="geroButton"
          style="color: black!important;"
          @click="keystoneScan = true"
        >NEXT
        </v-btn>
      </div>
    </v-overlay>
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
import snackbar from '@/plugins/snackbar';
import { WalletType } from '@/models/types';
import USBBluetoothSwitch from '@/shared/components/USBBluetoothSwitch.vue';
import { createKeystoneSignRequest, parseSignature, qrCodeOptions } from '@/shared/utils/keystone';
import { UREncoder } from '@keystonehq/keystone-sdk';
import QRCodeStyling from 'qr-code-styling';
import { QrcodeStream } from "vue-qrcode-reader";
import Vue from 'vue';

export default {
  name: 'DelegateDialog',
  components: { QrcodeStream, USBBluetoothSwitch, CopyButton, BaseDialog },
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
    WalletType() {
      return WalletType
    },
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
    backScan() {
      if (this.keystoneScan) {
        this.keystoneScan = false
        this.isInit = false
      } else {
        this.overlay = false
      }
    },
    async onDecode(result) {
      console.log(result)
      const signature = parseSignature(result);
      const signedTx = Transaction.new(
        this.tx.body(),
        TransactionWitnessSet.from_bytes(Buffer.from(signature.witnessSet, "hex")),
        undefined // TODO Transaction metadata
      );
      console.log(signedTx.to_json())
      const txId = await appWallet.submitTx(signedTx.to_hex().toString());
      console.log(txId)
      snackbar.fireSuccess(`Tx Submitted Successfully. Tx ID: ${txId}`)
      this.$emit('close')
    },
    onInit(promise) {
      promise.then(() => {
        this.isInit = true
        console.log("Camera initialized successfully");
      }).catch((error) => {
        console.error("Camera initialization failed:", error);
      });
    },
    enableToolTip() {
      this.tooltip.enabled = true;
      setTimeout(() => {
        this.tooltip.enabled = false;
      }, 3000);
    },
    async signDelegationTx() {
      const signAndReturnTx = async () => {
        this.loading = true
        try {
          const txCbor = this.tx.to_hex()
          const partialSign = false
          const response = await appWallet.signTx(
            txCbor,
            partialSign,
            this.spendingPassword,
            0,
            this.utxos,
            this.addresses,
            !this.isBT
          );
          const signedTx = Transaction.new(
            this.tx.body(),
            TransactionWitnessSet.from_bytes(Buffer.from(response.witnesses, "hex")),
            undefined // TODO Transaction metadata
          );
          const txId = await appWallet.submitTx(signedTx.to_hex().toString());
          console.log(txId)
          snackbar.fireSuccess(`Delegation Tx Submitted Successfully. Tx ID: ${txId}`)
          this.$emit('close')
        } catch (e) {
          snackbar.setError(e)
          console.log(e);
        }
        this.loading = false
      };
      if (appWallet.type === WalletType.Normal) {
        if (this.$refs.form.validate()) {
          if (appWallet.verifySpendingPassword(this.spendingPassword)) {
            await signAndReturnTx();
          } else {
            this.enableToolTip();
          }
        }
      } else if (appWallet?.type === WalletType.Keystone) {
        if (this.qrCode) {
          this.qrCode = null; // Clear the QRCode instance
          if (this.$refs.qrCode)
            this.$refs.qrCode.innerHTML = '';
        }

        const ur = createKeystoneSignRequest(this.tx, this.loggedWallet, this.utxos, this.addresses)
        this.type = ur.type
        this.cbor = Buffer.from(ur.cbor).toString('hex')
        this.qrCode = new QRCodeStyling(qrCodeOptions(UREncoder.encodeSinglePart(ur), 450))
        this.overlay = true
        Vue.nextTick(() => {
          this.qrCode.append(this.$refs.qrCode);
        });
      } else {
        await signAndReturnTx();
      }
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
    ],
    isBT: false,
    overlay: false,
    type: undefined,
    cbor: undefined,
    keystoneScan: false,
    isInit: false,
  }),
}
</script>
<style scoped>

</style>
