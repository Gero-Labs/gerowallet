<template>
  <v-form ref="form" v-model="valid" class="fill-height">
    <PopupHeader :title="t('navigation.signData')" :show-website="!(vmProxy.$route.query['website'] === 'undefined' || Object.keys(vmProxy.$route.query).length === 0)" :disabled="loading">
      <v-card-text class="d-flex flex-column align-content-space-between pa-0 fill-height">
        <EmbeddedSiteWarning class="mb-2" :embedded-in="request?.embeddedIn" />
        <v-card-title class="pa-0" style="color: white; font-size: 14px">
          The website requested a signature
        </v-card-title>
        <v-card flat variant="outlined" style="background-color: #141414!important;flex: 1 1 auto; overflow-y: auto; max-height: 100%; height: 0;" class="pa-2" height="157">
          <v-card flat class="overflow-y-auto transparent" height="143">
            <v-card-text class="dapp-sign-details pa-0">
              {{message}}
            </v-card-text>
          </v-card>
        </v-card>
      </v-card-text>
      <v-card-actions class="justify-center pb-0 pt-3 px-0">
        <div class="flex-grow-1">
          <v-row>
            <v-col cols="12" v-if="loggedWallet.type === WalletType.Normal && !isPrfWallet && !signature" class="pb-0">
              <PassKeyPasswordField
                ref="passwordField"
                :model-value="spendingPassword"
                @update:model-value="spendingPassword = $event"
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
                <ToggleSwitch :text-left="t('wallet.usb')" icon-left="mdi-usb" :text-right="t('wallet.bluetooth')" icon-right="mdi-bluetooth" :model-value="isBT" @update:model-value="isBT = $event" :disabled="loading" />
              </v-card-subtitle>
            </v-col>
            <v-col cols="12" v-else-if="loggedWallet.type === WalletType.Trezor" class="pt-3 pb-0">
              <v-alert type="info" color="primary" variant="text" border="start" density="compact" class="py-1 my-0" style="line-height: 1.2">
                <span style="color: white; font-size: 12px">
                  {{ $t('wallet.confirmOnTrezor') }}
                </span>
              </v-alert>
            </v-col>
            <v-col cols="12" v-else-if="loggedWallet.type === WalletType.Keystone" class="pt-3 pb-0">
              <v-alert type="info" color="primary" variant="text" border="start" density="compact" class="py-1 my-0" style="line-height: 1.2">
                <span style="color: white; font-size: 12px">
                  {{ $t('wallet.scanQRWithKeystone') }}
                </span>
              </v-alert>
            </v-col>
            <v-col :cols="isPrfWallet ? 12 : 6">
              <v-btn block variant="outlined" color="error" style="text-transform: capitalize;" @click="decline">
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
        </div>
      </v-card-actions>

      <!-- Keystone QR Code Overlay -->
      <v-overlay

        opacity="0.99"
        :model-value="keystoneOverlay"
        persistent
        contained
        class="hardwareOverlay align-center justify-center"
      >
        <v-alert
          color="white"
          density="compact"
          variant="outlined"
          type="info"
          border="start"
          v-if="!keystoneScan"
          class="mt-2 mb-2"
          prominent
        >
          <b style="font-size: 12px;">{{ $t('wallet.instructions') }}</b>
          <ul class="text-left" style="line-height: 1.3; font-size: 11px; margin-top: 4px; padding-left: 10px;">
            <li>{{ $t('wallet.unlockKeystone') }}</li>
            <li>{{ $t('wallet.selectScanQR') }} <v-icon size="x-small">mdi-line-scan</v-icon></li>
            <li>{{ $t('wallet.useKeystoneToScan') }}</li>
            <li>{{ $t('wallet.approveAndScanNext') }}</li>
          </ul>
        </v-alert>
        <v-alert
          color="white"
          density="compact"
          variant="outlined"
          type="info"
          border="start"
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
          <v-btn variant="text" size="small" @click="backKeystoneScan" class="mr-2">
            {{ keystoneScan ? $t('common.back') : $t('common.cancel') }}
          </v-btn>
          <v-btn
            v-if="!keystoneScan"
            size="small"
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
import { useApprovalFreshness, awaitFreshApproval, StaleApprovalError } from "@/shared/composables/useApprovalFreshness";
import { validateCip45Signing } from '@/services/cip45/signingAuthorization';
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, getCurrentInstance, onMounted, ref, toRefs } from 'vue';
import rules from '@/utils/rules';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import EmbeddedSiteWarning from '@/shared/components/EmbeddedSiteWarning.vue';
import { BackgroundResponse, Messaging, SignDataResponse, VerifyPasswordResponse } from '@/chrome/messaging';
import { DataSignError } from '@/chrome/config';
import { Key, WalletType } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import hardwareLoading from '@/plugins/hardwareLoading';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import AnimatedQRCode from '@/shared/components/AnimatedQRCode.vue';
import AnimatedQRScanner from '@/shared/components/AnimatedQRScanner.vue';
import { walletStore } from '@/stores/walletStore';
import { MessageTypes } from '@/models/MessageTypes';
import ledger from '@/shared/utils/ledger';
import { dispatchTrezor } from '@/shared/utils/trezorDispatch';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { createKeystoneDataSignRequest, parseDataSignature } from '@/shared/utils/keystone';
import { accountIndexFromKeys, deriveSigningAccountKey, resolveAccountIndex, secretsWalletId } from '@/shared/utils/walletAccount';
import networks from '@/utils/networks';
import { DeviceStatusError, SignedMessageData } from '@cardano-foundation/ledgerjs-hw-app-cardano';
import { Cardano } from '@cardano-sdk/core';
import { getPaymentKeyExternal, getPaymentKeyInternal, getStakeKey } from '@/chrome/serialization';
import { UR } from '@keystonehq/keystone-sdk';
import { Bip32PrivateKey, Ed25519PublicKey } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';

