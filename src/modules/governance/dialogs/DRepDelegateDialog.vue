<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Delegate to a DRep" :loading="loading" :min-height="660" :width="700"
              :subtitle="`Delegating your ${networks.resolveCurrencyTicker(loggedWallet?.chain, loggedWallet?.network)} to a Delegated Representative.`">
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1" v-if="drep">
      <v-alert
        border="left"
        color="primary"
        type="info"
        prominent
        class="text-left"
      >
        <ul>
          <li>You can only delegate to one DRep at a time</li>
          <li>You can switch to delegate to a different DRep at any time</li>
          <li>You can cancel your delegation at any time</li>
        </ul>
      </v-alert>
      <v-list-item three-line>
        <v-list-item-content class="text-left">
          <v-list-item-title class="text-h5 mb-1">
            {{ `${drep.name}` }}
          </v-list-item-title>
          <v-list-item-subtitle v-if="drep">{{ truncate(drep.id) }}<CopyButton class="ml-1" :value="drep.id" x-small></CopyButton></v-list-item-subtitle>
          <v-list-item-subtitle v-if="drep.links">
            <template v-for="(link, index) in drep.links">
              <v-btn icon x-small  :key="index" :href="link.uri" target="_blank" v-if="link.uri && typeof link.uri === 'string'">
                <v-avatar tile size="14" v-if="String(link.uri).includes('https://x.com') || String(link.uri).includes('https://twitter.com')">
                  <v-img :src="xLogo" alt="x"></v-img>
                </v-avatar>
                <v-avatar tile size="14" v-else-if="String(link.uri).includes('https://t.me')">
                  <v-img :src="telegramLogo" alt="x"></v-img>
                </v-avatar>
                <v-icon v-else>
                  {{ getIconByURI(link.uri)}}
                </v-icon>
              </v-btn>
            </template>
          </v-list-item-subtitle>
        </v-list-item-content>

        <v-list-item-avatar
          rounded
          size="80"
          v-if="drep.image"
        >
          <img :src="drep.image" alt="" @error="fallbackImage"/>
        </v-list-item-avatar>
      </v-list-item>
      <v-card-title class="pt-0" style="color: white">{{ drep.delegators }}</v-card-title>
      <v-card-subtitle class="text-left pb-2">Delegators</v-card-subtitle>
      <v-card-title class="pt-0" style="color: white">{{ drep.votes }}</v-card-title>
      <v-card-subtitle class="text-left pb-2">Votes</v-card-subtitle>
      <v-card-title class="pt-0" style="color: white">{{ toCurrency(drep.voting_power, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network))}}</v-card-title>
      <v-card-subtitle class="text-left pb-2">Voting Power</v-card-subtitle>
    </v-card-text>
    <v-card-actions class="justify-center text-center pt-0 px-3" v-if="drep && account" style="display: block;">
      <v-form ref="form" v-model="valid">
        <v-row no-gutters>
          <v-col :cols="cols">
            <h4>Delegation Amt.
              <v-btn x-small icon>
                <v-icon small>mdi-information-outline</v-icon>
              </v-btn>
            </h4>
            <h4><strong>{{ toCurrency(account.controlled_amount, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network))}}</strong></h4>
          </v-col>
          <v-col :cols="cols" v-if="depositFee > 0">
            <h4>Deposit Fee</h4>
            <h4><strong>{{ toCurrency(depositFee, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</strong></h4>
          </v-col>
          <v-col :cols="cols">
            <h4>Tx Fee</h4>
            <h4><strong>{{ toCurrency(tx.body().fee().to_str(), false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</strong></h4>
          </v-col>
          <v-col cols="12" class="pt-6" style="display: flex; justify-content: center;">
            <v-tooltip
              v-model="tooltip.enabled"
              top
              color="red"
              v-if="loggedWallet.type === WalletType.Normal"
            >
              <template v-slot:activator="{ }">
                <v-text-field
                  flat
                  style="max-width: 295px;"
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
                  @keydown.enter.prevent="signDelegationTx"
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
                <ToggleSwitch text-left="USB" icon-left="mdi-usb" text-right="Bluetooth" icon-right="mdi-bluetooth" v-model="isBT" :disabled="loading" />
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
<!--            <QrcodeStream @decode="onDecode" @init="onInit">-->
<!--              <div id="qr-shaded-region" style="position: absolute; border-width: 74px 163px; border-style: solid; border-color: rgba(0, 0, 0, 0.48); box-sizing: border-box; inset: 0;">-->
<!--                <div style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; top: -5px; left: 0;"></div>-->
<!--                <div style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; top: -5px; right: 0;"></div>-->
<!--                <div style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; bottom: -5px; left: 0;"></div>-->
<!--                <div style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; bottom: -5px; right: 0;"></div>-->
<!--                <div style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; top: -5px; left: -5px;"></div>-->
<!--                <div style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; bottom: -5px; left: -5px;"></div>-->
<!--                <div style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; top: -5px; right: -5px;"></div>-->
<!--                <div style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; bottom: -5px; right: -5px;"></div>-->
<!--              </div>-->
<!--            </QrcodeStream>-->
          </div>
          <div style="flex-flow: column; display: flex;align-items: center;" class="pt-10" v-if="!isInit">
            <v-progress-circular size="150" indeterminate></v-progress-circular>
            <span class="pt-4">Loading ... </span>
          </div>
        </v-card-text>
      </v-card>

      <!--      <AnimatedQRCode :type="type" :cbor="cbor" />-->
      <div id="qr-code" ref="qrCodeRef" class="text-center" v-show="!keystoneScan"> </div>
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
<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { toRefs } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import filters from '@/shared/utils/filters';
import CopyButton from '@/shared/components/CopyButton.vue';
import { BigNum, Transaction, TransactionWitnessSet } from '@emurgo/cardano-serialization-lib-browser';
import rules from '@/utils/rules';
import networks from "@/utils/networks";
import snackbar from '@/plugins/snackbar';
import { WalletType } from '@/models/types';
import { createKeystoneSignRequest, parseSignature, qrCodeOptions } from '@/shared/utils/keystone';
import { UREncoder } from '@keystonehq/keystone-sdk';
import QRCodeStyling from 'qr-code-styling';
import assets from '@/utils/assets';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { walletStore } from '@/stores/walletStore'

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  drep: {
    type: Object,
    default: () => {},
  },
  tx: {
    type: Transaction,
    default: () => {},
  }
});

const emit = defineEmits(['close']);

const { loggedWallet, utxos, account, keys } = toRefs(walletStore);

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
const overlay = ref(false);
const type = ref<string | undefined>(undefined);
const cbor = ref<string | undefined>(undefined);
const keystoneScan = ref(false);
const isInit = ref(false);
const qrCode = ref<any>(null);
const form = ref<any>(null);
const qrCodeRef = ref<HTMLElement | null>(null);

const { toCurrency, truncate } = filters;

// Constants for template
const xLogo = assets.xSvg;
const telegramLogo = assets.telegramSvg;

const depositFee = computed(() => {
  let depositFee = 0;
  const totalAdaBalance = BigNum.from_str(account.value.controlled_amount.toString())
  let totalAdaOutput = 0
  if (props.tx?.body()?.inputs()) {
    for (let i = 0; i < props.tx?.body()?.inputs().len(); i++) {
      const input = props.tx?.body()?.inputs().get(i)
      const utxo = utxos.value?.find(utxo => utxo.tx_hash === input.transaction_id().to_hex() && utxo.tx_index === input.index())
      if (utxo) {
        totalAdaOutput -= Number(utxo.value)
      }
    }
  }
  if (props.tx?.body()?.outputs()) {
    for (let i = 0; i < props.tx?.body()?.outputs().len(); i++) {
      const output = props.tx?.body()?.outputs().get(i)
      totalAdaOutput += Number(output.amount().coin().to_str())
    }
    console.log('totalAdaBalance', totalAdaBalance.to_str())
    console.log('totalAdaOutput', totalAdaOutput)
    depositFee = totalAdaOutput + Number(props.tx.body().fee().to_str())
    return depositFee*-1;
  }
  return 0
});

const cols = computed(() => {
  if (depositFee.value > 0) {
    return 4
  } else {
    return 6
  }
});

const getIconByURI = (uri: string) => {
  if (String(uri).includes('https://github.com')) {
    return 'mdi-github'
  } else if (String(uri).includes('youtube.com') || String(uri).includes('youtu.be')) {
    return 'mdi-youtube'
  } else if (String(uri).includes('linkedin.com')) {
    return 'mdi-linkedin'
  } else if (String(uri).includes('instagram.com')) {
    return 'mdi-instagram'
  } else if (String(uri).includes('discord.com')) {
    return 'mdi-discord'
  }
  return 'mdi-link'
};

const backScan = () => {
  if (keystoneScan.value) {
    keystoneScan.value = false
    isInit.value = false
  } else {
    overlay.value = false
  }
};

const onDecode = async (result: any) => {
  console.log(result)
  const signature = parseSignature(result);
  const signedTx = Transaction.new(
    props.tx.body(),
    TransactionWitnessSet.from_bytes(Buffer.from(signature.witnessSet, "hex")),
    undefined // TODO Transaction metadata
  );
  console.log(signedTx.to_json())
  const txId = await loggedWallet.value.submitTx(signedTx, utxos.value);
  console.log(txId)
  snackbar.fireSuccess(`Tx Submitted Successfully. Tx ID: ${txId}`)
  emit('close')
};

const onInit = (promise: Promise<any>) => {
  promise.then(() => {
    isInit.value = true
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

const signDelegationTx = async () => {
  const signAndReturnTx = async () => {
    loading.value = true
    try {
      const txCbor = props.tx.to_hex()
      const partialSign = false
      const response = await loggedWallet.value.signTx(
        txCbor,
        partialSign,
        spendingPassword.value,
        0,
        utxos.value,
        keys.value,
        !isBT.value
      );
      const signedTx = Transaction.new(
        props.tx.body(),
        TransactionWitnessSet.from_bytes(Buffer.from(response.witnesses, "hex")),
        undefined // TODO Transaction metadata
      );
      const txId = await loggedWallet.value.submitTx(signedTx, utxos.value);
      console.log(txId)
      snackbar.fireSuccess(`Delegation Tx Submitted Successfully. Tx ID: ${txId}`)
      emit('close')
    } catch (e) {
      snackbar.setError(e)
      console.log(e);
    }
    loading.value = false
  };
  if (loggedWallet.value?.type === WalletType.Normal) {
    if (form.value.validate()) {
      if (loggedWallet.value.verifySpendingPassword(spendingPassword.value)) {
        await signAndReturnTx();
      } else {
        enableToolTip();
      }
    }
  } else if (loggedWallet.value?.type === WalletType.Keystone) {
    if (qrCode.value) {
      qrCode.value = null; // Clear the QRCode instance
      if (qrCodeRef.value)
        qrCodeRef.value.innerHTML = '';
    }

    const ur = createKeystoneSignRequest(props.tx, loggedWallet.value, utxos.value, addresses.value)
    type.value = ur.type
    cbor.value = Buffer.from(ur.cbor).toString('hex')
    qrCode.value = new QRCodeStyling(qrCodeOptions(UREncoder.encodeSinglePart(ur), 450))
    overlay.value = true
    nextTick(() => {
      qrCode.value.append(qrCodeRef.value);
    });
  } else {
    await signAndReturnTx();
  }
};

const getColor = (value: number) => {
  if (value > 100) {
    value = 100
  }
  value = value / 100
  //value from 0 to 1
  const hue = ((1 - value) * 120).toString(10);
  return ["hsl(", hue, ",57.26%,54.12%)"].join("");
};

const poolExtendedInfo = (pool: any) => {
  if (pool && pool.pool_extended_info) {
    return JSON.parse(pool.pool_extended_info);
  }
  return undefined
};

const fallbackImage = (e: any) => {
  e.target.src = assets.errorImage
};

watch(() => props.isOpen, (val) => {
  if (val) {
    spendingPassword.value = ''
    showPassword.value = false
    if (form.value) {
      form.value.resetValidation()
    }
  }
});

watch(spendingPassword, () => {
  passwordRules.value = [
    rules.required()
  ]
});
</script>
<style scoped>

</style>
