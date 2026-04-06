<template>
  <BottomSheet
    :value="isVisible"
    :persistent="true"
    :show-handle="false"
    :height="currentRequest?.method === 'enable' ? '70%' : '85%'"
    :draggable="false"
  >
    <div v-if="currentRequest" class="dapp-overlay">
      <!-- Queue indicator -->
      <div v-if="requestQueue.length > 0" class="queue-indicator mb-2">
        <span class="grey--text text-caption">
          {{ $t('miniGero.requestQueueIndicator', { current: 1, total: requestQueue.length + 1 }) }}
        </span>
      </div>

      <!-- DApp Connect -->
      <div v-if="currentRequest.method === 'enable'" class="dapp-connect">
        <!-- Favicon + domain -->
        <div class="dapp-identity mb-4">
          <div class="favicon-wrapper">
            <img
              :src="faviconUrl"
              class="favicon-img"
              @error="faviconFailed = true"
              v-if="!faviconFailed"
            />
            <v-icon v-else size="32" color="#00c7f3">mdi-web</v-icon>
          </div>
          <div class="dapp-domain-info">
            <h3 class="white--text text-subtitle-1 font-weight-bold mb-0">{{ $t('miniGero.connectRequest') }}</h3>
            <span class="dapp-url grey--text text-caption">{{ enableDomain }}</span>
          </div>
        </div>

        <!-- URL warning -->
        <div class="url-warning mb-3">
          <v-icon size="14" color="#FFA726" class="mr-1">mdi-alert-outline</v-icon>
          <span class="text-caption" style="color: #FFA726;">{{ $t('navigation.confirmUrlBeforeGranting') }}</span>
        </div>

        <!-- Permissions -->
        <div class="permissions-section mb-3">
          <p class="white--text text-body-2 font-weight-medium mb-2">{{ $t('navigation.allowTheSiteTo') }}</p>
          <v-checkbox
            v-model="enableConsent"
            color="#00DFF3"
            hide-details
            dark
            dense
            class="consent-checkbox mt-0"
            :label="$t('navigation.viewAddressAndBalance')"
          />
        </div>

        <!-- Security note -->
        <div class="security-note mb-4">
          <v-icon size="14" color="rgba(255,255,255,0.4)" class="mr-1 flex-shrink-0" style="margin-top: 2px;">mdi-shield-check-outline</v-icon>
          <span class="grey--text text-caption">
            {{ $t('miniGero.futureTransactionsNote') }}
          </span>
        </div>

        <div class="action-buttons">
          <v-btn outlined rounded dark @click="reject()">{{ $t('miniGero.reject') }}</v-btn>
          <v-btn class="geroButton" rounded depressed :disabled="!enableConsent" @click="approve(true)">
            {{ $t('miniGero.approve') }}
          </v-btn>
        </div>
      </div>

      <!-- Sign Transaction -->
      <div v-else-if="currentRequest.method === 'signTx'" class="dapp-sign-tx">
        <v-icon size="48" color="#FFF59E" class="mb-3">mdi-file-document-edit-outline</v-icon>
        <h3 class="white--text text-h6 mb-1">{{ $t('miniGero.signTxRequest') }}</h3>
        <p class="grey--text text-body-2 mb-4">{{ currentRequest.payload?.website }}</p>

        <!-- Normal wallet: password input -->
        <template v-if="walletType === WalletType.Normal || walletType === WalletType.Google">
          <template v-if="!isPrfWallet">
            <v-text-field
              v-model="spendingPassword"
              :type="showPassword ? 'text' : 'password'"
              :label="$t('miniGero.spendingPassword')"
              :append-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
              :error-messages="signError"
              outlined dense dark
              class="password-input"
              @click:append="showPassword = !showPassword"
              @keyup.enter="signNormal"
            />
            <div class="action-buttons">
              <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
              <v-btn class="geroButton" rounded depressed :loading="signing" :disabled="!spendingPassword" @click="signNormal">
                {{ $t('miniGero.sign') }}
              </v-btn>
            </div>
          </template>

          <!-- PRF wallet: PassKey authentication -->
          <template v-else>
            <p class="grey--text text-body-2 text-center mb-2">{{ $t('miniGero.passKeyRequired') }}</p>
            <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
            <div class="action-buttons">
              <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
              <v-btn class="geroButton" rounded depressed :loading="signing" @click="signPrf">
                {{ $t('miniGero.sign') }}
              </v-btn>
            </div>
          </template>
        </template>

        <!-- Ledger wallet -->
        <template v-else-if="walletType === WalletType.Ledger">
          <div class="hw-notice pa-3 mb-3">
            <v-icon color="#00c7f3" class="mb-2">mdi-usb</v-icon>
            <p class="white--text text-body-2 text-center">{{ $t('miniGero.connectLedger') }}</p>
          </div>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" @click="signLedger">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <!-- Trezor wallet -->
        <template v-else-if="walletType === WalletType.Trezor">
          <div class="hw-notice pa-3 mb-3">
            <v-icon color="#00c7f3" class="mb-2">mdi-usb</v-icon>
            <p class="white--text text-body-2 text-center">{{ $t('miniGero.connectTrezor') }}</p>
          </div>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" @click="signTrezor">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <!-- Keystone wallet -->
        <template v-else-if="walletType === WalletType.Keystone">
          <div class="hw-notice pa-3 mb-3">
            <v-icon color="#00c7f3" class="mb-2">mdi-qrcode-scan</v-icon>
            <p class="white--text text-body-2 text-center">{{ $t('miniGero.keystoneSign') }}</p>
          </div>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" @click="signKeystone">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>
      </div>

      <!-- Sign Data -->
      <div v-else-if="currentRequest.method === 'signData'" class="dapp-sign-data">
        <!-- Favicon + domain (same style as connect) -->
        <div class="dapp-identity mb-4">
          <div class="favicon-wrapper">
            <img
              :src="faviconUrl"
              class="favicon-img"
              @error="faviconFailed = true"
              v-if="!faviconFailed"
            />
            <v-icon v-else size="32" color="#FDA29B">mdi-file-sign</v-icon>
          </div>
          <div class="dapp-domain-info">
            <h3 class="white--text text-subtitle-1 font-weight-bold mb-0">{{ $t('miniGero.signDataRequest') }}</h3>
            <span class="dapp-url grey--text text-caption">{{ signDataDomain }}</span>
          </div>
        </div>

        <!-- Message content -->
        <p class="white--text text-body-2 font-weight-medium mb-2">{{ $t('navigation.signData') }}</p>
        <div class="sign-data-message">
          <p class="white--text text-caption" style="word-break: break-all;">
            {{ signDataMessage }}
          </p>
        </div>

        <!-- Normal wallet: password input -->
        <template v-if="(walletType === WalletType.Normal || walletType === WalletType.Google) && !isPrfWallet">
          <v-text-field
            v-model="spendingPassword"
            :type="showPassword ? 'text' : 'password'"
            :label="$t('miniGero.spendingPassword')"
            :append-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
            :error-messages="signError"
            outlined dense dark
            class="password-input"
            @click:append="showPassword = !showPassword"
            @keyup.enter="signDataNormal"
          />
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" :disabled="!spendingPassword" @click="signDataNormal">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <!-- PRF wallet: PassKey authentication -->
        <template v-else-if="isPrfWallet">
          <p class="grey--text text-body-2 text-center mb-2 mt-3">{{ $t('miniGero.passKeyRequired') }}</p>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" @click="signDataPrf">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <!-- Ledger wallet -->
        <template v-else-if="walletType === WalletType.Ledger">
          <div class="hw-notice pa-3 mb-3 mt-3">
            <v-icon color="#00c7f3" class="mb-2">mdi-usb</v-icon>
            <p class="white--text text-body-2 text-center">{{ $t('miniGero.connectLedger') }}</p>
          </div>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" @click="signDataHw">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <!-- Trezor wallet -->
        <template v-else-if="walletType === WalletType.Trezor">
          <div class="hw-notice pa-3 mb-3 mt-3">
            <v-icon color="#00c7f3" class="mb-2">mdi-usb</v-icon>
            <p class="white--text text-body-2 text-center">{{ $t('miniGero.connectTrezor') }}</p>
          </div>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" @click="signDataHw">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <!-- Fallback -->
        <template v-else>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" @click="signDataNormal">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>
      </div>
    </div>

    <!-- Keystone QR dialog -->
    <KeystoneSignDialog
      v-if="showKeystoneDialog"
      :visible="showKeystoneDialog"
      :type="keystoneType"
      :cbor="keystoneCbor"
      @scan="onKeystoneScan"
      @error="onKeystoneError"
      @close="showKeystoneDialog = false"
    />
  </BottomSheet>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { useDAppOverlay } from '../composables/useDAppOverlay';
