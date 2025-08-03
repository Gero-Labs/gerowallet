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
          <v-list-item-subtitle v-if="pool">{{ filters.truncate(pool.pool_id_bech32) }}<CopyButton class="ml-1" :value="pool.pool_id_bech32" x-small></CopyButton></v-list-item-subtitle>
        </v-list-item-content>

        <v-list-item-avatar
          size="80"
          v-if="poolExtendedInfo(pool)?.info?.url_png_icon_64x64"
        >
          <img :src="poolExtendedInfo(pool).info.url_png_icon_64x64" alt="" @error="fallbackImage"/>
        </v-list-item-avatar>
      </v-list-item>
      <v-card-title class="pt-0" style="color: white">{{ pool.block_count.toLocaleString('en-US') }}</v-card-title>
      <v-card-subtitle class="text-left pb-2">Lifetime Blocks</v-card-subtitle>
      <v-card-title class="pt-0" style="color: white">{{ pool.live_delegators }}</v-card-title>
      <v-card-subtitle class="text-left pb-2">Live Delegators</v-card-subtitle>
      <v-card-title class="pt-0" style="color: white">{{ filters.toCurrency(pool.live_stake, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</v-card-title>
      <v-card-subtitle class="text-left pb-2">Live Stake</v-card-subtitle>
      <v-card-title class="pt-0" style="color: white">{{ pool.ros.toLocaleString('en-US', {maximumFractionDigits: 2}) }}%</v-card-title>
      <v-card-subtitle class="text-left pb-2">ROS</v-card-subtitle>
      <v-card-title class="pt-0" style="color: white">
        <v-progress-linear rounded :color="filters.getColor(pool.live_saturation)" height="32" :value="pool.live_saturation" striped>
          <template v-slot:default="{ value }">
            <strong>{{ Math.ceil(value) }}%</strong>
          </template>
        </v-progress-linear>
      </v-card-title>
      <v-card-subtitle class="text-left pb-0">Live Saturation</v-card-subtitle>
    </v-card-text>
    <v-card-actions class="justify-center text-center pt-0 px-3" v-if="pool && account" style="display: block;">
      <v-form ref="formRef" v-model="valid">
        <v-row no-gutters>
          <v-col :cols="cols">
            <h4>Delegation Amt.
              <v-btn x-small icon>
                <v-icon small>mdi-information-outline</v-icon>
              </v-btn>
            </h4>
            <h4><strong>{{ filters.toCurrency(account.controlled_amount, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</strong></h4>
          </v-col>
          <v-col :cols="cols">
            <h4>Epoch Yield
              <v-btn x-small icon>
                <v-icon small>mdi-information-outline</v-icon>
              </v-btn>
            </h4>
            <h4>~<strong>{{ filters.toCurrency(account?.controlled_amount * pool.ros/100/73, false, 2, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</strong></h4>
          </v-col>
          <v-col :cols="cols" v-if="depositFee > 0">
            <h4>Deposit Fee</h4>
            <h4><strong>{{ filters.toCurrency(depositFee, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</strong></h4>
          </v-col>
          <v-col :cols="cols">
            <h4>Tx Fee</h4>
            <h4><strong>{{ filters.toCurrency(tx?.body?.fee?.toString() || '0', false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</strong></h4>
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
    <!-- TODO: Keystone hardware wallet overlay UI - currently disabled -->
    <!-- This overlay shows QR codes for Keystone device interaction -->
    <!-- When re-enabling, uncomment the v-overlay section below and restore related functionality -->
    <!--
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

      <AnimatedQRCode :type="type" :cbor="cbor" />
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
    -->
  </BaseDialog>
</template>
<script setup lang="ts">
import { ref, toRefs, watch, computed } from 'vue';
// import { nextTick } from 'vue'; // TODO: Needed for Keystone QR code functionality
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import { serializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import rules from '@/utils/rules';
import networks from "@/utils/networks";
import snackbar from '@/plugins/snackbar';
import { WalletType } from '@/models/types';
// TODO: Keystone hardware wallet support - currently disabled
// import { createKeystoneSignRequest, parseSignature, qrCodeOptions } from '@/shared/utils/keystone';
// import { UREncoder } from '@keystonehq/keystone-sdk';
// import QRCodeStyling from 'qr-code-styling';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { walletStore } from '@/stores/walletStore';
// import { walletManager } from '@/services/walletManager.service'; // Unused import
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import filters from '@/shared/utils/filters';
import { Cardano } from '@cardano-sdk/core';

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  pool: {
    type: Object as () => any
  },
  tx: {
    type: Object as () => Cardano.Tx,
    required: false,
    default: undefined,
  }
});

const emit = defineEmits(['close']);

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
// TODO: Keystone hardware wallet state - currently disabled
// const overlay = ref(false);
// const type = ref<string | undefined>(undefined);
// const cbor = ref<string | undefined>(undefined);
// const keystoneScan = ref(false);
// const isInit = ref(false);
// const qrCode = ref<QRCodeStyling | null>(null);
// const qrCodeRef = ref<HTMLElement | null>(null);
const formRef = ref<{ validate: () => boolean; resetValidation: () => void } | null>(null);
watch(() => props.isOpen, (val) => {
  if (val) {
    spendingPassword.value = ''
    showPassword.value = false
    if (formRef.value) {
      formRef.value.resetValidation()
    }
  }
});

watch(spendingPassword, () => {
  passwordRules.value = [rules.required()]
});
const depositFee = computed(() => {
  if (!props.tx?.body) return 0;

  let totalAdaOutput = 0;

  // Calculate input amounts
  if (props.tx.body.inputs) {
    for (const input of props.tx.body.inputs) {
      const utxo = utxos.value?.find((utxo: Cardano.Utxo) =>
        utxo[0].txId === input.txId && utxo[0].index === input.index
      );
      if (utxo) {
        totalAdaOutput -= Number(utxo[1].value.coins);
      }
    }
  }

  // Calculate output amounts
  if (props.tx.body.outputs) {
    for (const output of props.tx.body.outputs) {
      totalAdaOutput += Number(output.value.coins);
    }
  }

  // Check if this is a registration (has deposit)
  const hasRegistrationCert = props.tx.body.certificates?.some(
    cert => cert.__typename === Cardano.CertificateType.StakeRegistration
  );

  return hasRegistrationCert ? Number(props.tx.body.fee) : 0;
});

const cols = computed(() => {
  if (depositFee.value > 0) {
    return 3
  } else {
    return 4
  }
});
// TODO: Keystone QR code scanning functionality - currently disabled
// const backScan = () => {
//   if (keystoneScan.value) {
//     keystoneScan.value = false
//     isInit.value = false
//   } else {
//     overlay.value = false
//   }
// };

// TODO: Keystone QR code decoding and transaction signing - currently disabled
// This function would handle the QR code response from Keystone device
// and merge the signature into the Cardano.Tx transaction format
// const onDecode = async (result: string) => {
//   try {
//     console.log(result);
//     const signature = parseSignature(result);
//
//     // Create signed transaction with Cardano JS SDK format
//     const signedTx: Cardano.Tx = {
//       ...props.tx,
//       witness: {
//         signatures: new Map(), // signatures from Keystone would go here
//         // Add other witness data as needed from signature.witnessSet
//       }
//     };
//
//     console.log('Signed transaction:', signedTx);
//
//     // For now, this needs wallet adaptation to handle Cardano JS SDK transactions
//     // const txId = await loggedWallet.value.submitTx(signedTx, utxos.value);
//     // console.log(txId);
//     snackbar.fireSuccess('Tx Signed Successfully (Keystone with Cardano JS SDK)');
//     emit('close');
//   } catch (error) {
//     console.error('Error decoding QR:', error);
//     snackbar.setError(error instanceof Error ? error.message : 'Unknown error');
//   }
// };

// TODO: Camera initialization for Keystone QR scanning - currently disabled
// const onInit = (promise: Promise<any>) => {
//   promise.then(() => {
//     isInit.value = true;
//     console.log("Camera initialized successfully");
//   }).catch((error) => {
//     console.error("Camera initialization failed:", error);
//   });
// };

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
      console.log('Signing Cardano JS SDK delegation transaction');
      console.log('Transaction:', props.tx);

      // First verify password via background message
      const passwordVerification = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.VERIFY_SPENDING_PASSWORD,
        data: { password: spendingPassword.value }
      }) as { data: { isValid: boolean; error?: string } };

      if (!passwordVerification.data.isValid) {
        enableToolTip();
        loading.value = false;
        return;
      }

      // Serialize the Cardano.Tx to CBOR for Chrome messaging
      const txCbor = serializeCardanoJsSdkTx(props.tx);
      console.log('Serialized transaction CBOR:', txCbor);

      // Sign the transaction via background message
      const witnessResult = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SIGN_TX,
        data: {
          txCbor: txCbor, // Pass serialized CBOR instead of the object
          partialSign: false,
          password: spendingPassword.value,
          accountIndex: 0,
          utxos: utxos.value,
          addresses: keys.value, // Address mappings
          isUsb: false
        }
      }) as { data: { witnesses?: any; error?: string } };

      console.log('Transaction signed successfully:', witnessResult);

      if (witnessResult.data.error) {
        throw new Error(witnessResult.data.error);
      }

      console.log('Signed transaction witness:', witnessResult.data.witnesses);

      // Submit the transaction with original CBOR and witness
      // Let the background script combine them properly
      const submitResult = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SUBMIT_TX,
        data: {
          txCbor: txCbor,
          witnessHex: witnessResult.data.witnesses,
          utxos: utxos.value
        }
      }) as { data: { txId?: string; error?: string } };

      if (submitResult.data.error) {
        throw new Error(submitResult.data.error);
      }

      snackbar.fireSuccess(`Delegation Tx Submitted Successfully. Tx ID: ${submitResult.data.txId}`)
      emit('close')
    } catch (e) {
      console.error('Error signing delegation transaction:', e);
      snackbar.setError(e instanceof Error ? e.message : 'Unknown error')
    }
    loading.value = false
  };
  if (loggedWallet.value?.type === WalletType.Normal) {
    if (formRef.value.validate()) {
      await signAndReturnTx();
    }
  // TODO: Keystone hardware wallet signing flow - currently disabled
  // This would generate a QR code for the Keystone device to scan and sign
  // } else if (loggedWallet.value?.type === WalletType.Keystone) {
  //   if (qrCode.value) {
  //     qrCode.value = null;
  //     if (qrCodeRef.value)
  //       qrCodeRef.value.innerHTML = '';
  //   }
  //
  //   const ur = createKeystoneSignRequest(props.tx, loggedWallet.value, utxos.value, keys.value)
  //   type.value = ur.type
  //   cbor.value = Buffer.from(ur.cbor).toString('hex')
  //   qrCode.value = new QRCodeStyling(qrCodeOptions(UREncoder.encodeSinglePart(ur), 450))
  //   overlay.value = true
  //   nextTick(() => {
  //     qrCode.value.append(qrCodeRef.value);
  //   });
  } else {
    await signAndReturnTx();
  }
};

const poolExtendedInfo = (pool: any): any => {
  if (pool && pool.pool_extended_info) {
    return JSON.parse(pool.pool_extended_info);
  }
  return undefined;
};

const fallbackImage = (e: Event): void => {
  const target = e.target as HTMLImageElement;
  target.src = '';
};
</script>
<style scoped>

</style>
