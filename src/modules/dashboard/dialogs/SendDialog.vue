<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="emit('close')"
    :title="String($t('wallet.quickSend'))"
    :loading="txSubmitLoading"
    :min-height="0"
    :subtitle="String($t('wallet.quickSendSubtitle', { currency: networks.resolveCurrencyTicker(loggedWallet?.chain, loggedWallet?.network) }))"
    :persistent="false"
    :img="assets.sendSvg"
    imgStyle="filter: brightness(0) saturate(100%) invert(100%) sepia(49%) saturate(2%) hue-rotate(47deg) brightness(118%) contrast(101%);"
  >
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
            @setMax="setMax"
          ></AssetsToSendStep>
        </v-stepper-content>
        <v-stepper-content step="3">
          <SummaryStep ref="summary" :sendData="sendData" :tx-data="tx" @next="signAndSubmitTx" @prev="prevStep"></SummaryStep>
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
          <b>{{ $t('wallet.instructions') }}</b>
          <div v-if="loggedWallet?.type === WalletType.Keystone">
            <ul class="text-left" style="line-height: 1.5">
              <li>{{ $t('wallet.unlockKeystone') }}</li>
              <li>{{ $t('wallet.selectScanQR') }} <v-icon small>mdi-line-scan</v-icon></li>
              <li>{{ $t('wallet.useKeystoneToScan') }}</li>
              <li>{{ $t('wallet.approveAndScanNext') }}</li>
            </ul>
          </div>
        </v-alert>
        <v-card flat class="transparent" v-else-if="loggedWallet?.type === WalletType.Keystone && keystoneScan">
          <v-card-title>
            {{ $t('wallet.scanQRCode') }}
          </v-card-title>
          <v-card-subtitle>
            <ul class="text-left" style="line-height: 1.5">
              <li>{{ $t('wallet.adjustDistance') }}</li>
              <li>{{ $t('wallet.useLowDensity') }}</li>
            </ul>
          </v-card-subtitle>
          <v-card-text class="text-center">
            <div class="qr-scanner" v-show="isInit">
<!--              <QrcodeStream @decode="onDecode" @init="onInit">-->
<!--                <div id="qr-shaded-region" style="position: absolute; border-width: 74px 163px; border-style: solid; border-color: rgba(0, 0, 0, 0.48); box-sizing: border-box; inset: 0;">-->
<!--                  <div style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; top: -5px; left: 0;"></div>-->
<!--                  <div style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; top: -5px; right: 0;"></div>-->
<!--                  <div style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; bottom: -5px; left: 0;"></div>-->
<!--                  <div style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; bottom: -5px; right: 0;"></div>-->
<!--                  <div style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; top: -5px; left: -5px;"></div>-->
<!--                  <div style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; bottom: -5px; left: -5px;"></div>-->
<!--                  <div style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; top: -5px; right: -5px;"></div>-->
<!--                  <div style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; bottom: -5px; right: -5px;"></div>-->
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
        <PassKeyPasswordField
          ref="passwordField"
          v-if="loggedWallet?.type === WalletType.Normal"
          :value="spendingPassword"
          @input="spendingPassword = $event"
          outlined
          dense
          hide-details
          :rules="[rules.required()]"
          :disabled="txSubmitLoading"
          required
          @enter="nextStep"
          @passkey-autofill-success="handlePassKeySuccess"
          @passkey-autofill-error="handlePassKeyError"
          style="width: 295px"
          class="mb-2"
        />
        <div v-else-if="loggedWallet?.type === WalletType.Ledger" class="pb-4" style="align-content: center;">
          <v-card-subtitle class="pa-0 text-center justify-center pt-0" style="color: white">
            <ToggleSwitch :text-left="$t('dashboard.usb')" icon-left="mdi-usb" :text-right="$t('dashboard.bluetooth')" icon-right="mdi-bluetooth" v-model="isBT" :disabled="txSubmitLoading" />
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
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import CustomStepper from '@/shared/components/CustomStepper.vue';
import SendRecipientDetailsStep from '../components/SendRecipientDetailsStep.vue';
import AssetsToSendStep from '../components/AssetsToSendStep.vue';
import SummaryStep from '../components/SummaryStep.vue';
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import rules from '@/utils/rules';
import { WalletType } from '@/models/types';
import networks from '@/utils/networks';
import filters from '@/shared/utils/filters';
import snackbar from '@/plugins/snackbar';
// import { createKeystoneSignRequest, parseSignature, qrCodeOptions } from '@/shared/utils/keystone';
import { toRefs, onMounted, computed, ref, watch, getCurrentInstance } from 'vue';
import QRCodeStyling from 'qr-code-styling';
// import { QrcodeStream } from "vue-qrcode-reader";
// import { UREncoder } from '@keystonehq/keystone-sdk';
import { isPaymentAddress } from '@/chrome/serialization';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import { serializeCardanoJsSdkTx, BrowserTxConstruction } from '@/chrome/cardanoJsSdkCbor';
import { BackgroundResponse, Messaging, VerifyPasswordResponse } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { Cardano, Serialization } from '@cardano-sdk/core';
import ledgerUtils from '@/shared/utils/ledger';
import assets from '@/utils/assets';