const { t } = useTranslation();

const { loggedWallet, config, keys } = toRefs(walletStore);
const vmProxy = getCurrentInstance()!.proxy;
const spendingPassword = ref('');
const privateKeyBytes = ref<Uint8Array | null>(null);
const passwordField = ref(null);
const request = ref(null);
const message = ref('');
// Vuetify 4 writes the form model only once an input registers. Hardware wallets
// render none, so start from the empty-form result instead of a disabled Sign.
const valid = ref(true);
const isBT = ref(false);
const loading = ref(false);
const controller = ref(null);
const signature = ref<{ signature: string; key: HexBlob }>(undefined);
const form = ref(null);
// Keystone state
const keystoneOverlay = ref(false);
const keystoneScan = ref(false);
const keystoneType = ref('');
const keystoneCbor = ref('');
let keystoneRequestId = '';
let keystoneApprovalCurrent: (() => boolean) | null = null;
let keystoneBuilder: ReturnType<typeof createKeystoneDataSignRequest>['builder'] | null = null; // Store builder to reuse when parsing signature
const keystoneAddressBytes = ref<Uint8Array | null>(null); // Store address bytes for COSE_Key

const txAutoSubmit = computed(() => {
  return config.value?.txAutoSubmit;
});

// Check if wallet uses PRF encryption (PassKey)
const isPrfWallet = computed(() => {
  return loggedWallet.value?.encryptionMethod === 'prf' ||
    (!!loggedWallet.value?.prfEncryptedPrivateKey && !!loggedWallet.value?.webAuthnCredentialId);
});


const approval = useApprovalFreshness(
  () => [request.value, loggedWallet.value?.id, loggedWallet.value?.chain, loggedWallet.value?.network, loggedWallet.value?.webAuthnCredentialId, loggedWallet.value?.encryptionMethod],
  () => !!request.value && !!loggedWallet.value && !walletStore.isLocked,
  () => { privateKeyBytes.value?.fill(0); privateKeyBytes.value = null; keystoneApprovalCurrent = null; keystoneOverlay.value = false; keystoneScan.value = false; keystoneCbor.value = ''; signature.value = undefined; },
);
const handlePassKeyAuthSuccess = (pkBytes: Uint8Array) => {
  const approvalCurrent = approval.capture();
  privateKeyBytes.value = pkBytes;
  // Automatically proceed to sign after successful authentication
  setTimeout(() => {
    if (!approvalCurrent()) return;
    sign();
  }, 300);
};

const handlePassKeyAuthError = (error: Error) => {
  console.error('PassKey authentication error:', error);
  snackbar.setError(error.message || t('security.passKeyAuthFailed'));
  privateKeyBytes.value = null;
};

