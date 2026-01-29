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
            <v-col cols="12" v-if="loggedWallet.type === WalletType.Normal && !isPrfWallet && !signature" class="pb-0">
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
            <!-- PRF Wallet: PassKey Button or Submit Button -->
            <v-col cols="12" v-else-if="loggedWallet.type === WalletType.Normal && isPrfWallet" class="pt-3 pb-0">
              <!-- Before signing: PassKey button -->
              <PassKeyAuthButton
                v-if="!signature"
                :disabled="loading"
                @success="handlePassKeyAuthSuccess"
                @error="handlePassKeyAuthError"
                block
                class="mb-2"
              />
              <!-- After signing: Submit button -->
              <v-btn
                v-else
                block
                class="geroButton"
                style="color: black!important;"
                @click="sign"
                :disabled="loading"
                :loading="loading"
              >
                {{ $t('common.confirm') }}
              </v-btn>
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
            <v-col :cols="isPrfWallet ? 12 : 6">
              <v-btn block outlined color="red" style="text-transform: capitalize;" @click="decline" :disabled="loading">
                Decline
              </v-btn>
            </v-col>
            <!-- Hide action button for PRF wallets (handled above) -->
            <v-col cols="6" v-if="!isPrfWallet">
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
import { computed, getCurrentInstance, onMounted, ref, toRefs } from 'vue';
import rules from '@/utils/rules';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import { BackgroundResponse, Messaging, SignDataResponse, VerifyPasswordResponse } from '@/chrome/messaging';
import { DataSignError } from '@/chrome/config';
import { Key, WalletType } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import AnimatedQRCode from '@/shared/components/AnimatedQRCode.vue';
import AnimatedQRScanner from '@/shared/components/AnimatedQRScanner.vue';
import { walletStore } from '@/stores/walletStore';
import { MessageTypes } from '@/models/MessageTypes';
import ledger from '@/shared/utils/ledger';
import { createKeystoneDataSignRequest, parseDataSignature } from '@/shared/utils/keystone';
import networks from '@/utils/networks';
import { DeviceStatusError, SignedMessageData } from '@cardano-foundation/ledgerjs-hw-app-cardano';
import { Cardano } from '@cardano-sdk/core';
import { getPaymentKeyExternal, getPaymentKeyInternal, getStakeKey } from '@/chrome/serialization';
import { UR } from '@keystonehq/keystone-sdk';
import { Bip32PrivateKey, Ed25519PublicKey } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util/dist/esm';

const { t } = useTranslation();

const { loggedWallet, config, keys } = toRefs(walletStore);
const vmProxy = getCurrentInstance()!.proxy;
const spendingPassword = ref('');
const privateKeyBytes = ref<Uint8Array | null>(null);
const passwordField = ref(null);
const request = ref(null);
const message = ref('');
const valid = ref(false);
const isBT = ref(false);
const loading = ref(false);
const controller = ref(null);
const tabId = ref<number | null>(null);
const signature = ref<{ signature: string; key: HexBlob }>(undefined);
const form = ref(null);
// Keystone state
const keystoneOverlay = ref(false);
const keystoneScan = ref(false);
const keystoneType = ref('');
const keystoneCbor = ref('');
const keystoneBuilder = ref(null); // Store builder to reuse when parsing signature
const keystoneAddressBytes = ref<Uint8Array | null>(null); // Store address bytes for COSE_Key

const txAutoSubmit = computed(() => {
  return config.value?.txAutoSubmit;
});

const useSidePanel = computed(() => {
  return config.value?.useSidePanel;
});

// Check if wallet uses PRF encryption (PassKey)
const isPrfWallet = computed(() => {
  return loggedWallet.value?.encryptionMethod === 'prf' ||
         (!!loggedWallet.value?.prfEncryptedPrivateKey && !!loggedWallet.value?.webAuthnCredentialId);
});

const handlePassKeyAuthSuccess = (pkBytes: Uint8Array) => {
  privateKeyBytes.value = pkBytes;
  // Automatically proceed to sign after successful authentication
  setTimeout(() => {
    sign();
  }, 300);
};

const handlePassKeyAuthError = (error: Error) => {
  console.error('PassKey authentication error:', error);
  snackbar.setError(error.message || t('security.passKeyAuthFailed'));
  privateKeyBytes.value = null;
};

const decline = async () => {
  await controller.value.returnData({ data: undefined, error: DataSignError.UserDeclined });
  window.close();
};

const confirm = async () => {
  await controller.value.returnData({ data: signature.value, error: undefined });
  window.close();
};

