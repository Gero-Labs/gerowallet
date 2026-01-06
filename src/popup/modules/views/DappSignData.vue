<template>
  <v-form ref="form" v-model="valid" class="fill-height">
    <PopupHeader :title="t('navigation.signData')" :show-website="!(vmProxy.$route.query['website'] === 'undefined' || Object.keys(vmProxy.$route.query).length === 0)" :disabled="loading">
      <v-card-text class="d-flex flex-column align-content-space-between pa-0 fill-height">
        <v-card-title class="pa-0" style="color: white; font-size: 14px">
          The website requested a signature
        </v-card-title>
        <v-card flat outlined style="background-color: #141414!important;flex: 1 1 auto; overflow-y: auto; max-height: 100%; height: 0;" class="pa-2" height="157">
          <v-card flat class="overflow-y-auto transparent" height="143">
            <v-card-text class="dapp-sign-details pa-0">
              {{message}}
            </v-card-text>
          </v-card>
        </v-card>
      </v-card-text>
      <v-card-actions class="justify-center pb-0 pt-3 px-0">
        <v-layout>
          <v-row>
            <v-col cols="12" v-if="loggedWallet.type === WalletType.Normal && !signature" class="pb-0">
              <PassKeyPasswordField
                ref="passwordField"
                :value="spendingPassword"
                @input="spendingPassword = $event"
                dense
                outlined
                hide-details
                :placeholder="t('navigation.typeYourSpendingPassword')"
                :label="t('wallet.spendingPassword')"
                :rules="[rules.required()]"
                required
                @enter="sign"
                @passkey-autofill-success="sign"
              />
            </v-col>
            <v-col cols="12" v-else-if="loggedWallet.type === WalletType.Ledger" class="pt-3 pb-0">
              <v-card-subtitle class="pa-0 text-center justify-center pt-0" style="color: white">
                <ToggleSwitch :text-left="t('wallet.usb')" icon-left="mdi-usb" :text-right="t('wallet.bluetooth')" icon-right="mdi-bluetooth" :value="isBT" @input="isBT = $event" :disabled="loading" />
              </v-card-subtitle>
            </v-col>
            <v-col cols="12" v-else-if="loggedWallet.type === WalletType.Trezor" class="pt-3 pb-0">
              <v-alert type="info" color="primary" text border="left" dense class="py-1 my-0" style="line-height: 1.2">
                <span style="color: white; font-size: 12px">
                  {{ $t('wallet.confirmOnTrezor') }}
                </span>
              </v-alert>
            </v-col>
            <v-col cols="12" v-else-if="loggedWallet.type === WalletType.Keystone" class="pt-3 pb-0">
              <v-alert type="info" color="primary" text border="left" dense class="py-1 my-0" style="line-height: 1.2">
                <span style="color: white; font-size: 12px">
                  {{ $t('wallet.scanQRWithKeystone') }}
                </span>
              </v-alert>
            </v-col>
            <v-col cols="6">
              <v-btn block outlined color="red" style="text-transform: capitalize;" @click="decline" :disabled="loading">
                Decline
              </v-btn>
            </v-col>
            <v-col cols="6">
              <v-btn
                block
                class="geroButton"
                style="color: black!important;"
                @click="sign"
                :loading="loading"
                :disabled="!valid || loading">
                {{txAutoSubmit ? $t('wallet.signAndConfirm') : !signature ? $t('wallet.sign') : $t('common.confirm')}}
              </v-btn>
            </v-col>
          </v-row>
        </v-layout>
      </v-card-actions>

      <!-- Keystone QR Code Overlay -->
      <v-overlay
        :absolute="true"
        opacity="0.99"
        :value="keystoneOverlay"
        class="hardwareOverlay"
      >
        <v-alert
          color="white"
          dense
          outlined
          type="info"
          border="left"
          v-if="!keystoneScan"
          class="mt-2 mb-2"
          prominent
        >
          <b style="font-size: 12px;">{{ $t('wallet.instructions') }}</b>
          <ul class="text-left" style="line-height: 1.3; font-size: 11px; margin-top: 4px; padding-left: 10px;">
            <li>{{ $t('wallet.unlockKeystone') }}</li>
            <li>{{ $t('wallet.selectScanQR') }} <v-icon x-small>mdi-line-scan</v-icon></li>
            <li>{{ $t('wallet.useKeystoneToScan') }}</li>
            <li>{{ $t('wallet.approveAndScanNext') }}</li>
          </ul>
        </v-alert>
        <v-alert
          color="white"
          dense
          outlined
          type="info"
          border="left"
          v-else
          class="mt-2 mb-2"
          prominent
        >
          <b style="font-size: 12px;">{{ $t('wallet.scanQRCode') }}</b>
          <ul class="text-left" style="line-height: 1.3; font-size: 11px; margin-top: 4px; padding-left: 10px;">
            <li>{{ $t('wallet.adjustDistance') }}</li>
            <li>{{ $t('wallet.useLowDensity') }}</li>
          </ul>
        </v-alert>
        <div v-if="!keystoneScan && keystoneCbor" style="max-width: 286px; margin: 0 auto;">
          <AnimatedQRCode :type="keystoneType" :cbor="keystoneCbor" :size="286" :capacity="100" />
        </div>
        <div v-else>
          <AnimatedQRScanner
            purpose="sign"
            :urTypes="['cardano-sign-data-signature']"
            width="100%"
            height="220px"
            @scan="onKeystoneScan"
            @error="onKeystoneError"
            @progress="onKeystoneProgress"
          />
        </div>
        <div class="text-center pt-2">
          <v-btn text small @click="backKeystoneScan" class="mr-2">
            {{ keystoneScan ? $t('common.back') : $t('common.cancel') }}
          </v-btn>
          <v-btn
            v-if="!keystoneScan"
            small
            class="geroButton"
            style="color: black!important;"
            @click="keystoneScan = true"
          >
            {{ $t('common.next') }}
          </v-btn>
        </div>
      </v-overlay>
    </PopupHeader>
  </v-form>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, onMounted, toRefs, getCurrentInstance } from 'vue';