const decline = async () => {
  approval.invalidate();
  await controller.value.returnData({ data: undefined, error: DataSignError.UserDeclined });
  window.close();
};

const confirm = async () => {
  const approvalCurrent = approval.capture();
  if (!approvalCurrent()) return;
  try {
    await awaitFreshApproval(async () => (validateCip45Signing(request.value?.data)), approvalCurrent);
  } catch (error) {
    if (error instanceof StaleApprovalError) return;
    await decline();
    return;
  }
  await awaitFreshApproval(async () => (controller.value.returnData({ data: signature.value, error: undefined })), approvalCurrent);
  window.close();
};

const signDataLocallyWithPrf = async () => {
  const approvalCurrent = approval.capture();
  if (!approvalCurrent()) return;
  loading.value = true;
  try {
    await awaitFreshApproval(async () => (validateCip45Signing(request.value?.data)), approvalCurrent);
    const address = request.value.data.address;
    const payload = request.value.data.payload;

    // Import required modules
    const { buildSignatureAndCoseKey } = await awaitFreshApproval(async () => (import('@/shared/utils/converter')), approvalCurrent);

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

      pkBytes = await awaitFreshApproval(async () => (new Promise<Uint8Array>((resolve, reject) => {
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
      })), approvalCurrent);
    } else {
      // Direct WebAuthn in popup window (WebAuthn works in popups)
      const { decryptPrivateKeyWithPrf } = await awaitFreshApproval(async () => (import('@/shared/utils/webauthn-prf')), approvalCurrent);
      pkBytes = await awaitFreshApproval(async () => (decryptPrivateKeyWithPrf(
        loggedWallet.value.prfEncryptedPrivateKey,
        loggedWallet.value.webAuthnCredentialId,
        secretsWalletId(loggedWallet.value).toString()
      )), approvalCurrent);
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
    const role = parseInt(pathParts[4].replace(/'/g, ""), 10);
    const index = parseInt(pathParts[5].replace(/'/g, ""), 10);

    const accountKey = deriveSigningAccountKey(rootKey, resolveAccountIndex(loggedWallet.value), loggedWallet.value.publicKey);
    const derived = accountKey.derive([role, index]);
    const signingKey = derived.toRawKey();

    // Step 4: Get address bytes for COSE_Key. Address.toBytes() returns a
    // HexBlob (hex STRING) — decode to real bytes, else the emurgo WASM coerces
    // the string per-character and embeds a garbage address (verify 401).
    let addressBytes: Uint8Array;
    if (address.startsWith('addr') || address.startsWith('stake')) {
      addressBytes = Buffer.from(Cardano.Address.fromBech32(address).toBytes(), 'hex');
    } else {
      addressBytes = Buffer.from(address, 'hex');
    }

    // Step 5: Sign with proper COSE format
    await awaitFreshApproval(async () => (validateCip45Signing(request.value?.data)), approvalCurrent);
    signature.value = buildSignatureAndCoseKey(addressBytes, payload, signingKey);

    if (txAutoSubmit.value) {
      await awaitFreshApproval(async () => (confirm()), approvalCurrent);
    }
  } catch (e: unknown) {
    if (e instanceof StaleApprovalError) return;
    console.error('[PRF Sign Data] Error:', e);
    snackbar.setError(e['message'] || 'Failed to sign data with PassKey');
  } finally {
    loading.value = false;
  }
};

const signAndReturnTx = async () => {
  const approvalCurrent = approval.capture();
  if (!approvalCurrent()) return;
  // PRF wallets: Sign locally in browser context (WebAuthn only works here)
  if (isPrfWallet.value) {
    await awaitFreshApproval(async () => (signDataLocallyWithPrf()), approvalCurrent);
    return;
  }

  // Normal wallets: Send to background for signing
  loading.value = true;
  try {
    await awaitFreshApproval(async () => (validateCip45Signing(request.value?.data)), approvalCurrent);
    const address = request.value.data.address;
    const payload = request.value.data.payload;

    const res = await awaitFreshApproval(async () => (Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_DATA,
      data: {
        cip45Authorization: request.value?.data?.cip45Authorization,
        address,
        payload,
        password: spendingPassword.value,
        isUsb: !isBT.value
      }
    })), approvalCurrent) as { data: { key: string; signature: string } };
    signature.value = res.data;
    if (txAutoSubmit.value) {
      await awaitFreshApproval(async () => (confirm()), approvalCurrent);
    }
  } catch (e: unknown) {
    if (e instanceof StaleApprovalError) { loading.value = false; return; }
    console.error('[SIGN-DATA] Error:', e);
    const errorMessage = e instanceof Error ? e.message : String(e);
    snackbar.setError(errorMessage);
  }
  loading.value = false;
};

const sign = () => approval.run(async () => {
  const approvalCurrent = approval.capture();
  if (!approvalCurrent()) return;
  if (!txAutoSubmit.value && signature.value) {
    await awaitFreshApproval(async () => (confirm()), approvalCurrent);
    return;
  }
  if (loggedWallet.value.type === WalletType.Normal) {
    // PRF wallets: Skip password verification, go directly to signing (will trigger PassKey in background)
    if (isPrfWallet.value) {
      await awaitFreshApproval(async () => (signAndReturnTx()), approvalCurrent);
    } else {
      // Normal password-based wallets: Verify password first
      if ((await awaitFreshApproval(async () => (form.value.validate()), approvalCurrent)).valid) {
        const passwordVerification = await awaitFreshApproval(async () => (Messaging.sendToBackgroundFromOptions({
          method: MessageTypes.VERIFY_SPENDING_PASSWORD,
          data: { password: spendingPassword.value }
        })), approvalCurrent) as BackgroundResponse<VerifyPasswordResponse>;

        if (!passwordVerification.data.success) {
          passwordField.value?.showError(t('errors.wrongPassword'));
        } else {
          await awaitFreshApproval(async () => (signAndReturnTx()), approvalCurrent);
        }
      }
    }
  } else if (loggedWallet.value.type === WalletType.Ledger) {
    if (!request.value?.data) {
      snackbar.setError(t('wallet.transactionDataMissing'));
      return;
    }

    loading.value = true;
    // The device holds the message on its own screen; without this the view
    // shows only a spinner that cannot resolve until the user acts on it.
    hardwareLoading.begin('Ledger', t('wallet.ledgerPleaseConfirmDevice') as string);
    const address = request.value.data.address;
    const payload = request.value.data.payload;
    try {
      await awaitFreshApproval(async () => (validateCip45Signing(request.value?.data)), approvalCurrent);
      // Create known addresses from wallet keys for Ledger signing
      const network = networks.resolveNetwork(loggedWallet.value.chain, loggedWallet.value.network);
      const knownAddresses = ledger.createKnownAddressesFromKeys(keys.value, network);

      const response: SignedMessageData = await awaitFreshApproval(async () => (ledger.signData(
        address,
        payload,
        network,
        accountIndexFromKeys(keys.value),
        !isBT.value,
        knownAddresses
      )), approvalCurrent);
      signature.value = { signature: response.signatureHex, key: response.signingPublicKeyHex};
      // Device work is done — drop the prompt before the submit below, which is
      // not something the user does anything about on the device.
      hardwareLoading.end();
      if (txAutoSubmit.value) {
        await awaitFreshApproval(async () => (confirm()), approvalCurrent);
      }
    } catch (e: unknown) {
    if (e instanceof StaleApprovalError) return;
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
      hardwareLoading.end();
    }
  } else if (loggedWallet.value.type === WalletType.Trezor) {
    if (!request.value?.data) {
      snackbar.setError(t('wallet.transactionDataMissing'));
      return;
    }

    loading.value = true;
    // Trezor reports no intermediate stages, so this one label covers the whole
    // call — connecting through the confirmation it is waiting on.
    hardwareLoading.begin('Trezor', t('wallet.confirmOnTrezor') as string);
    const address = request.value.data.address;
    const payload = request.value.data.payload;
    try {
      await awaitFreshApproval(async () => (validateCip45Signing(request.value?.data)), approvalCurrent);
      const data = {
        method: 'signData',
        cip45Authorization: request.value?.data?.cip45Authorization,
        address,
        payload,
      };
      const response = (featureFlagsStore.state.flags.isTrezorWebUsbEnabled
        ? await awaitFreshApproval(async () => (dispatchTrezor(data)), approvalCurrent)
        : await awaitFreshApproval(async () => (Messaging.sendToBackgroundFromOptions({
          method: MessageTypes.TREZOR,
          data
        })), approvalCurrent)) as BackgroundResponse<SignDataResponse>;

      if (!response?.data?.success) {
        throw new Error(response?.data?.error || t('wallet.trezorSigningFailed'));
      }

      signature.value = {
        signature: response.data.signatureData.signatureHex,
        key: response.data.signatureData.signingPublicKeyHex
      };

      // Device work is done — drop the prompt before the submit below, which is
      // not something the user does anything about on the device.
      hardwareLoading.end();

      if (txAutoSubmit.value) {
        await awaitFreshApproval(async () => (confirm()), approvalCurrent);
      }
    } catch (e: unknown) {
    if (e instanceof StaleApprovalError) return;
      console.error('[TREZOR-SIGN-DATA] Error:', e);
      const errorMessage = e instanceof Error ? e.message : t('wallet.trezorSigningFailed');
      snackbar.setError(errorMessage);
    } finally {
      loading.value = false;
      hardwareLoading.end();
    }
  } else if (loggedWallet.value.type === WalletType.Keystone) {
    if (!request.value?.data) {
      snackbar.setError(t('wallet.transactionDataMissing'));
      return;
    }

    try {

      await awaitFreshApproval(async () => (validateCip45Signing(request.value?.data)), approvalCurrent);
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
      const role = parseInt(pathParts[4].replace(/'/g, ""), 10);
      const keyIndex = parseInt(pathParts[5].replace(/'/g, ""), 10);

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
      const { ur, builder, addressBytes, requestId } = createKeystoneDataSignRequest(address, payload, xfp, derivedKeyHex, foundKey.path);
      keystoneRequestId = requestId;

      // Store builder and addressBytes to reuse when parsing signature
      keystoneBuilder = builder;
      keystoneAddressBytes.value = addressBytes;

      // Extract type and cbor as plain strings
      keystoneType.value = ur.type;
      keystoneCbor.value = ur.cbor.toString('hex');

      // Show overlay with animated QR code
      keystoneApprovalCurrent = approvalCurrent;
    keystoneOverlay.value = true;
      keystoneScan.value = false;
    } catch (e: unknown) {
    if (e instanceof StaleApprovalError) return;
      console.error('[KEYSTONE-SIGN-DATA] Error:', e);
      const errorMessage = e instanceof Error ? e.message : t('wallet.keystoneSigningFailed');
      snackbar.setError(errorMessage);
    }
  } else {
    await awaitFreshApproval(async () => (signAndReturnTx()), approvalCurrent);
  }
});

const onKeystoneScan = (ur: UR) => approval.run(async () => {
  const approvalCurrent = keystoneApprovalCurrent;
  if (!approvalCurrent?.() || !keystoneOverlay.value) return;
  keystoneApprovalCurrent = null;
  try {
    await awaitFreshApproval(async () => (validateCip45Signing(request.value?.data)), approvalCurrent);
    console.log('[Keystone] UR type:', ur?.type);
    console.log('[Keystone] UR cbor type:', typeof ur?.cbor);

    // Parse the signature using stored builder and addressBytes
    if (!keystoneBuilder || !keystoneAddressBytes.value) {
      throw new Error('Missing builder or address bytes');
    }
    const signatureData = parseDataSignature(ur, keystoneBuilder, keystoneAddressBytes.value, keystoneRequestId);

    // Clear references (builder is freed inside parseDataSignature)
    keystoneBuilder = null;
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
      await awaitFreshApproval(async () => (confirm()), approvalCurrent);
    }
  } catch (error) {
    if (error instanceof StaleApprovalError) return;
    console.error('[Keystone] Error processing QR code:', error);
    snackbar.setError(error instanceof Error ? error.message : t('wallet.keystoneQRScanError'));
    keystoneOverlay.value = false;
    keystoneScan.value = false;
  }
});

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
    approval.invalidate();
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
  // This view is only ever opened inside a standalone popup window (see
  // openSidePanelForSignData's popup fallback in background.ts, which always
  // targets index.html) — never inside the side panel, which renders
  // DAppOverlay.vue instead. It must always speak the popup port protocol.
  // It used to branch on the now-retired Prompt Display Mode setting
  // instead, which connected the wrong port name and hung forever whenever
  // this fallback view was reached.
  controller.value = Messaging.createInternalController();
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