interface Props {
  isOpen: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits(['close']);

const { t } = useTranslation();

const { loggedWallet, utxos, tokens: resolvedAssets, keys } = toRefs(walletStore)
const { tip, epochParams } = toRefs(networkStore)

const currentStep = ref<number>(1);
const sendData = ref<any>({
  selectedTokens: [],
  selectedCollectibles: {},
  recipientAddress: '',
  selectedWallet: {},
  minAda: 0,
  adaShortage: 0
});
const txValid = ref<boolean>(false);
const spendingPassword = ref<string>('');
const passwordField = ref<any>(null);
const steps = ref<any[]>([
  {
    name: 'recipientDetails',
    label: t('wallet.recipientDetails'),
  },
  {
    name: 'assetsToSend',
    label: t('wallet.assetsToSend'),
  },
  {
    name: 'summary',
    label: t('wallet.summary'),
  },
]);
const tx = ref<Cardano.Tx | undefined>(undefined);
const txCbor = ref<string>('');
const txWitnesses = ref<string>('');
const isSubmit = ref<boolean>(false);
const txSubmitLoading = ref<boolean>(false);
const show1 = ref<boolean>(false);
const isBT = ref<boolean>(false);
const isCalculatingMax = ref<boolean>(false);

// Debug watcher for Bluetooth toggle
watch(isBT, (newValue) => {
  console.log('isBT changed to:', newValue);
}, { immediate: true });
const overlay = ref<boolean>(false);
// const type = ref<string>('');
// const cbor = ref<string>('');
const keystoneScan = ref<boolean>(false);
const isInit = ref<boolean>(false);
const qrCode = ref<QRCodeStyling | null>(null);

const tokens = computed(() => {
  if (resolvedAssets.value) {
    const tokens = Object.values(resolvedAssets.value).map((token: any) => {
      return {
        ...token,
        name: token.metadata.name,
        ticker: token.metadata.ticker,
        img: token.img,
        quantity: "0",
        balance: token.quantity,
        decimals: token.metadata.decimals,
        unit: token.unit,
        verified: token.verified
      }
    })
    tokens.sort((a,b) => {
      if (a.ticker === networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network)) {
        return -1
      }
      return 0;
      // return (this.pinnedTokens.includes(a.unit) ? -1 : 1) || a.ticker.localeCompare(b.ticker) TODO
    })
    return tokens
  }
  return []
})