import rules from '@/utils/rules';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import { BackgroundResponse, Messaging, SignDataResponse, VerifyPasswordResponse } from '@/chrome/messaging';
import { DataSignError } from '@/chrome/config';
import { Key, WalletType } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import AnimatedQRCode from '@/shared/components/AnimatedQRCode.vue';
import AnimatedQRScanner from '@/shared/components/AnimatedQRScanner.vue';
import { walletStore } from '@/stores/walletStore';
import { MessageTypes } from '@/models/MessageTypes';
import ledger from '@/shared/utils/ledger';
import { createKeystoneDataSignRequest, parseDataSignature } from '@/shared/utils/keystone';
import { SignedMessageData } from '@cardano-foundation/ledgerjs-hw-app-cardano/dist/types/public';
import networks from '@/utils/networks';
import { DeviceStatusError } from '@cardano-foundation/ledgerjs-hw-app-cardano';
import { Cardano } from '@cardano-sdk/core';
import { getPaymentKeyExternal, getPaymentKeyInternal, getStakeKey } from '@/chrome/serialization';
import { UR } from '@keystonehq/keystone-sdk';

const { t } = useTranslation();

const { loggedWallet, config, keys } = toRefs(walletStore);
const vmProxy = getCurrentInstance()!.proxy as any;
const spendingPassword = ref('');
const passwordField = ref<any>(null);
const request = ref<any>(null);
const message = ref('');
const valid = ref(false);
const isBT = ref(false);
const loading = ref(false);
const controller = ref<any>(null);
const tabId = ref<number | null>(null);
const signature = ref<any>(undefined);
const form = ref<any>(null);
// Keystone state
const keystoneOverlay = ref(false);
const keystoneScan = ref(false);
const keystoneType = ref('');
const keystoneCbor = ref('');
const keystoneBuilder = ref<any>(null); // Store builder to reuse when parsing signature
const keystoneAddressBytes = ref<Uint8Array | null>(null); // Store address bytes for COSE_Key

const txAutoSubmit = computed(() => {
  return config.value?.txAutoSubmit;
});

const useSidePanel = computed(() => {
  return config.value?.useSidePanel;
});

const decline = async () => {
  await controller.value.returnData({ data: undefined, error: DataSignError.UserDeclined });
  window.close();
};

const confirm = async () => {
  await controller.value.returnData({ data: signature.value, error: undefined });
  window.close();
};

const signAndReturnTx = async () => {
  loading.value = true;
  try {
    const address = request.value.data.address;
    const payload = request.value.data.payload;

    const res = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_DATA,
      data: {
        address,
        payload,
        password: spendingPassword.value,
        accountIndex: 0,
        isUsb: !isBT.value
      }
    }) as { data: { key: string; signature: string } };
    signature.value = res.data;
    if (txAutoSubmit.value) {
      await confirm();
    }
  } catch (e: any) {
    snackbar.setError(e);
  }
  loading.value = false;
};

