<template>
    <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="New Multisig Transaction" :loading="txSubmitLoading" :min-height="0"
                :subtitle="'A multisig wallet requires multiple parties signatures to authorize any transaction.'">
      <v-card-title style="display: block;" class="py-0">
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
      </v-card-title>
      <v-card-text class="px-3 pb-0 justify-center text-center" style="z-index: 1; min-height: 0; height: 490px; align-content: center;" :style="currentStep === 3 && loggedWallet?.type === WalletType.Normal ? { height: '442px'} : {}">
        <CustomStepper :currentStep="currentStep" :steps="steps">
          <v-stepper-content step="1">
            <SendRecipientDetailsStepMultisig
              :sendData="sendData"
              :recipientAddress="recipientAddressProp"
              @moveNext="nextStep"
              @updateRecipientAddress="updateRecipientAddress"
            ></SendRecipientDetailsStepMultisig>
          </v-stepper-content>
          <v-stepper-content step="2">
            <AssetsToSendStep
              v-model="sendData"
              @select="selectCollectible"
              :tokens="tokens"
              @setMax="setMax"
            ></AssetsToSendStep>
          </v-stepper-content>
          <v-stepper-content step="3">
            <SummaryStep ref="summary" :sendData="sendData" :tx-data="txData" @next="signAndSubmitTx"
                         @prev="prevStep"></SummaryStep>
          </v-stepper-content>
        </CustomStepper>
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
      </v-card-text>
      <v-card-actions class="text-center justify-center" :style="loggedWallet?.type === WalletType.Ledger ? { display: 'block', height: '96px', alignContent: 'end'} : { flexFlow: 'column'}">
        <div class="" v-if="currentStep === 3">
          <v-tooltip
            v-model="tooltip.enabled"
            top
            color="red"
            v-if="loggedWallet?.type === WalletType.Normal"
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
          <div v-else-if="loggedWallet?.type === WalletType.Ledger" class="pb-4" style="align-content: center;">
            <v-card-subtitle class="pa-0 text-center justify-center pt-0" style="color: white">
              <USBBluetoothSwitch v-model="isBT" :disabled="txSubmitLoading" />
            </v-card-subtitle>
          </div>
        </div>
        <div>
          <v-btn
            text
            @click="prevStep"
            v-if="currentStep > 1"
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
          >{{ currentStep === 3 ? 'Sign and Confirm ' : 'Continue ' }}
            <v-icon style="color: black!important;" small v-if="currentStep !==3" class="ml-1">mdi-arrow-right</v-icon>
          </v-btn>
        </div>
      </v-card-actions>
    </BaseDialog>
  </template>
  <script lang="ts">
  import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
  import CustomStepper from '@/shared/components/CustomStepper.vue';
  import SendRecipientDetailsStepMultisig from '@/modules/multisig/components/SendRecipientDetailsStep.vue';
  import AssetsToSendStep from '@/modules/multisig/components/AssetsToSendStep.vue';
  import SummaryStep from '@/modules/multisig/components/SummaryStep.vue';
  import { appWallet, useStore } from '@/stores';
  import { mapState } from 'pinia';
  import { assetsToValue, parseAddress, toUTxO } from '@/shared/utils/converter';
  import { buildTx } from '@/shared/utils/builder';
  import rules from '@/utils/rules';
  import { Network, WalletType } from '@/models/types';
  import {
    Transaction,
    TransactionOutput,
    TransactionOutputs,
    TransactionUnspentOutputs, TransactionWitnessSet,
  } from '@emurgo/cardano-serialization-lib-browser';
  import networks from '@/utils/networks';
  import filters from '@/shared/utils/filters';
  import snackbar from '@/plugins/snackbar';
  import USBBluetoothSwitch from '@/shared/components/USBBluetoothSwitch.vue';
  import { createKeystoneSignRequest, parseSignature, qrCodeOptions } from '@/shared/utils/keystone';
  import Vue from 'vue';
  import QRCodeStyling from 'qr-code-styling';
  import { QrcodeStream } from "vue-qrcode-reader";
  // import AnimatedQRCode from '@/shared/components/AnimatedQRCode.vue';
  import { UREncoder } from '@keystonehq/keystone-sdk';
  import { walletConfigStore } from '@/stores/modules/walletConfig';
  import { multisigStore } from '@/stores/modules/multisig';

  export default defineComponent({
    name: 'MultisigTransactionDialog',
    components: { QrcodeStream, USBBluetoothSwitch, BaseDialog, CustomStepper, SendRecipientDetailsStepMultisig, AssetsToSendStep, SummaryStep },
    props: {
      isOpen: {
        type: Boolean,
        default: false,
      },
      recipientAddressProp: {
        type: String,
        default: ''
      },
      isMultisig: {
        type: Boolean,
        default: false,
      }
    },
    computed: {
      ...mapState(useStore, [
        'loggedWallet',
        'baseAddress',
        'latestTip',
        'pinnedTokens',
      ]),
      ...mapState(multisigStore, ['multiSigWallet', 'multiSigWallets', 'resolvedAssets']),
      ...mapState(walletConfigStore, [
        'utxos',
        'addresses'
      ]),
      WalletType() {
        return WalletType
      },
      networks() {
        return networks
      },
      tokens() {
        console.log('this.resolvedAssets', this.resolvedAssets)
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
          return rules.paymentAddress(this.loggedWallet?.network !== Network.MAINNET)(this.sendData.recipientAddress)
        }
        if (this.currentStep === 2) {
          if (!this.txValid) {
            return false;
          }
          const hasZeroQuantity = (items) => items?.some(item => Number(item.quantity) === 0);
          return !(hasZeroQuantity(this.sendData.selectedTokens) || hasZeroQuantity(this.sendData.selectedCollectibles));
        }
        if (this.currentStep === 3) {
          if (this.loggedWallet?.type === WalletType.Normal) {
            return Boolean(this.spendingPassword);
          } else {
            return true
          }
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
            if (!val.recipientAddress) {
              return;
            }
            this.buildTx(this.sendData.selectedTokens)
            this.txValid = true
          } catch(e) {
            console.error(e)
            if (typeof e === 'string' && e.includes('less than the minimum UTXO value')) {
              const match = e.match(/minimum UTXO value (\d+)/);
              const number = match ? parseInt(match[1], 10) : null;
              this.sendData.minAda = Number(filters.toCurrency(number, false, 6, '', '', false, 6).replaceAll(",", ""))
            } else if (typeof e === 'string' && e.includes('Insufficient input in transaction.')) {
              const match = e.match(/{ada in inputs: (\d+), ada in outputs: (\d+), fee (\d+)/);
              const number = parseInt(match[2], 10) - parseInt(match[1], 10)
              this.sendData.adaShortage = Number(filters.toCurrency(number, false, 6, '', '', false, 6).replaceAll(",", ""))
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
        recipientAddress: '', // this.recipientAddressProp || '',
        selectedWallet: {},
        minAda: 0,
        adaShortage: 0,
        senderWallet: '',
        availableWallets: [],
      },
      txValid: false,
      isBT: false,
      overlay: false,
      type: undefined,
      cbor: undefined,
      keystoneScan: false,
      isInit: false,
      qrCode: null,
    }),
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
          this.txBody,
          TransactionWitnessSet.from_bytes(Buffer.from(signature.witnessSet, "hex")),
          undefined // TODO Transaction metadata
        );
        console.log(signedTx.to_json())
        const txId = await appWallet.submitTx(signedTx, this.utxos);
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
      async signAndSubmitTx() {
        const signAndReturnTx = async () => {
          this.txSubmitLoading = true
          try {
            const txCbor = this.txData.to_hex()
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
              this.txBody,
              TransactionWitnessSet.from_bytes(Buffer.from(response.witnesses, "hex")),
              undefined // TODO Transaction metadata
            );
            console.log(signedTx.to_json())
            const txId = await appWallet.submitTx(signedTx, this.utxos);
            console.log(txId)
            snackbar.fireSuccess(`Tx Submitted Successfully. Tx ID: ${txId}`)
            this.$emit('close')
          } catch (e) {
            snackbar.setError(e.toString())
            console.error(e);
          }
          this.txSubmitLoading = false
        };
        if (appWallet?.type === WalletType.Normal) {
          if (appWallet.verifySpendingPassword(this.spendingPassword)) {
            await signAndReturnTx();
          } else {
            this.enableToolTip();
          }
        } else if (appWallet?.type === WalletType.Keystone) {
          if (this.qrCode) {
            this.qrCode = null; // Clear the QRCode instance
            if (this.$refs['qrCode']) {
              (this.$refs['qrCode'] as HTMLElement).innerHTML = '';
            }
          }

          const ur = createKeystoneSignRequest(this.txData, this.loggedWallet, this.utxos, this.addresses);
          this.type = ur.type;
          this.cbor = Buffer.from(ur.cbor).toString('hex')
          qrCodeOptions(UREncoder.encodeSinglePart(ur), 430)
          console.log('')
          this.overlay = true
          this.qrCode = new QRCodeStyling(qrCodeOptions(UREncoder.encodeSinglePart(ur), 450))
          Vue.nextTick(() => {
            this.qrCode.append(this.$refs['qrCode']);
          });
          console.log('qrCode')
        } else {
          await signAndReturnTx();
        }
      },
      buildTx(sendTokens) {
        const recipientAddress = this.sendData.recipientAddress;
        const tokens = [];
        if (sendTokens.length > 0) {
          sendTokens.filter(token => (token.unit || token.unit === '') && token.decimals).forEach(token => {
            if (token.ticker === networks.resolveCurrencyTicker(this.loggedWallet.chain, this.loggedWallet.network)) {
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
        outputs.add(TransactionOutput.new(parseAddress(recipientAddress), assetsToValue(tokens)));
        const transactionUnspentOutputs = TransactionUnspentOutputs.new();
        this.utxos.forEach((utxo) => transactionUnspentOutputs.add(toUTxO(utxo)));
        try {
          this.txBody = buildTx(this.sendData.selectedWallet, outputs, transactionUnspentOutputs, this.latestTip.slot, this.baseAddress, [], []);
          this.sendData.minAda = 0
          this.sendData.adaShortage = 0
          this.txValid = true
          this.txData = Transaction.new(this.txBody, TransactionWitnessSet.new())
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
            if (this.$refs['summary'] && typeof (this.$refs['summary'] as any).scanTx === 'function') {
              (this.$refs['summary'] as any).scanTx(this.txData);
            }
            this.currentStep++;
          } else if (this.currentStep === 3) {
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
      setMax(index) {
        const sendTokensCopy = JSON.parse(JSON.stringify(this.sendData.selectedTokens));
        const selectedToken = sendTokensCopy[index];

        if (selectedToken.decimals) {
          selectedToken.quantity = Number(filters.toCurrency(sendTokensCopy[index].balance, false, sendTokensCopy[index].decimals, '', '', false, sendTokensCopy[index].decimals).replaceAll(",",""));
        } else {
          selectedToken.quantity = Number(selectedToken.balance);
        }
        this.tryBuildMaxTx(sendTokensCopy, index);
      },
      tryBuildMaxTx(tokens, index) {
        try {
          this.buildTx(tokens)
        } catch (e) {
          if (typeof e === 'string' && e.includes('Insufficient input in transaction.')) {
            const match = e.match(/{ada in inputs: (\d+), ada in outputs: (\d+), fee (\d+)/);
            const maxBalance = Number(match[2]) - Number(match[3])
            this.sendData.selectedTokens[index].quantity = `${Number(filters.toCurrency(maxBalance, false, 6, '', '', false, 6).replaceAll(",", ""))}`
          } else if (typeof e === 'string' && e.includes('less than the minimum UTXO value')) {
            const match = e.match(/Value (\d+) less than the minimum UTXO value (\d+)/);
            console.log(match)
            const adaMinBalance = match[2]
            const nativeToken = this.sendData.selectedTokens.find(token => token.ticker === networks.resolveCurrencyTicker(this.loggedWallet.chain, this.loggedWallet.network))
            if (nativeToken) {
              nativeToken.quantity = `${Number(filters.toCurrency(Number(adaMinBalance), false, 6, '', '', false, 6).replaceAll(",", ""))}`
              this.sendData.selectedTokens[index].quantity = `${Number(tokens[index].balance)}`
            }
          } else {
            console.log(e)
          }
        }
      },
      resetData() {
        this.show1 = false
        this.keystoneScan = false
        this.isInit = false
        this.overlay = false
        this.spendingPassword = ''
        this.currentStep = 1;
        this.txSubmitLoading = false
        this.txBody = undefined
        this.txData = undefined
        const currencyTicker = networks.resolveCurrencyTicker(appWallet.chain, appWallet.network)
        const foundAsset = this.tokens.find(token => token.ticker === currencyTicker)
        if (foundAsset) {
          foundAsset.verified = true;
        }
        this.sendData = {
          selectedTokens: foundAsset ? [foundAsset] : [],
          selectedCollectibles: [],
          recipientAddress: this.recipientAddressProp,
          selectedWallet: this.multiSigWallet,
          minAda: 0,
          adaShortage: 0,
          senderWallet: this.multiSigWallet as any,
          availableWallets: this.multiSigWallets,
        };
        console.log("resetData sendData::", this.sendData);
      },
    },
    mounted() {
      if(this.isMultisig) {
        this.sendData = { ...this.sendData, recipientAddress: this.recipientAddressProp};
        this.nextStep();
      }
      if (this.resolvedAssets) {
        const nativeTicker = networks.resolveCurrencyTicker(this.loggedWallet.chain, this.loggedWallet.network)
        const adaAssetFound = this.resolvedAssets.find(asset => asset.metadata.ticker === nativeTicker);
        if (adaAssetFound) {
          this.sendData.selectedTokens = [adaAssetFound];
        }
      }
    }

  });
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
  .v-stepper__content {
    padding: 0;
  }
  </style>