const isValid = computed(() => {
  if (currentStep.value === 1) {
    const fn = rules.recipientRules(loggedWallet.value?.chain, loggedWallet.value?.network);
    return fn(sendData.value.recipientAddress) !== 'Invalid Payment Address'
  }
  if (currentStep.value === 2) {
    console.log('step2')
    if (!txValid.value) {
      return false;
    }
    const hasZeroQuantity = (items) => {
      // Handle both arrays and objects
      const itemsArray = Array.isArray(items) ? items : Object.values(items || {});
      return itemsArray.some(item => Number(item.quantity) === 0 || Number(item.toSendQuantity) === 0);
    };
    return !(hasZeroQuantity(sendData.value.selectedTokens) || hasZeroQuantity(sendData.value.selectedCollectibles));
  }
  if (currentStep.value === 3) {
    if (loggedWallet.value?.type === WalletType.Normal) {
      return !!spendingPassword.value;
    } else {
      return true
    }
  }
  return false;
})

const resetData = () => {
  show1.value = false
  keystoneScan.value = false
  isInit.value = false
  overlay.value = false
  spendingPassword.value = ''
  currentStep.value = 1;
  txSubmitLoading.value = false
  tx.value = undefined
  txCbor.value = ''
  txWitnesses.value = ''
  isSubmit.value = false
  txValid.value = false  // Reset tx validation state
  const currencyTicker = networks.resolveCurrencyTicker(loggedWallet.value.chain, loggedWallet.value.network)
  const foundAsset = tokens.value.find(token => token.ticker === currencyTicker)
  if (foundAsset) {
    foundAsset.verified = true
  }
  sendData.value = {
    selectedTokens: [foundAsset],
    selectedCollectibles: {},
    recipientAddress: '',
    selectedWallet: loggedWallet.value,
    minAda: 0,
    adaShortage: 0
  };
  console.log(sendData.value)
}

const backScan = () => {
  if (keystoneScan.value) {
    keystoneScan.value = false
    isInit.value = false
  } else {
    overlay.value = false
  }
}

// const onDecode = async (result) => {
//   console.log(result)
//   const signature = parseSignature(result);
//
//   try {
//     const submitResult = await Messaging.sendToBackgroundFromOptions({
//       method: MessageTypes.SUBMIT_TX,
//       data: {
//         txCbor: txCbor.value,
//         witnessHex: signature.witnessSet,
//         utxos: utxos.value
//       }
//     }) as { data: { txId?: string; error?: string } };
//
//     if (submitResult.data.error) {
//       throw new Error(submitResult.data.error);
//     }
//
//     snackbar.fireSuccess(`Tx Submitted Successfully. Tx ID: ${submitResult.data.txId}`);
//     emit('close');
//   } catch (error) {
//     console.error('Error submitting transaction:', error);
//     snackbar.setError(error instanceof Error ? error.message : 'Unknown error');
//   }
// }
//
// const onInit = (promise) => {
//   promise.then(() => {
//     isInit.value = true
//     console.log("Camera initialized successfully");
//   }).catch((error) => {
//     console.error("Camera initialization failed:", error);
//   });
// }

const handlePassKeySuccess = () => {
  console.log('✅ PassKey autofill successful in SendDialog - triggering sign');
  // Automatically trigger sign after successful PassKey autofill
  setTimeout(() => {
    nextStep();
  }, 300); // Small delay for UX feedback
}

const handlePassKeyError = (error: string) => {
  console.error('PassKey autofill error in SendDialog:', error);
  snackbar.setError(error || t('security.passKeyAuthFailed'));
}