import BottomSheet from './BottomSheet.vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import WalletStore from '@/stores/walletStore';
import { WalletType } from '@/models/types';
import { deserializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import ledgerUtils from '@/shared/utils/ledger';
import { createKeystoneSignRequest, KeystoneSignRequestResponse, parseSignature } from '@/shared/utils/keystone';
import { UR } from '@keystonehq/keystone-sdk';
import networks from '@/utils/networks';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';

interface BackgroundResponse<T> { data: T }
interface SignTxResponse { success: boolean; error?: string; signatures?: Array<[string, string]> }

const { isVisible, currentRequest, requestQueue, approve, reject } = useDAppOverlay();

const spendingPassword = ref('');
const showPassword = ref(false);
const signing = ref(false);
const signError = ref('');
const enableConsent = ref(false);
const faviconFailed = ref(false);

const enableDomain = computed(() => {
  const website = currentRequest.value?.payload?.website || '';
  try {
    return new URL(website).hostname;
  } catch {
    return website;
  }
});

const faviconUrl = computed(() => {
  const domain = enableDomain.value;
  if (!domain) return '';
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
});

// Sign Data — domain + decoded message
const signDataDomain = computed(() => {
  const website = currentRequest.value?.payload?.website || '';
  try {
    return new URL(website).hostname;
  } catch {
    return website;
  }
});

const signDataMessage = computed(() => {
  const payload = currentRequest.value?.payload?.message || currentRequest.value?.payload?.payload;
  if (!payload) return '';
  try {
    return Buffer.from(payload, 'hex').toString('utf-8');
  } catch {
    return payload;
  }
});

// Keystone state
const showKeystoneDialog = ref(false);
const keystoneType = ref('');
const keystoneCbor = ref('');
const keystoneUseHash = ref(false);

const walletType = computed(() => WalletStore.state.loggedWallet?.type);
const isPrfWallet = computed(() => WalletStore.state.loggedWallet?.encryptionMethod === 'prf');
const loggedWallet = computed(() => WalletStore.state.loggedWallet);
const keys = computed(() => WalletStore.state.keys);
const utxos = computed(() => WalletStore.state.utxos);
const isBT = computed(() => WalletStore.state.loggedWallet?.connectionType === 'bluetooth');

// Reset state when request changes
watch(currentRequest, () => {
  spendingPassword.value = '';
  showPassword.value = false;
  signing.value = false;
  signError.value = '';
  enableConsent.value = false;
  faviconFailed.value = false;
});

function rejectSign() {
  spendingPassword.value = '';
  signError.value = '';
  reject('user_rejected');
}

function getTxCbor(): string {
  return currentRequest.value?.payload?.tx;
}

// ── Normal wallet: password signing ──
async function signNormal() {
  if (!currentRequest.value || !spendingPassword.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const payload = currentRequest.value.payload;
    const witnessResult = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_TX,
      data: {
        txCbor: payload.tx,
        partialSign: payload.partialSign,
        password: spendingPassword.value,
        accountIndex: 0,
        utxos: utxos.value,
        addresses: keys.value,
        mergeWitnesses: payload.mergeWitnesses || false,
      }
    }) as { data: { witnesses?: string; error?: string } };

    if (witnessResult.data.error) throw new Error(witnessResult.data.error);
    approve(witnessResult.data.witnesses);
    spendingPassword.value = '';
  } catch (e: any) {
    console.error('[DApp] Normal sign error:', e);
    signError.value = e.message || 'Signing failed';
  } finally {
    signing.value = false;
  }
}