const sign = async () => {
  if (!txAutoSubmit.value && signature.value) {
    await confirm();
    return;
  }
  if (loggedWallet.value.type === WalletType.Normal) {
    if (form.value.validate()) {
      const passwordVerification = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.VERIFY_SPENDING_PASSWORD,
        data: { password: spendingPassword.value }
      }) as BackgroundResponse<VerifyPasswordResponse>;

      if (!passwordVerification.data.success) {
        passwordField.value?.showError(t('wallet.wrongSpendingPassword'));
      } else {
        await signAndReturnTx();
      }
    }
  } else if (loggedWallet.value.type === WalletType.Ledger) {
    if (!request.value?.data) {
      snackbar.setError(t('wallet.transactionDataMissing'));
      return;
    }

    loading.value = true;
    const address = request.value.data.address;
    const payload = request.value.data.payload;
    try {
      // Create known addresses from wallet keys for Ledger signing
      const network = networks.resolveNetwork(loggedWallet.value.chain, loggedWallet.value.network);
      const knownAddresses = ledger.createKnownAddressesFromKeys(keys.value, network);

      const response: SignedMessageData = await ledger.signData(
        address,
        payload,
        network,
        0,
        !isBT.value,
        knownAddresses
      );
      signature.value = { signature: response.signatureHex, key: response.signingPublicKeyHex};
      if (txAutoSubmit.value) {
        await confirm();
      }
    } catch (e: any) {
      if (e instanceof DeviceStatusError) {
        const error: DeviceStatusError = e;
        switch (error.code) {
          case 0x5515:
          case 0x6E11:
            snackbar.setError(String(t('wallet.ledgerDeviceLocked')));
            break;
          default:
            snackbar.setError(String(t('wallet.ledgerDeviceError', { message: error.message })));
        }
      } else {
        snackbar.setError(e);
      }
    } finally {
      loading.value = false;
    }
  } else if (loggedWallet.value.type === WalletType.Trezor) {
    if (!request.value?.data) {
      snackbar.setError(t('wallet.transactionDataMissing'));
      return;
    }

    loading.value = true;
    const address = request.value.data.address;
    const payload = request.value.data.payload;
    try {
      const response = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.TREZOR,
        data: {
          method: 'signData',
          address,
          payload,
          accountIndex: 0
        }
      }) as BackgroundResponse<SignDataResponse>;

      if (!response?.data?.success) {
        throw new Error(response?.data?.error || t('wallet.trezorSigningFailed'));
      }

      signature.value = {
        signature: response.data.signatureData.signatureHex,
        key: response.data.signatureData.signingPublicKeyHex
      };

      if (txAutoSubmit.value) {
        await confirm();
      }
    } catch (e: any) {
      console.error('[TREZOR-SIGN-DATA] Error:', e);
      snackbar.setError(e.message || t('wallet.trezorSigningFailed'));
    } finally {
      loading.value = false;
    }
  } else if (loggedWallet.value.type === WalletType.Keystone) {
    if (!request.value?.data) {
      snackbar.setError(t('wallet.transactionDataMissing'));
      return;
    }

    try {
      const address = request.value.data.address;
      const payload = request.value.data.payload;

      let cardanoAddress: Cardano.Address;
      let addressBech32: string;
      if (address.startsWith('addr') || address.startsWith('stake')) {
        // Already in bech32 format
        addressBech32 = address;
      } else {
        // Hex format - convert to Address object and then to bech32
        const addressBytes = Buffer.from(address, 'hex');
        cardanoAddress = Cardano.Address.fromBytes(addressBytes);
        addressBech32 = cardanoAddress.toBech32();
      }

      // Find the derivation path for the signing address
      const foundKey: Key = keys.value.payment.find(k => k.address === addressBech32)
                    || keys.value.change.find(k => k.address === addressBech32)
                    || keys.value.stake.find(k => k.address === addressBech32);

      if (!foundKey || !foundKey.path) {
        throw new Error(t('wallet.addressNotFound'));
      }

      const xfp = loggedWallet.value.xfp ?? '';
      const xpubBech32 = loggedWallet.value.publicKey ?? '';

      if (!xpubBech32) {
        throw new Error(t('wallet.xpubNotFound'));
      }

      // Parse derivation path: m/1852'/1815'/0'/role/index
      const pathParts = foundKey.path.split('/');
      const role = parseInt(pathParts[4].replace("'", ""), 10);
      const keyIndex = parseInt(pathParts[5].replace("'", ""), 10);

      // Derive the appropriate key based on the role
      let derivedKey;
      if (role === 0) {
        derivedKey = getPaymentKeyExternal(xpubBech32, keyIndex);
      } else if (role === 1) {
        derivedKey = getPaymentKeyInternal(xpubBech32, keyIndex);
      } else if (role === 2) {
        derivedKey = getStakeKey(xpubBech32, keyIndex);
      } else {
        throw new Error(`Unknown derivation role: ${role}`);
      }

      const derivedKeyHex = derivedKey.hex();

      // Create Keystone CIP-8 data signing request
      const { ur, builder, addressBytes } = createKeystoneDataSignRequest(address, payload, xfp, derivedKeyHex, foundKey.path);

      // Store builder and addressBytes to reuse when parsing signature
      keystoneBuilder.value = builder;
      keystoneAddressBytes.value = addressBytes;

      // Extract type and cbor as plain strings
      keystoneType.value = ur.type;
      keystoneCbor.value = ur.cbor.toString('hex');

      // Show overlay with animated QR code
      keystoneOverlay.value = true;
      keystoneScan.value = false;
    } catch (e: any) {
      console.error('[KEYSTONE-SIGN-DATA] Error:', e);
      snackbar.setError(e.message || t('wallet.keystoneSigningFailed'));
    }
  } else {
    await signAndReturnTx();
  }
};