const signTx = async (): Promise<boolean> => {
  txSubmitLoading.value = true;
  try {
    console.log('Signing send transaction');
    console.log('Transaction:', tx.value);

    // Serialize the Cardano.Tx to CBOR for Chrome messaging
    txCbor.value = serializeCardanoJsSdkTx(tx.value);
    console.log('Serialized transaction CBOR:', txCbor.value);

    // Sign the transaction via a background message
    const witnessResult = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_TX,
      data: {
        txCbor: txCbor.value,
        partialSign: false,
        password: spendingPassword.value,
        accountIndex: 0,
        utxos: utxos.value,
        addresses: keys.value,
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
    console.error('Error signing send transaction:', e);
    snackbar.setError(e instanceof Error ? e.message : t('errors.unknownError'));
    return false;
  } finally {
    txSubmitLoading.value = false;
  }
};

const submitTx = async () => {
  try {
    txSubmitLoading.value = true;
    console.log('Submitting send transaction');
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

    snackbar.fireSuccess(t('wallet.txSubmittedSuccess', { txId: submitResult.data.txId }));
    emit('close');
  } catch (e) {
    console.error('Error submitting send transaction:', e);
    snackbar.setError(e instanceof Error ? e.message : t('errors.unknownError'));
  } finally {
    txSubmitLoading.value = false;
    isSubmit.value = false;
  }
};

const signLedgerTx = async () => {
  txSubmitLoading.value = true;
  try {
    console.log('Signing transaction with modern Ledger approach');
    console.log('Using Bluetooth connection:', isBT.value);

    if (!tx.value) {
      throw new Error(t('common.noTransactionToSign'));
    }
    txCbor.value = serializeCardanoJsSdkTx(tx.value);
    const signatures: Cardano.Signatures = await ledgerUtils.txToLedger(
      tx.value,
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

    // Submit the transaction
    await submitTx();
  } catch (e) {
    ledgerUtils.ledgerErrorHandling(e);
  } finally {
    txSubmitLoading.value = false;
  }
};

async function signAndSubmitTx() {
  if (loggedWallet.value?.type === WalletType.Normal) {
    const passwordVerification = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.VERIFY_SPENDING_PASSWORD,
      data: { password: spendingPassword.value }
    }) as BackgroundResponse<VerifyPasswordResponse>;

    if (!passwordVerification.data.success) {
      passwordField.value?.showError(t('wallet.wrongSpendingPassword'));
      return;
    }
    const isValid: boolean = await signTx();
    if (!isValid) {
      return;
    }
    // Auto-submit for sending transactions (unlike staking where a user might want to review)
    await submitTx();
  } else if (loggedWallet.value?.type === WalletType.Keystone) {
    if (qrCode.value) {
      qrCode.value = null; // Clear the QRCode instance
      if (vmProxy.$refs.qrCode)
        vmProxy.$refs.qrCode.innerHTML = '';
    }

    // TODO: Update Keystone flow to work with Cardano JS SDK transactions
    // const ur = createKeystoneSignRequest(tx.value, loggedWallet.value, utxos.value, keys.value);
    // type.value = ur.type;
    // cbor.value = Buffer.from(ur.cbor).toString('hex');
    // qrCodeOptions(UREncoder.encodeSinglePart(ur), 430);
    // console.log('');
    // overlay.value = true;
    // qrCode.value = new QRCodeStyling(qrCodeOptions(UREncoder.encodeSinglePart(ur), 450));
    // Vue.nextTick(() => {
    //   qrCode.value.append(vmProxy.$refs.qrCode);
    // });
    // console.log('qrCode');
  } else if (loggedWallet.value?.type === WalletType.Ledger) {
    // Ledger Hardware Wallet Signing
    await signLedgerTx();
  } else {

  }
}