// ── PRF wallet: PassKey signing ──
async function signPrf() {
  if (!currentRequest.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const popupUrl = chrome.runtime.getURL('index.html?mode=privateKey#/passkey-auth');
    window.open(popupUrl, 'PassKeyAuth', 'width=400,height=500,popup=1');

    const pkBytes = await new Promise<Uint8Array>((resolve, rejectPromise) => {
      const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
      const handler = (event: MessageEvent) => {
        if (event.origin !== extensionOrigin) return;
        if (event.data.type === 'PASSKEY_AUTH_RESULT') {
          window.removeEventListener('message', handler);
          const { success, privateKeyBytes: bytes, error } = event.data.payload;
          if (success && bytes) resolve(new Uint8Array(bytes));
          else rejectPromise(new Error(error || 'PassKey authentication failed'));
        }
      };
      window.addEventListener('message', handler);
      setTimeout(() => {
        window.removeEventListener('message', handler);
        rejectPromise(new Error('PassKey authentication timed out'));
      }, 60000);
    });

    const payload = currentRequest.value.payload;
    const witnessResult = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_TX,
      data: {
        txCbor: payload.tx,
        partialSign: payload.partialSign,
        password: '',
        accountIndex: 0,
        utxos: utxos.value,
        addresses: keys.value,
        mergeWitnesses: payload.mergeWitnesses || false,
        privateKeyBytes: Array.from(pkBytes),
      }
    }) as { data: { witnesses?: string; error?: string } };

    if (witnessResult.data.error) throw new Error(witnessResult.data.error);
    approve(witnessResult.data.witnesses);
  } catch (e: any) {
    console.error('[DApp] PRF sign error:', e);
    signError.value = e.message || 'PassKey signing failed';
  } finally {
    signing.value = false;
  }
}