const onKeystoneScan = async (ur: UR) => {
  try {
    console.log('[Keystone] Received UR object:', ur);
    console.log('[Keystone] UR type:', ur?.type);
    console.log('[Keystone] UR cbor type:', typeof ur?.cbor);
    console.log('[Keystone] UR cbor:', ur?.cbor);

    // Parse the signature using stored builder and addressBytes
    if (!keystoneBuilder.value || !keystoneAddressBytes.value) {
      throw new Error('Missing builder or address bytes');
    }
    const signatureData = parseDataSignature(ur, keystoneBuilder.value, keystoneAddressBytes.value);

    // Clear references (builder is freed inside parseDataSignature)
    keystoneBuilder.value = null;
    keystoneAddressBytes.value = null;

    signature.value = {
      signature: signatureData.signature,
      key: signatureData.key
    };

    // Close overlay
    keystoneOverlay.value = false;
    keystoneScan.value = false;

    // Submit if txAutoSubmit is enabled
    if (txAutoSubmit.value) {
      await confirm();
    }
  } catch (error) {
    console.error('[Keystone] Error processing QR code:', error);
    snackbar.setError(error instanceof Error ? error.message : t('wallet.keystoneQRScanError'));
    keystoneOverlay.value = false;
    keystoneScan.value = false;
  }
};

const onKeystoneError = (error: string) => {
  console.error('[Keystone] Scanner error:', error);
  snackbar.setError(error || t('wallet.keystoneScanError'));
};

const onKeystoneProgress = (_progress: number) => {
  // Progress updates handled silently
};

const backKeystoneScan = () => {
  if (keystoneScan.value) {
    keystoneScan.value = false;
  } else {
    keystoneOverlay.value = false;
  }
};

const init = async () => {
  try {
    const requestData = await controller.value.requestData();
    if (requestData?.data?.payload) {
      message.value = Buffer.from(requestData.data.payload, 'hex').toString('utf-8');
    }
    request.value = requestData;
  } catch (e) {
    console.error('[DappSignData] Error initializing:', e);
  }
};

onMounted(async () => {
  if (useSidePanel.value) {
    const params = new URLSearchParams(window.location.href);
    tabId.value = Number(params.get("tabId"));
    controller.value = Messaging.createInternalSidePanelController(tabId.value);
  } else {
    controller.value = Messaging.createInternalController();
  }
  await init();

  // Set document title
  document.title = 'Gero Dashboard | Sign Data';
});
</script>
<style scoped>
.dapp-sign-details {
  font-size: 16px;
  font-weight: 500;
  text-align: left;
  line-height: 20px;
  word-wrap: break-word;
  white-space: pre-line;
  color: white !important;
}
</style>
