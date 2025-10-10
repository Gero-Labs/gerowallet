<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Fund Wallet" :loading="txSubmitLoading" :min-height="0"
    :subtitle="`Add ${networks.resolveCurrencyTicker(loggedWallet?.chain, loggedWallet?.network)} or other assets to your multisig wallet.`">
    <v-card-title style="display: block;" class="py-0">
      <v-stepper v-model="currentStep" flat class="stepper-container" non-linear alt-labels>
        <v-stepper-header>
          <template v-for="(item, index) in steps">
            <div class="custom-step" :key="item.name"
              :class="{ active: currentStep === index + 1, done: currentStep > index + 1, next: currentStep < index + 1 }">
              <div class="icon-container">
                <v-icon class="step-icon" :color="currentStep < index + 1 ? '#00dff3' : '#0f0f0f'" size="20">{{
                  currentStep > index + 1 ? 'mdi-check' : 'mdi-circle-medium' }}
                </v-icon>
              </div>
              <span class="step-label">{{ item.label }}</span>
            </div>
            <div class="divider" :class="{ 'active-divider': currentStep > index + 1 }" :key="index"
              v-if="index < steps.length - 1"></div>
          </template>
        </v-stepper-header>
      </v-stepper>
    </v-card-title>
    <v-card-text class="px-3 pb-0 justify-center text-center"
      style="z-index: 1; min-height: 0; height: 490px; align-content: center;"
      :style="currentStep === 3 && loggedWallet?.type === WalletType.Normal ? { height: '442px' } : {}">
      <CustomStepper :currentStep="currentStep" :steps="steps">
        <v-stepper-content step="1">
          <SendRecipientDetailsStep :sendData="sendData" @updateRecipientAddress="updateRecipientAddress">
          </SendRecipientDetailsStep>
        </v-stepper-content>
        <v-stepper-content step="2">
          <AssetsToSendStep v-model="sendData" @select="selectCollectible" :tokens="tokens" @setMax="setMax">
          </AssetsToSendStep>
        </v-stepper-content>
        <v-stepper-content step="3">
          <SummaryStep ref="summary" :sendData="sendData" :tx-data="txData" @next="signAndSubmitTx" @prev="prevStep">
          </SummaryStep>
        </v-stepper-content>
      </CustomStepper>
      <v-overlay :absolute="true" opacity="0.99" :value="overlay" class="hardwareOverlay">
        <v-alert color="white" dense outlined type="info" prominent border="left" v-if="!keystoneScan"
          class="mt-10 mb-0">
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
<!--              <QrcodeStream @decode="onDecode" @init="onInit">-->
<!--                <div id="qr-shaded-region"-->
<!--                  style="position: absolute; border-width: 74px 163px; border-style: solid; border-color: rgba(0, 0, 0, 0.48); box-sizing: border-box; inset: 0;">-->
<!--                  <div-->
<!--                    style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; top: -5px; left: 0;">-->
<!--                  </div>-->
<!--                  <div-->
<!--                    style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; top: -5px; right: 0;">-->
<!--                  </div>-->
<!--                  <div-->
<!--                    style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; bottom: -5px; left: 0;">-->
<!--                  </div>-->
<!--                  <div-->
<!--                    style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; bottom: -5px; right: 0;">-->
<!--                  </div>-->
<!--                  <div-->
<!--                    style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; top: -5px; left: -5px;">-->
<!--                  </div>-->
<!--                  <div-->
<!--                    style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; bottom: -5px; left: -5px;">-->
<!--                  </div>-->
<!--                  <div-->
<!--                    style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; top: -5px; right: -5px;">-->
<!--                  </div>-->
<!--                  <div-->
<!--                    style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; bottom: -5px; right: -5px;">-->
<!--                  </div>-->
<!--                </div>-->
<!--              </QrcodeStream>-->
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
          <v-btn text @click="backScan" class="mr-2">{{ keystoneScan ? 'Back' : 'Cancel' }}
          </v-btn>
          <v-btn v-if="!keystoneScan" class="geroButton" style="color: black!important;"
            @click="keystoneScan = true">NEXT
          </v-btn>
        </div>
      </v-overlay>
    </v-card-text>
    <v-card-actions class="text-center justify-center"
      :style="loggedWallet?.type === WalletType.Ledger ? { display: 'block', height: '96px', alignContent: 'end' } : { flexFlow: 'column' }">
      <div class="" v-if="currentStep === 3">
        <v-tooltip v-model="tooltip.enabled" top color="red" v-if="loggedWallet?.type === WalletType.Normal">
          <template v-slot:activator="{ }">
            <v-text-field flat style="width: 295px" block dense v-model="spendingPassword" outlined
              label="Spending Password" :type="show1 ? 'text' : 'password'" :rules="[rules.required()]" hide-details
              class="mb-2" required :disabled="txSubmitLoading" @keydown.enter.prevent="nextStep">
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
            <ToggleSwitch text-left="USB" icon-left="mdi-usb" text-right="Bluetooth" icon-right="mdi-bluetooth" v-model="isBT" :disabled="txSubmitLoading" />
          </v-card-subtitle>
        </div>
      </div>
      <div>
        <v-btn text @click="prevStep" v-if="currentStep > 1" class="mr-2" :disabled="txSubmitLoading">
          <v-icon small class="mr-1">mdi-arrow-left</v-icon>Back
        </v-btn>
        <v-btn class="continue-button" @click="nextStep" :disabled="!isValid || txSubmitLoading"
          :loading="txSubmitLoading">
          {{ currentStep === 3 ? 'Sign and Confirm ' : 'Continue ' }}
          <v-icon style="color: black!important;" small v-if="currentStep !== 3" class="ml-1">mdi-arrow-right</v-icon>
        </v-btn>
      </div>
    </v-card-actions>
  </BaseDialog>
