<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Quick Send"
              :subtitle="`Send ${networks.resolveCurrencyTicker(loggedWallet?.chain, loggedWallet?.network)} or other assets to another wallet.`">
    <v-stepper v-model="currentStep" flat class="stepper-container" non-linear alt-labels>
      <v-stepper-header>
        <template v-for="(item, index) in steps">
          <div
            class="custom-step"
            :key="item.name"
            :class="{ active: currentStep === index + 1, done: currentStep > index + 1, next: currentStep < index + 1 }"
          >
            <div class="icon-container">
              <v-icon
                class="step-icon"
                :color="currentStep < index + 1 ? '#00dff3' : '#0f0f0f'"
                size="20"
              >{{ currentStep > index + 1 ? 'mdi-check' : 'mdi-circle-medium' }}
              </v-icon
              >
            </div>
            <span class="step-label">{{ item.label }}</span>
          </div>
          <div class="divider" :class="{ 'active-divider': currentStep > index + 1 }" :key="index"
               v-if="index < steps.length - 1"></div>
        </template>
      </v-stepper-header>
    </v-stepper>
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1">
      <CustomStepper :currentStep="currentStep" :steps="steps">
        <v-stepper-content step="1">
          <SendRecipientDetailsStep
            :sendData="sendData"
            @updateRecipientAddress="updateRecipientAddress"
          ></SendRecipientDetailsStep>
        </v-stepper-content>
        <v-stepper-content step="2">
          <AssetsToSendStep
            v-model="sendData"
            @select="selectCollectible"
            :tokens="tokens"
          ></AssetsToSendStep>
        </v-stepper-content>
        <v-stepper-content step="3">
          <SummaryStep ref="summary" :sendData="sendData" :tx-data="txData" @next="signAndSubmitTx"
                       @prev="prevStep"></SummaryStep>
        </v-stepper-content>
      </CustomStepper>
    </v-card-text>
    <v-card-actions class="text-center justify-center" style="flex-flow: column;">
      <div class="" v-if="currentStep === 3">
        <v-tooltip
          v-model="tooltip.enabled"
          top
          color="red"
        >
          <template v-slot:activator="{ }">
            <v-text-field
              flat
              style="width: 295px"
              block
              dense
              v-model="spendingPassword"
              outlined
              label="Spending Password"
              :type="show1 ? 'text' : 'password'"
              :rules="[rules.required]"
              hide-details
              class="mb-2"
              required
              :disabled="txSubmitLoading"
              @keydown.enter.prevent="nextStep"
            >
              <template v-slot:append>
                <v-icon @click="show1 = !show1" tabindex="-1">
                  {{ show1 ? 'mdi-eye' : 'mdi-eye-off' }}
                </v-icon>
              </template>
            </v-text-field>
          </template>
          <span>{{ tooltip.text }}</span>
        </v-tooltip>
      </div>
      <div>
        <v-btn
          text
          @click="prevStep"
          v-if="this.currentStep > 1"
          class="mr-2"
          :disabled="txSubmitLoading"
        >
          <v-icon small class="mr-1">mdi-arrow-left</v-icon>Back
        </v-btn>
        <v-btn
          class="continue-button"
          @click="nextStep"
          :disabled="!isValid || txSubmitLoading"
          :loading="txSubmitLoading"
        >{{ this.currentStep === 3 ? 'Sign and Confirm ' : 'Continue ' }}
          <v-icon style="color: black!important;" small v-if="currentStep !==3" class="ml-1">mdi-arrow-right</v-icon>
        </v-btn>
      </div>
    </v-card-actions>
  </BaseDialog>
</template>
<script>
import BaseDialog from '@/shared/components/BaseDialog.vue';
import CustomStepper from '@/shared/components/CustomStepper.vue';
import SendRecipientDetailsStep from '../components/SendRecipientDetailsStep.vue';
import AssetsToSendStep from '../components/AssetsToSendStep.vue';
import SummaryStep from '../components/SummaryStep.vue';
import { appWallet, useStore } from '@/store';
import { mapState } from 'pinia';
import { assetsToValue, toUTxO } from '@/shared/utils/converter';
import { buildTx } from '@/shared/utils/builder';
import rules from '@/shared/utils/rules';
import { Network } from '@/models/types';
import { TransactionOutputs } from '@emurgo/cardano-serialization-lib-browser/cardano_serialization_lib';
import {
  Address, Transaction,
  TransactionOutput,
  TransactionUnspentOutputs, TransactionWitnessSet,
} from '@emurgo/cardano-serialization-lib-browser';
import networks, { cardanoLogo } from '@/shared/utils/networks';
import filters from '@/shared/utils/filters';