const signDataLocallyWithPrf = async () => {
  loading.value = true;
  try {
    const address = request.value.data.address;
    const payload = request.value.data.payload;

    // Import required modules
    const { buildSignatureAndCoseKey } = await import('@/shared/utils/converter');

    // Check if we're in a side panel (not a popup window)
    const isSidePanel = window.location.href.includes('tabId=');

    let pkBytes: Uint8Array;

    // Use cached privateKeyBytes if available (from PassKeyAuthButton)
    if (privateKeyBytes.value) {
      console.log('[PRF Sign Data] Using cached private key bytes');
      pkBytes = privateKeyBytes.value;
    } else if (isSidePanel) {
      // Open PassKeyAuth popup for WebAuthn (doesn't work in side panels)
      console.log('[PRF Sign Data] Opening PassKeyAuth popup for side panel');

      pkBytes = await new Promise<Uint8Array>((resolve, reject) => {
        const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;

        // Listen for postMessage from popup
        const messageHandler = (event: MessageEvent) => {
          // Verify origin
          if (event.origin !== extensionOrigin) {
            console.warn('[PRF Sign Data] Ignoring message from untrusted origin:', event.origin);
            return;
          }

          if (event.data.type === 'PASSKEY_AUTH_RESULT') {
            window.removeEventListener('message', messageHandler);

            if (event.data.payload.success) {
              // Convert array back to Uint8Array
              const bytes = new Uint8Array(event.data.payload.privateKeyBytes);
              resolve(bytes);
            } else if (event.data.payload.cancelled) {
              reject(new Error('PassKey authentication cancelled'));
            } else {
              reject(new Error(event.data.payload.error || 'PassKey authentication failed'));
            }
          }
        };

        window.addEventListener('message', messageHandler);

        // Open PassKeyAuth popup
        // Query params must come BEFORE the hash in Vue Router hash mode
        const popupUrl = chrome.runtime.getURL('index.html?mode=privateKey#/passkey-auth');
        const popup = window.open(popupUrl, 'PassKeyAuth', 'width=400,height=500,popup=1');

        if (!popup) {
          window.removeEventListener('message', messageHandler);
          reject(new Error('Failed to open PassKey authentication popup. Please allow popups.'));
        }

        // Timeout after 60 seconds
        setTimeout(() => {
          window.removeEventListener('message', messageHandler);
          if (popup && !popup.closed) {
            popup.close();
          }
          reject(new Error('PassKey authentication timed out'));
        }, 60000);
      });
    } else {
      // Direct WebAuthn in popup window (WebAuthn works in popups)
      const { decryptPrivateKeyWithPrf } = await import('@/shared/utils/webauthn-prf');
      pkBytes = await decryptPrivateKeyWithPrf(
        loggedWallet.value.prfEncryptedPrivateKey,
        loggedWallet.value.webAuthnCredentialId,
        loggedWallet.value.id.toString()
      );
    }

    // Continue with signing using the decrypted private key
    const rootKey = Bip32PrivateKey.fromBytes(pkBytes);

    // Step 2: Find the signing key
    // Normalize address format
    let addressBech32: string;
    if (address.startsWith('addr') || address.startsWith('stake')) {
      addressBech32 = address;
    } else {
      const addressBytes = Buffer.from(address, 'hex');
      addressBech32 = Cardano.Address.fromBytes(addressBytes).toBech32();
    }

    // Find the key in wallet
    const allKeys = [...keys.value.payment, ...keys.value.change, ...keys.value.stake];
    const foundKey = allKeys.find(k => k.address === addressBech32);

    if (!foundKey || !foundKey.path) {
      throw new Error(`Address not found in wallet keys: ${addressBech32}`);
    }

    // Step 3: Derive the signing key
    const pathParts = foundKey.path.split('/');
    const role = parseInt(pathParts[4].replace("'", ""), 10);
    const index = parseInt(pathParts[5].replace("'", ""), 10);

    const accountKey = rootKey.derive([2147485500, 2147485463, 2147483648]); // m/1852'/1815'/0'
    const derived = accountKey.derive([role, index]);
    const signingKey = derived.toRawKey();

    // Step 4: Get address bytes for COSE_Key
    let addressBytes: Uint8Array;
    if (address.startsWith('addr') || address.startsWith('stake')) {
      addressBytes = Cardano.Address.fromBech32(address).toBytes();
    } else {
      addressBytes = Buffer.from(address, 'hex');
    }

    // Step 5: Sign with proper COSE format
    signature.value = buildSignatureAndCoseKey(addressBytes, payload, signingKey);

    if (txAutoSubmit.value) {
      await confirm();
    }
  } catch (e: unknown) {
    console.error('[PRF Sign Data] Error:', e);
    snackbar.setError(e['message'] || 'Failed to sign data with PassKey');
  } finally {
    loading.value = false;
  }
};

const signAndReturnTx = async () => {
  // PRF wallets: Sign locally in browser context (WebAuthn only works here)
  if (isPrfWallet.value) {
    await signDataLocallyWithPrf();
    return;
  }

  // Normal wallets: Send to background for signing
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
  } catch (e: unknown) {
    console.error('[SIGN-DATA] Error:', e);
    const errorMessage = e instanceof Error ? e.message : String(e);
    snackbar.setError(errorMessage);
  }
  loading.value = false;
};

const sign = async () => {
  if (!txAutoSubmit.value && signature.value) {
    await confirm();
    return;
  }
  if (loggedWallet.value.type === WalletType.Normal) {
    // PRF wallets: Skip password verification, go directly to signing (will trigger PassKey in background)
    if (isPrfWallet.value) {
      await signAndReturnTx();
    } else {
      // Normal password-based wallets: Verify password first
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
    } catch (e: unknown) {
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
        const errorMessage = e instanceof Error ? e.message : t('wallet.ledgerDeviceError', { message: String(e) });
        snackbar.setError(errorMessage);
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
    } catch (e: unknown) {
      console.error('[TREZOR-SIGN-DATA] Error:', e);
      const errorMessage = e instanceof Error ? e.message : t('wallet.trezorSigningFailed');
      snackbar.setError(errorMessage);
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
      let derivedKey: Ed25519PublicKey;
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
    } catch (e: unknown) {
      console.error('[KEYSTONE-SIGN-DATA] Error:', e);
      const errorMessage = e instanceof Error ? e.message : t('wallet.keystoneSigningFailed');
      snackbar.setError(errorMessage);
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