</template>
<script setup lang="ts">
import { ref, computed, watch, onMounted, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { WalletType } from '@/models/types';
import { Transaction, TransactionOutput, TransactionOutputs, TransactionUnspentOutputs, TransactionWitnessSet } from '@emurgo/cardano-serialization-lib-browser';
import networks from '@/utils/networks';
import filters from '@/shared/utils/filters';
import snackbar from '@/plugins/snackbar';
import { createKeystoneSignRequest, parseSignature, qrCodeOptions } from '@/shared/utils/keystone';
import { UREncoder } from '@keystonehq/keystone-sdk';
import { isPaymentAddress } from '@/chrome/serialization';
// import { multisigStore } from '@/stores/modules/multisig';
import { assetsToValue, parseAddress, toUTxO } from '@/shared/utils/converter';
import { buildTx as buildTransaction } from '@/shared/utils/builder';
import rules from '@/utils/rules';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import CustomStepper from '@/shared/components/CustomStepper.vue';
import SendRecipientDetailsStep from '../components/SendRecipientDetailsStep.vue';
import AssetsToSendStep from '../components/AssetsToSendStep.vue';
import SummaryStep from '../components/SummaryStep.vue';
// import { QrcodeStream } from "vue-qrcode-reader";
import QRCodeStyling from 'qr-code-styling';
import type { TransactionBody } from '@emurgo/cardano-serialization-lib-browser';
import type { Step, Token, SendData, Collectible } from '@/modules/multisig/types/MultiSigTypes';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';

const props = defineProps<{
  isOpen: boolean;
}>();
const emit = defineEmits(['close']);

const { loggedWallet, resolvedAssets, baseAddress, latestTip, pinnedTokens } = toRefs(walletStore);
// const { utxos, addresses } = storeToRefs(walletConfigStore()); // Using walletStore instead
const { utxos } = toRefs(walletStore);
// TODO: Get addresses from walletStore if needed
const addresses = ref(new Set()); // Placeholder
// const { multiSigWallet } = storeToRefs(multisigStore());


const steps: Step[] = [
  { name: 'recipientDetails', label: 'Recipient Details' },
  { name: 'assetsToSend', label: 'Assets to Send' },
  { name: 'summary', label: 'Summary' }
];

const currentStep = ref(1);
const tooltip = ref({
  enabled: false,
  text: 'Wrong Spending Password!'
});
const txBody = ref<TransactionBody | undefined>();
const txData = ref<Transaction | undefined>();
const txSubmitLoading = ref(false);
const spendingPassword = ref('');
const show1 = ref(false);
const txValid = ref(false);
const isBT = ref(false);
const overlay = ref(false);
const type = ref<string | undefined>();
const cbor = ref<string | undefined>();
const keystoneScan = ref(false);
const isInit = ref(false);
const qrCode = ref<QRCodeStyling | null>(null);
const summary = ref<InstanceType<typeof SummaryStep> | null>(null);

const sendData = ref<SendData>({
  isMultisigFunding: true,
  selectedTokens: [],
  selectedCollectibles: [],
  recipientAddress: '',
  selectedWallet: {},
  availableWallets: [],
  minAda: 0,
  adaShortage: 0,
  senderWallet: ''
});

const tokens = computed(() => {
  if (resolvedAssets.value) {
    const tokens = resolvedAssets.value.map(token => ({
      ...token,
      name: token.metadata.name,
      ticker: token.metadata.ticker,
      img: token.img,
      quantity: "0",
      balance: token.quantity,
      decimals: token.metadata.decimals,
      unit: token.unit
    }));

    tokens.sort((a, b) => {
      if (a.ticker === networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network)) {
        return -1;
      }
      return (pinnedTokens.value.includes(a.unit) ? -1 : 1) || a.ticker.localeCompare(b.ticker);
    });

    return tokens;
  }
  return [];
});