async function buildTx(sendTokens) {
  if (!sendData.value.recipientAddress || !isPaymentAddress(sendData.value.recipientAddress)) {
    return
  }

  const recipientAddress = sendData.value.recipientAddress;

  // Build asset map for Cardano JS SDK
  const assetsMap = new Map<Cardano.AssetId, bigint>();
  let coinsAmount = BigInt(0);

  if (sendTokens.length > 0) {
    sendTokens.filter(token => (token.unit || token.unit === '') && token.decimals != null).forEach(token => {
      const quantity = BigInt(Math.floor(Number(token.quantity) * Math.pow(10, token.decimals)));

      if (token.ticker === networks.resolveCurrencyTicker(loggedWallet.value.chain, loggedWallet.value.network)) {
        coinsAmount = quantity;
      } else {
        assetsMap.set(token.unit as Cardano.AssetId, quantity);
      }
    });
  }

  // selectedCollectibles is an object, convert to array
  const collectiblesArray = Object.values(sendData.value.selectedCollectibles);
  if (collectiblesArray.length > 0) {
    collectiblesArray.forEach(collectible => {
      assetsMap.set(collectible.unit as Cardano.AssetId, BigInt(collectible.toSendQuantity));
    });
  }

  // Create output using Cardano JS SDK format
  const outputs: Cardano.TxOut[] = [{
    address: recipientAddress as Cardano.PaymentAddress,
    value: {
      coins: coinsAmount as Cardano.Lovelace,
      assets: assetsMap
    }
  }];

  try {
    tx.value = await buildCardanoTransaction({
      outputs,
      utxos: utxos.value,
      epochParams: epochParams.value,
      changeAddress: loggedWallet.value.baseAddress,
      tip: tip.value
    });

    // Don't reset minAda here - it's set by the watch based on selected NFTs
    sendData.value.adaShortage = 0;
    txValid.value = true;
    console.log('Built transaction:', tx.value);
  } catch (e) {
    console.log(e);
    throw e;
  }
}

const vmProxy = getCurrentInstance()!.proxy as any

function nextStep() {
  if (currentStep.value <= steps.value.length) {
    if (currentStep.value === 1) {
      currentStep.value++;
    } else if (currentStep.value === 2) {
      vmProxy.$refs.summary.scanTx(tx.value);
      currentStep.value++;
    } else if (currentStep.value === 3) {
      signAndSubmitTx();
    }
  }
}

function prevStep() {
  if (currentStep.value > 1) {
    currentStep.value--;
  }
}

function updateRecipientAddress(address) {
  sendData.value.recipientAddress = address;
}

function selectCollectible(collectible) {
  console.log('selectCollectible called:', collectible.name);
  if (sendData.value.selectedCollectibles[collectible.name]) {
    vmProxy.$delete(sendData.value.selectedCollectibles, collectible.name);
    console.log('Removed collectible:', collectible.name);
  } else {
    vmProxy.$set(sendData.value.selectedCollectibles, collectible.name, collectible);
    console.log('Added collectible:', collectible.name);
  }
  console.log('Current selectedCollectibles:', sendData.value.selectedCollectibles);
  console.log('Object.values:', Object.values(sendData.value.selectedCollectibles));
}