export default {
  name: 'SendDialog',
  components: { BaseDialog, CustomStepper, SendRecipientDetailsStep, AssetsToSendStep, SummaryStep },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
  },
  computed: {
    networks() {
      return networks
    },
    ...mapState(useStore, ['loggedWallet', 'resolvedAssets', 'baseAddress', 'latestTip', 'utxos', 'addresses', 'pinnedTokens']),
    tokens() {
      if (this.resolvedAssets) {
        const tokens = this.resolvedAssets.map(token => {
          return {
            ...token,
            name: token.metadata.name,
            ticker: token.metadata.ticker,
            img: token.img,
            quantity: "0",
            balance: token.quantity,
            decimals: token.metadata.decimals,
            unit: token.unit
          }
        })
        tokens.sort((a,b) => {
          if (a.ticker === networks.resolveCurrencyTicker(this.loggedWallet?.chain, this.loggedWallet?.network)) {
            return -1
          }
          return (this.pinnedTokens.includes(a.unit) ? -1 : 1) || a.ticker.localeCompare(b.ticker)
        })
        return tokens
      }
      return []
    },
    isValid() {
      if (this.currentStep === 1) {
        const prefix = this.loggedWallet?.network !== Network.MAINNET ? 'addr_test1' : 'addr1';
        return this.sendData.recipientAddress.startsWith(prefix);
      }
      if (this.currentStep === 2) {
        if (!this.txValid) {
          return false;
        }
        const hasZeroQuantity = (items) => items?.some(item => Number(item.quantity) === 0);
        return !(hasZeroQuantity(this.sendData.selectedTokens) || hasZeroQuantity(this.sendData.selectedCollectibles));
      }
      if (this.currentStep === 3) {
        return Boolean(this.spendingPassword);
      }
      return false;
    },
  },
  watch: {
    isOpen(val) {
      if (val) {
        this.resetData();
      }
    },
    sendData: {
      handler(val, oldVal) {
        try {
          this.buildTx()
          this.txValid = true
        } catch(e) {
          if (e.includes('less than the minimum UTXO value')) {
            const match = e.match(/minimum UTXO value (\d+)/);
            const number = match ? parseInt(match[1], 10) : null;
            this.sendData.minAda = Number(filters.toCurrency(number, false, 6, '', '', false, 6).replaceAll(",", ""))
          }
          this.txValid = false
        }
      },
      deep: true,
    }
  },
  data: () => ({
    steps: [
      {
        name: 'recipientDetails',
        label: 'Recipient Details',
      },
      {
        name: 'assetsToSend',
        label: 'Assets to Send',
      },
      {
        name: 'summary',
        label: 'Summary',
      },
    ],
    currentStep: 1,
    tooltip: {
      enabled: false,
      text: 'Wrong Spending Password!',
    },
    txBody: undefined,
    txData: undefined,
    txSubmitLoading: false,
    spendingPassword: '',
    show1: false,
    rules,
    sendData: {
      selectedTokens: [],
      selectedCollectibles: [],
      recipientAddress: '',
      selectedWallet: {},
      minAda: 0,
    },
    txValid: false,
  }),
  methods: {
    enableToolTip() {
      this.tooltip.enabled = true;
      setTimeout(() => {
        this.tooltip.enabled = false;
      }, 3000);
    },
    async signAndSubmitTx() {
      if (appWallet.verifySpendingPassword(this.spendingPassword)) {
        const witness = await appWallet.signTx(
          this.txData.to_hex(),
          false,
          this.spendingPassword,
          0,
          this.utxos,
          this.addresses,
        );
        const signedTx = Transaction.new(
          this.txBody,
          TransactionWitnessSet.from_bytes(Buffer.from(witness.witnesses, "hex")),
          undefined // TODO Transaction metadata
        );
        try {
          this.txSubmitLoading = true
          const response = await appWallet.submitTx(signedTx.to_hex().toString());
          console.log(response)
          this.txSubmitLoading = false
          this.$emit('close')
        } catch (e) {
          console.log(e)
          this.txSubmitLoading = false
        }
      } else {
        this.enableToolTip()
      }
    },
    buildTx() {
      const recipientAddress = this.sendData.recipientAddress;
      const tokens = [];
      if (this.sendData.selectedTokens.length > 0) {
        this.sendData.selectedTokens.forEach(token => {
          if (token.ticker === 'ADA') {
            tokens.push({
              unit: 'lovelace',
              quantity: (Number(token.quantity) * Math.pow(10, token.decimals)).toString(),
            });
          } else {
            tokens.push({
              unit: token.unit,
              quantity: (Number(token.quantity) * Math.pow(10, token.decimals)).toString(),
            });
          }
        });
      }
      if (this.sendData.selectedCollectibles.length > 0) {
        this.sendData.selectedCollectibles.forEach(collectible => {
          tokens.push({
            unit: collectible.unit,
            quantity: collectible.toSendQuantity.toString(),
          });
        });
      }
      const outputs = TransactionOutputs.new();
      outputs.add(TransactionOutput.new(Address.from_bech32(recipientAddress), assetsToValue(tokens)));
      const transactionUnspentOutputs = TransactionUnspentOutputs.new();
      this.utxos.forEach((utxo) => transactionUnspentOutputs.add(toUTxO(utxo)));
      try {
        this.txBody = buildTx(this.sendData.selectedWallet, outputs, transactionUnspentOutputs, this.latestTip.slot, this.baseAddress, [], []);
        this.sendData.minAda = 0
        this.txValid = true
        console.log(this.txBody.to_json())
        this.txData = Transaction.new(this.txBody, TransactionWitnessSet.new())

        // if (this.currentStep < this.steps.length) {
        //   this.currentStep++;
        // }
      } catch (e) {
        console.log(e)
        throw e
      }
    },
    nextStep() {
      if (this.currentStep <= this.steps.length) {
        if (this.currentStep === 1) {
          this.currentStep++;
        } else if (this.currentStep === 2) {
          this.$refs.summary.scanTx(this.txData);
          this.currentStep++;
        } else if (this.currentStep === 3 && this.spendingPassword?.length > 0) {
          this.signAndSubmitTx();
        }
      }
    },
    prevStep() {
      if (this.currentStep > 1) {
        this.currentStep--;
      }
    },
    updateRecipientAddress(address) {
      this.sendData.recipientAddress = address;
    },
    selectCollectible(collectible) {
      if (this.sendData.selectedCollectibles[collectible.name]) {
        this.$delete(this.sendData.selectedCollectibles, collectible.name);
      } else {
        this.$set(this.sendData.selectedCollectibles, collectible.name, collectible);
      }
    },
    resetData() {
      this.spendingPassword = ''
      this.currentStep = 1;
      this.txSubmitLoading = false
      this.txBody = undefined
      this.txData = undefined
      const currencyTicker = networks.resolveCurrencyTicker(appWallet.chain, appWallet.network)
      const foundAsset = this.tokens.find(token => token.ticker === currencyTicker)
      if (foundAsset) {
        foundAsset.verified = true
      }
      this.sendData = {
        selectedTokens: [foundAsset],
        selectedCollectibles: [],
        recipientAddress: '',
        selectedWallet: this.loggedWallet,
      };
      console.log(this.sendData)
    },
  },
  mounted() {
    if (this.resolvedAssets) {
      const nativeTicker = networks.resolveCurrencyTicker(this.loggedWallet.chain, this.loggedWallet.network)
      const adaAssetFound = this.resolvedAssets.find(asset => asset.metadata.ticker === nativeTicker);
      if (adaAssetFound) {
        this.sendData.selectedTokens = [adaAssetFound];
      }
    }
  },
};
</script>