const isValid = computed(() => {
  if (currentStep.value === 1) {
    const fn = rules.recipientRules(loggedWallet.value?.chain, loggedWallet.value?.network);
    return fn(sendData.value.recipientAddress) !== 'Invalid Payment Address';
  }
  if (currentStep.value === 2) {
    if (!txValid.value) {
      return false;
    }
    const hasZeroQuantity = (items: any[]) => items?.some(item => Number(item.quantity) === 0);
    return !(hasZeroQuantity(sendData.value.selectedTokens) || hasZeroQuantity(Object.values(sendData.value.selectedCollectibles)));
  }
  if (currentStep.value === 3) {
    if (loggedWallet.value?.type === WalletType.Normal) {
      return Boolean(spendingPassword.value);
    }
    return true;
  }
  return false;
});

watch(() => props.isOpen, (val) => {
  if (val) {
    resetData();
  }
});

watch(() => sendData.value, (val) => {
  try {
    if (!val.recipientAddress) {
      return;
    }
    buildTx(sendData.value.selectedTokens);
    txValid.value = true;
  } catch (e) {
    console.error(e);
    if (typeof e === 'string' && e.includes('less than the minimum UTXO value')) {
      const match = e.match(/minimum UTXO value (\d+)/);
      const number = match ? parseInt(match[1], 10) : null;
      sendData.value.minAda = Number(filters.toCurrency(number, false, 6, '', '', false, 6).replaceAll(",", ""));
    } else if (typeof e === 'string' && e.includes('Insufficient input in transaction.')) {
      const match = e.match(/{ada in inputs: (\d+), ada in outputs: (\d+), fee (\d+)/);
      const number = parseInt(match[2], 10) - parseInt(match[1], 10);
      sendData.value.adaShortage = Number(filters.toCurrency(number, false, 6, '', '', false, 6).replaceAll(",", ""));
    }
    txValid.value = false;
  }
}, { deep: true });

const backScan = () => {
  if (keystoneScan.value) {
    keystoneScan.value = false;
    isInit.value = false;
  } else {
    overlay.value = false;
  }
};

const onDecode = async (result: string) => {
  console.log(result);
  const signature = parseSignature(result);
  if (!txBody.value) return;
  const signedTx = Transaction.new(
    txBody.value,
    TransactionWitnessSet.from_bytes(Buffer.from(signature.witnessSet, "hex")),
    undefined
  );
  console.log(signedTx.to_json());
  const txId = await loggedWallet.value.submitTx(signedTx, utxos.value);
  console.log(txId);
  snackbar.fireSuccess(`Tx Submitted Successfully. Tx ID: ${txId}`);
  emit('close');
};

const onInit = (promise: Promise<void>) => {
  promise.then(() => {
    isInit.value = true;
    console.log("Camera initialized successfully");
  }).catch((error) => {
    console.error("Camera initialization failed:", error);
  });
};

const enableToolTip = () => {
  tooltip.value.enabled = true;
  setTimeout(() => {
    tooltip.value.enabled = false;
  }, 3000);
};

const signAndSubmitTx = async () => {
  const signAndReturnTx = async () => {
    txSubmitLoading.value = true;
    try {
      if (!txData.value || !txBody.value) return;
      const txCbor = txData.value.to_hex();
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
        txBody.value,
        TransactionWitnessSet.from_bytes(Buffer.from(response.witnesses, "hex")),
        undefined
      );
      console.log(signedTx.to_json());
      const txId = await loggedWallet.value.submitTx(signedTx, utxos.value);
      console.log(txId);
      snackbar.fireSuccess(`Tx Submitted Successfully. Tx ID: ${txId}`);
      emit('close');
    } catch (e) {
      snackbar.setError(e as string);
      console.error(e);
    }
    txSubmitLoading.value = false;
  };

  if (loggedWallet.value?.type === WalletType.Normal) {
    if (loggedWallet.value.verifySpendingPassword(spendingPassword.value)) {
      await signAndReturnTx();
    } else {
      enableToolTip();
    }
  } else if (loggedWallet.value?.type === WalletType.Keystone) {
    if (qrCode.value) {
      qrCode.value = null;
      if (document.getElementById('qr-code')) {
        document.getElementById('qr-code')!.innerHTML = '';
      }
    }

    const ur = createKeystoneSignRequest(txData.value!, loggedWallet.value, utxos.value, addresses.value);
    type.value = ur.type;
    cbor.value = Buffer.from(ur.cbor).toString('hex');
    qrCodeOptions(UREncoder.encodeSinglePart(ur), 430);
    overlay.value = true;
    qrCode.value = new QRCodeStyling(qrCodeOptions(UREncoder.encodeSinglePart(ur), 450));
    nextTick(() => {
      qrCode.value?.append(document.getElementById('qr-code')!);
    });
    console.log('qrCode');
  } else {
    await signAndReturnTx();
  }
};