async function setMax(index) {
  isCalculatingMax.value = true; // Disable watch while calculating max

  const sendTokensCopy = JSON.parse(JSON.stringify(sendData.value.selectedTokens));
  const selectedToken = sendTokensCopy[index];
  const nativeTicker = networks.resolveCurrencyTicker(loggedWallet.value.chain, loggedWallet.value.network);

  // For non-ADA tokens, just use the full balance
  if (selectedToken.ticker !== nativeTicker) {
    if (selectedToken.decimals) {
      selectedToken.quantity = Number(filters.toCurrency(sendTokensCopy[index].balance, false, sendTokensCopy[index].decimals, '', '', false, sendTokensCopy[index].decimals).replaceAll(",",""));
    } else {
      selectedToken.quantity = Number(selectedToken.balance);
    }
    await tryBuildMaxTx(sendTokensCopy, index);
    isCalculatingMax.value = false;
    return;
  }

  // For ADA, use two-phase approach: coarse search (1 ADA) then fine-tune (1 lovelace)
  const totalBalance = BigInt(selectedToken.balance);
  const ADA_STEP = BigInt(1_000_000); // 1 ADA steps for coarse search
  const LOVELACE_STEP = BigInt(1); // 1 lovelace steps for fine-tuning
  const MAX_BUFFER = BigInt(100_000_000); // Stop after 100 ADA buffer

  let buffer = BigInt(0);
  let coarseAmount = BigInt(0);

  // Phase 1: Coarse search with 1 ADA steps
  console.log('Phase 1: Coarse search with 1 ADA steps...');
  while (buffer <= MAX_BUFFER) {
    const attemptAmount = totalBalance - buffer;

    if (attemptAmount <= BigInt(0)) {
      break;
    }

    if (selectedToken.decimals) {
      selectedToken.quantity = Number(filters.toCurrency(Number(attemptAmount), false, selectedToken.decimals, '', '', false, selectedToken.decimals).replaceAll(",",""));
    } else {
      selectedToken.quantity = Number(attemptAmount);
    }

    try {
      await buildTx(sendTokensCopy);
      // Success! Found a working amount
      coarseAmount = attemptAmount;
      console.log(`✓ Coarse MAX found: ${Number(attemptAmount) / 1000000} ADA (buffer: ${Number(buffer) / 1000000} ADA)`);
      break;
    } catch (e) {
      // Failed - try 1 ADA less
      buffer += ADA_STEP;
    }
  }

  if (coarseAmount === BigInt(0)) {
    console.log('Could not find working amount in coarse search');
    isCalculatingMax.value = false;
    return;
  }

  // Phase 2: Binary search fine-tuning (try to add up to 1 ADA back)
  console.log('Phase 2: Binary search fine-tuning...');
  let low = coarseAmount;
  let high = coarseAmount + ADA_STEP;
  if (high > totalBalance) {
    high = totalBalance;
  }
  let finalAmount = coarseAmount;

  // Binary search with up to 20 iterations (enough for 1 lovelace precision in 1 ADA range)
  for (let iteration = 0; iteration < 20 && high - low > BigInt(1); iteration++) {
    const mid = (low + high) / BigInt(2);

    if (selectedToken.decimals) {
      selectedToken.quantity = Number(filters.toCurrency(Number(mid), false, selectedToken.decimals, '', '', false, selectedToken.decimals).replaceAll(",",""));
    } else {
      selectedToken.quantity = Number(mid);
    }

    try {
      await buildTx(sendTokensCopy);
      // Success! Try higher
      finalAmount = mid;
      low = mid;
      console.log(`✓ Binary search: ${Number(mid) / 1000000} ADA works (range: ${Number(high - low)} lovelace)`);
    } catch (e) {
      // Failed - try lower
      high = mid;
      console.log(`✗ Binary search: ${Number(mid) / 1000000} ADA failed (range: ${Number(high - low)} lovelace)`);
    }
  }

  console.log(`✓ Final MAX found: ${Number(finalAmount) / 1000000} ADA (added ${Number(finalAmount - coarseAmount)} lovelace to coarse result)`);


  console.log('MAX ADA calculation completed:', {
    totalBalance: totalBalance.toString(),
    finalAmount: finalAmount.toString(),
    finalAmountADA: Number(finalAmount) / 1000000
  });

  // Update the quantity and then immediately re-enable the watch
  // The watch will run once with the final amount
  // Convert to string to match CurrencyTextField prop type
  if (selectedToken.decimals) {
    sendData.value.selectedTokens[index].quantity = filters.toCurrency(Number(finalAmount), false, selectedToken.decimals, '', '', false, selectedToken.decimals).replaceAll(",","");
  } else {
    sendData.value.selectedTokens[index].quantity = String(Number(finalAmount));
  }

  // Re-enable watch AFTER setting the final amount
  // Wait a tick to ensure the update is processed
  await new Promise(resolve => setTimeout(resolve, 0));
  isCalculatingMax.value = false;
}