// ── Ledger wallet signing ──
async function signLedger() {
  if (!currentRequest.value || !loggedWallet.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const txCbor = getTxCbor();
    const tx: Cardano.Tx = deserializeCardanoJsSdkTx(txCbor);

    const signatures: Cardano.Signatures = await ledgerUtils.txToLedger(
      tx,
      keys.value,
      utxos.value,
      !isBT.value,
      networks.resolveNetwork(loggedWallet.value.chain, loggedWallet.value.network),
      txCbor,
    );

    const witnessSet = Serialization.TransactionWitnessSet.fromCore({ signatures });
    approve(witnessSet.toCbor());
  } catch (e: any) {
    ledgerUtils.ledgerErrorHandling(e);
    console.error('[DApp] Ledger sign error:', e);
    signError.value = e?.message || 'Ledger signing failed';
  } finally {
    signing.value = false;
  }
}

// ── Trezor wallet signing ──
async function signTrezor() {
  if (!currentRequest.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const txCbor = getTxCbor();
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.TREZOR,
      data: { method: 'signTx', txCbor },
    }) as BackgroundResponse<SignTxResponse>;

    if (!response.data.success) {
      throw new Error(response.data.error || 'Trezor signing failed');
    }

    const signaturesArray = response.data.signatures as unknown as Array<[string, string]>;
    const signatures: Cardano.Signatures = new Map(signaturesArray);
    const witnessSet = Serialization.TransactionWitnessSet.fromCore({ signatures });
    approve(witnessSet.toCbor());
  } catch (e: any) {
    console.error('[DApp] Trezor sign error:', e);
    if (e.message?.includes('Failure_ActionCancelled') || e.message?.includes('cancelled')) {
      signError.value = 'Transaction cancelled on Trezor';
    } else {
      signError.value = e.message || 'Trezor signing failed';
    }
  } finally {
    signing.value = false;
  }
}

// ── Keystone wallet signing ──
function signKeystone() {
  if (!currentRequest.value || !loggedWallet.value) return;
  signError.value = '';

  try {
    const txCbor = getTxCbor();
    const txSerialized = Serialization.Transaction.fromCbor(txCbor as any);
    const signRequestResponse: KeystoneSignRequestResponse = createKeystoneSignRequest(
      txSerialized, loggedWallet.value, utxos.value, keys.value
    );
    keystoneType.value = signRequestResponse.ur.type;
    keystoneCbor.value = signRequestResponse.ur.cbor.toString('hex');
    keystoneUseHash.value = signRequestResponse.useHash;
    showKeystoneDialog.value = true;
  } catch (e: any) {
    console.error('[DApp] Keystone sign error:', e);
    signError.value = e?.message || 'Failed to create Keystone sign request';
  }
}

async function onKeystoneScan(ur: UR) {
  try {
    const signature = parseSignature(ur);
    if (!signature?.witnessSet || typeof signature.witnessSet !== 'string') {
      throw new Error('Invalid Keystone signature');
    }
    showKeystoneDialog.value = false;
    approve(signature.witnessSet);
  } catch (e: any) {
    console.error('[DApp] Keystone scan error:', e);
    signError.value = e?.message || 'Keystone QR scan error';
    showKeystoneDialog.value = false;
  }
}

function onKeystoneError(error: string) {
  signError.value = error || 'Keystone scan error';
  showKeystoneDialog.value = false;
}

// ── Sign Data: Normal wallet (password) ──
async function signDataNormal() {
  if (!currentRequest.value || !spendingPassword.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const { address, payload } = currentRequest.value.payload;
    const res = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_DATA,
      data: {
        address,
        payload,
        password: spendingPassword.value,
        accountIndex: 0,
        isUsb: true,
      },
    }) as { data: { key: string; signature: string } };

    approve(res.data);
    spendingPassword.value = '';
  } catch (e: any) {
    console.error('[DApp] Sign data error:', e);
    signError.value = e.message || 'Signing failed';
  } finally {
    signing.value = false;
  }
}