const buildTx = (sendTokens: Token[]) => {
  if (!sendData.value.recipientAddress || !isPaymentAddress(sendData.value.recipientAddress)) {
    return;
  }
  const recipientAddress = sendData.value.recipientAddress;
  const tokens = [];
  if (sendTokens.length > 0) {
    sendTokens.filter(token => (token.unit || token.unit === '') && token.decimals != null).forEach(token => {
      if (token.ticker === networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network)) {
        tokens.push({
          unit: 'lovelace',
          quantity: (Number(token.quantity) * Math.pow(10, token.decimals!)).toString(),
        });
      } else {
        tokens.push({
          unit: token.unit,
          quantity: (Number(token.quantity) * Math.pow(10, token.decimals!)).toString(),
        });
      }
    });
  }
  if (Object.keys(sendData.value.selectedCollectibles).length > 0) {
    Object.values(sendData.value.selectedCollectibles).forEach(collectible => {
      tokens.push({
        unit: collectible.unit,
        quantity: collectible.toSendQuantity.toString(),
      });
    });
  }
  const outputs = TransactionOutputs.new();
  outputs.add(TransactionOutput.new(parseAddress(recipientAddress), assetsToValue(tokens)));
  const transactionUnspentOutputs = TransactionUnspentOutputs.new();
  utxos.value.forEach((utxo) => transactionUnspentOutputs.add(toUTxO(utxo)));
  try {
    const txBodyResult = buildTransaction(sendData.value.selectedWallet, outputs, transactionUnspentOutputs, latestTip.value.slot, baseAddress.value, [], []);
    txBody.value = txBodyResult;
    sendData.value.minAda = 0;
    sendData.value.adaShortage = 0;
    txValid.value = true;
    txData.value = Transaction.new(txBodyResult, TransactionWitnessSet.new());
  } catch (e) {
    console.log(e);
    throw e;
  }
};