async function tryBuildMaxTx(tokens, index) {
  try {
    await buildTx(tokens)
  } catch (e: any) {
    const errorMessage = typeof e === 'string' ? e : (e?.message || e?.toString() || '');
    console.log('tryBuildMaxTx error:', errorMessage);

    if (errorMessage.includes('Insufficient input in transaction.')) {
      const match = errorMessage.match(/{ada in inputs: (\d+), ada in outputs: (\d+), fee (\d+)/);
      if (match) {
        const maxBalance = Number(match[2]) - Number(match[3])
        sendData.value.selectedTokens[index].quantity = `${Number(filters.toCurrency(maxBalance, false, 6, '', '', false, 6).replaceAll(",", ""))}`
      }
    } else if (errorMessage.includes('less than the minimum UTXO value')) {
      const match = errorMessage.match(/Value (\d+) less than the minimum UTXO value (\d+)/);
      if (match) {
        const adaMinBalance = match[2]
        const nativeToken = sendData.value.selectedTokens.find(token => token.ticker === networks.resolveCurrencyTicker(loggedWallet.value.chain, loggedWallet.value.network))
        if (nativeToken) {
          nativeToken.quantity = `${Number(filters.toCurrency(adaMinBalance, false, 6, '', '', false, 6).replaceAll(",", ""))}`
          sendData.value.selectedTokens[index].quantity = `${Number(tokens[index].balance)}`
        }
      }
    } else if (errorMessage.includes('UTxO Fully Depleted')) {
      // When all UTXOs are depleted, we can't send the full balance
      // Reduce the amount by a small margin and try again
      const currentQty = Number(tokens[index].quantity);
      const reducedQty = currentQty * 0.95; // Reduce by 5%
      sendData.value.selectedTokens[index].quantity = `${reducedQty.toFixed(6)}`;
      console.log('UTxO Fully Depleted - reduced amount to:', reducedQty);
    } else {
      console.error('Unhandled error in tryBuildMaxTx:', e);
    }
  }
}

watch(() => props.isOpen, (val) => {
  if (val) {
    resetData();
  }
})

// Watch only the properties that should trigger recalculation, not minAda itself
watch(() => ({
  selectedTokens: sendData.value.selectedTokens,
  selectedCollectibles: sendData.value.selectedCollectibles,
  recipientAddress: sendData.value.recipientAddress
}), async (val) => {
  // Skip if we're calculating max - the setMax function handles building the tx
  if (isCalculatingMax.value) {
    return;
  }

  try {
    // selectedCollectibles is an object, not an array
    const collectiblesArray = val.selectedCollectibles ? Object.values(val.selectedCollectibles) : [];

    console.log('build tx', {
      tokens: val.selectedTokens.length,
      collectibles: collectiblesArray.length
    })
    if (!val.recipientAddress) {
      return;
    }

    // Calculate minimum ADA required for any assets (tokens or NFTs) if selected
    // Only count non-native assets (exclude ADA/tADA)
    const nativeTicker = networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network);
    const hasNonNativeAssets = collectiblesArray.length > 0 ||
      val.selectedTokens.some(token => token?.unit && token.ticker !== nativeTicker);

    if (hasNonNativeAssets && epochParams.value && val.recipientAddress) {
      try {
        console.log('Calculating minAda for assets:', {
          collectibles: collectiblesArray.length,
          tokens: val.selectedTokens.filter(t => t?.unit).length
        });

        // Build the asset map for both collectibles and tokens
        const assetsMap = new Map<Cardano.AssetId, bigint>();

        // Add collectibles to assets map
        collectiblesArray.forEach((collectible: any) => {
          console.log('Adding collectible:', collectible.unit, collectible.toSendQuantity);
          assetsMap.set(collectible.unit as Cardano.AssetId, BigInt(collectible.toSendQuantity));
        });

        // Add tokens (non-ADA) to assets map
        // Only add tokens that are NOT the native currency (ADA/tADA)
        const nativeTicker = networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network);
        val.selectedTokens.forEach(token => {
          if (token?.unit && token.ticker !== nativeTicker) { // Skip ADA/native currency
            const quantity = token.quantity ? Math.floor(Number(token.quantity) * Math.pow(10, token.decimals || 0)) : 0;
            if (quantity > 0) {
              console.log('Adding token:', token.unit, quantity);
              assetsMap.set(token.unit as Cardano.AssetId, BigInt(quantity));
            }
          }
        });

        console.log('Assets map size:', assetsMap.size);
        console.log('Recipient address:', val.recipientAddress);
        console.log('coinsPerUtxoByte:', epochParams.value.coinsPerUtxoByte);

        // Create a mock output with all assets to calculate min ADA
        const mockOutput: Cardano.TxOut = {
          address: val.recipientAddress as Cardano.PaymentAddress,
          value: {
            coins: BigInt(0) as Cardano.Lovelace, // We're calculating the minimum, so start with 0
            assets: assetsMap
          }
        };

        console.log('Mock output created with assets:', assetsMap.size);

        // Use the actual protocol function to calculate minimum ADA
        const minAdaLovelace = BrowserTxConstruction.minAdaRequired(
          mockOutput,
          BigInt(epochParams.value.coinsPerUtxoByte)
        );

        sendData.value.minAda = Number(minAdaLovelace) / 1000000;
        console.log('Calculated minAda for all assets (accurate):', sendData.value.minAda, 'ADA');
      } catch (error) {
        console.error('Error calculating minAda:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : error);
        sendData.value.minAda = 0;
      }
    } else {
      sendData.value.minAda = 0;
    }

    await buildTx(val.selectedTokens)
    txValid.value = true
  } catch(e: any) {
    console.error('Build tx error:', e)
    const errorMessage = typeof e === 'string' ? e : (e?.message || e?.toString() || '');
    console.log('Error message:', errorMessage);

    if (errorMessage.includes('less than the minimum UTXO value') || errorMessage.includes('OutputTooSmallUTxO')) {
      const match = errorMessage.match(/minimum UTXO value (\d+)/);
      const number = match ? parseInt(match[1], 10) : null;
      if (number) {
        const errorMinAda = Number(filters.toCurrency(number, false, 6, '', '', false, 6).replaceAll(",", ""));
        console.log('Transaction builder reported minAda:', errorMinAda, 'but we calculated:', sendData.value.minAda);
        // Only update if the error value is higher (more conservative)
        if (errorMinAda > sendData.value.minAda) {
          sendData.value.minAda = errorMinAda;
          console.log('Updated minAda from error to:', sendData.value.minAda);
        }
      }
    } else if (errorMessage.includes('Insufficient input in transaction.')) {
      const match = errorMessage.match(/{ada in inputs: (\d+), ada in outputs: (\d+), fee (\d+)/);
      const number = parseInt(match[2], 10) - parseInt(match[1], 10)
      sendData.value.adaShortage = Number(filters.toCurrency(number, false, 6, '', '', false, 6).replaceAll(",", ""))
      console.log('Set adaShortage to:', sendData.value.adaShortage);
    } else if (errorMessage.includes('UTxO Fully Depleted')) {
      // This can happen when trying to send all ADA - just mark as invalid, user needs to reduce amount
      console.log('UTxO Fully Depleted - cannot build transaction with current amount');
    } else if (errorMessage.includes('Maximum Input Count Exceeded')) {
      // Wallet has too many small UTXOs - user needs to reduce the amount
      console.log('Maximum Input Count Exceeded - wallet has too many small UTXOs, reduce amount');
    }
    txValid.value = false
  }
}, { deep: true })

onMounted(() => {
  if (resolvedAssets.value) {
    const nativeTicker = networks.resolveCurrencyTicker(loggedWallet.value.chain, loggedWallet.value.network)
    const adaAssetFound = Object.values(resolvedAssets.value).find((asset: any) => asset.metadata.ticker === nativeTicker);
    if (adaAssetFound) {
      sendData.value.selectedTokens = [adaAssetFound];
    }
  }
})
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