// ── Sign Data: PRF wallet (PassKey) ──
async function signDataPrf() {
  if (!currentRequest.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const popupUrl = chrome.runtime.getURL('index.html?mode=privateKey#/passkey-auth');
    window.open(popupUrl, 'PassKeyAuth', 'width=400,height=500,popup=1');

    const pkBytes = await new Promise<Uint8Array>((resolve, rejectPromise) => {
      const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
      const handler = (event: MessageEvent) => {
        if (event.origin !== extensionOrigin) return;
        if (event.data.type === 'PASSKEY_AUTH_RESULT') {
          window.removeEventListener('message', handler);
          const { success, privateKeyBytes: bytes, error } = event.data.payload;
          if (success && bytes) resolve(new Uint8Array(bytes));
          else rejectPromise(new Error(error || 'PassKey authentication failed'));
        }
      };
      window.addEventListener('message', handler);
      setTimeout(() => {
        window.removeEventListener('message', handler);
        rejectPromise(new Error('PassKey authentication timed out'));
      }, 60000);
    });

    const { address, payload } = currentRequest.value.payload;
    const { buildSignatureAndCoseKey } = await import('@/shared/utils/converter');
    const { Bip32PrivateKey } = await import('@cardano-sdk/crypto');

    const rootKey = Bip32PrivateKey.fromBytes(pkBytes);

    // Resolve address to bech32
    let addressBech32: string;
    if (address.startsWith('addr') || address.startsWith('stake')) {
      addressBech32 = address;
    } else {
      addressBech32 = Cardano.Address.fromBytes(Buffer.from(address, 'hex')).toBech32();
    }

    // Find signing key
    const allKeys = [...keys.value.payment, ...keys.value.change, ...keys.value.stake];
    const foundKey = allKeys.find(k => k.address === addressBech32);
    if (!foundKey?.path) throw new Error('Address not found in wallet keys');

    const pathParts = foundKey.path.split('/');
    const role = parseInt(pathParts[4].replace("'", ""), 10);
    const index = parseInt(pathParts[5].replace("'", ""), 10);

    const accountKey = rootKey.derive([2147485500, 2147485463, 2147483648]);
    const signingKey = accountKey.derive([role, index]).toRawKey();

    // Get address bytes for COSE_Key
    const addressBytes = address.startsWith('addr') || address.startsWith('stake')
      ? Cardano.Address.fromBech32(address).toBytes()
      : Buffer.from(address, 'hex');

    const signatureData = buildSignatureAndCoseKey(addressBytes, payload, signingKey);
    approve(signatureData);
  } catch (e: any) {
    console.error('[DApp] PRF sign data error:', e);
    signError.value = e.message || 'PassKey signing failed';
  } finally {
    signing.value = false;
  }
}

// ── Sign Data: Hardware wallet (Ledger/Trezor via background) ──
async function signDataHw() {
  if (!currentRequest.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const { address, payload } = currentRequest.value.payload;
    const res = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_DATA,
      data: {
        address,
        payload,
        password: '',
        accountIndex: 0,
        isUsb: true,
      },
    }) as { data: { key: string; signature: string } };

    approve(res.data);
  } catch (e: any) {
    console.error('[DApp] HW sign data error:', e);
    signError.value = e.message || 'Signing failed';
  } finally {
    signing.value = false;
  }
}
</script>

<style scoped>
.dapp-overlay {
  display: flex;
  flex-direction: column;
  padding: 16px;
}

.queue-indicator {
  text-align: center;
}

/* ── Enable / Connect ── */

.dapp-identity {
  display: flex;
  align-items: center;
  gap: 14px;
}

.favicon-wrapper {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.favicon-img {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.dapp-domain-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.dapp-url {
  word-break: break-all;
  line-height: 1.3;
}

.url-warning {
  display: flex;
  align-items: flex-start;
  padding: 8px 10px;
  background: rgba(255, 167, 38, 0.08);
  border: 1px solid rgba(255, 167, 38, 0.15);
  border-radius: 8px;
}

.permissions-section {
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
}

.consent-checkbox >>> .v-label {
  font-size: 13px !important;
  color: rgba(255, 255, 255, 0.8) !important;
}

.security-note {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  line-height: 1.4;
}

/* ── Sign ── */

.dapp-sign-tx {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.dapp-sign-data {
  display: flex;
  flex-direction: column;
}

.sign-data-message {
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  max-height: 40vh;
  overflow-y: auto;
  width: 100%;
  white-space: pre-line;
}

.password-input {
  width: 100%;
  margin-top: 8px;
}

.hw-notice {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(0, 199, 243, 0.08);
  border-radius: 8px;
  width: 100%;
}

.action-buttons {
  display: flex;
  gap: 12px;
  width: 100%;
  justify-content: center;
  margin-top: 16px;
}

.action-buttons .v-btn {
  flex: 1;
  max-width: 160px;
}
</style>