const nextStep = () => {
  if (currentStep.value <= steps.length) {
    if (currentStep.value === 1) {
      currentStep.value++;
    } else if (currentStep.value === 2) {
      summary.value?.scanTx(txData.value!);
      currentStep.value++;
    } else if (currentStep.value === 3) {
      signAndSubmitTx();
    }
  }
};

const prevStep = () => {
  if (currentStep.value > 1) {
    currentStep.value--;
  }
};

const updateRecipientAddress = (address: string) => {
  sendData.value.recipientAddress = address;
};

const selectCollectible = (collectible: Collectible) => {
  if (sendData.value.selectedCollectibles[collectible.name]) {
    delete sendData.value.selectedCollectibles[collectible.name];
  } else {
    sendData.value.selectedCollectibles[collectible.name] = collectible;
  }
};

const setMax = (index: number) => {
  const sendTokensCopy = JSON.parse(JSON.stringify(sendData.value.selectedTokens));
  const selectedToken = sendTokensCopy[index];

  if (selectedToken.decimals) {
    selectedToken.quantity = Number(filters.toCurrency(sendTokensCopy[index].balance, false, sendTokensCopy[index].decimals, '', '', false, sendTokensCopy[index].decimals).replaceAll(",", ""));
  } else {
    selectedToken.quantity = Number(selectedToken.balance);
  }
  tryBuildMaxTx(sendTokensCopy, index);
};

const tryBuildMaxTx = (tokens: Token[], index: number) => {
  try {
    buildTx(tokens);
  } catch (e) {
    if (typeof e === 'string' && e.includes('Insufficient input in transaction.')) {
      const match = e.match(/{ada in inputs: (\d+), ada in outputs: (\d+), fee (\d+)/);
      if (!match) return;
      const maxBalance = Number(match[2]) - Number(match[3]);
      sendData.value.selectedTokens[index].quantity = `${Number(filters.toCurrency(maxBalance, false, 6, '', '', false, 6).replaceAll(",", ""))}`;
    } else if (typeof e === 'string' && e.includes('less than the minimum UTXO value')) {
      const match = e.match(/Value (\d+) less than the minimum UTXO value (\d+)/);
      if (!match) return;
      console.log(match);
      const adaMinBalance = Number(match[2]);
      const nativeToken = sendData.value.selectedTokens.find(token => token.ticker === networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network));
      if (nativeToken) {
        nativeToken.quantity = `${Number(filters.toCurrency(adaMinBalance, false, 6, '', '', false, 6).replaceAll(",", ""))}`;
        sendData.value.selectedTokens[index].quantity = `${Number(tokens[index].balance)}`;
      }
    } else {
      console.log(e);
    }
  }
};

const resetData = () => {
  show1.value = false;
  keystoneScan.value = false;
  isInit.value = false;
  overlay.value = false;
  spendingPassword.value = '';
  currentStep.value = 1;
  txSubmitLoading.value = false;
  txBody.value = undefined;
  txData.value = undefined;
  const currencyTicker = networks.resolveCurrencyTicker(loggedWallet.value.chain, loggedWallet.value.network);
  const foundAsset = tokens.value.find(token => token.ticker === currencyTicker);
  if (foundAsset) {
    foundAsset.verified = true;
  }
  sendData.value = {
    selectedTokens: foundAsset ? [foundAsset] : [],
    selectedCollectibles: [],
    recipientAddress: multiSigWallet.value.paymentAddress,
    selectedWallet: loggedWallet.value,
    availableWallets: [loggedWallet.value],
    isMultisigFunding: true,
    minAda: 0,
    adaShortage: 0,
    senderWallet: ''
  };
  console.log("this.sendData", sendData.value);
};

onMounted(() => {
  if (resolvedAssets.value) {
    const nativeTicker = networks.resolveCurrencyTicker(loggedWallet.value.chain, loggedWallet.value.network);
    const adaAssetFound = resolvedAssets.value.find(asset => asset.metadata.ticker === nativeTicker);
    if (adaAssetFound) {
      sendData.value.selectedTokens = [adaAssetFound];
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