<style scoped>
.titles {
  align-items: center;
  text-align: center;
  display: flex;
  flex-direction: column;
}

.arrow-left {
  cursor: pointer;
  position: absolute;
  top: 10px;
  left: 10px;
}

.continue-button {
  background: linear-gradient(to right, #00c7f3, #00fad5);
  color: black;

  &:disabled {
    opacity: 0.5;
    color: black !important;
  }

}

.stepper-container {
  background-color: transparent;

  & .v-stepper__header {
    box-shadow: none;
  }

  .custom-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    padding: 5px;
    width: 150px;

    &.active .icon-container {
      box-shadow: 0 0 0 5px #00dff327;
    }

    &.next .icon-container {
      background-color: #292929;
    }

    .icon-container {
      background-color: #00dff3;
      border-radius: 50%;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 24px;
      width: 24px;
      padding-left: 1px;
    }
  }

  .step-label {
    margin-top: 10px;
    font-size: 14px;
    line-height: 20px;
    text-align: center;
    font-weight: 600;
    color: #CECFD2;
  }

  .divider {
    flex: 1;
    height: 2px;
    width: 100%;
    margin-left: -75px;
    margin-right: -75px;
    margin-top: 16px;
    background-color: #292929;

    &.active-divider {
      background-color: #00dff3;
    }
  }
}
</style>
