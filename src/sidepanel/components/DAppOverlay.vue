<template>
  <BottomSheet
    :value="isVisible"
    :persistent="true"
    :show-handle="false"
    height="85%"
  >
    <div v-if="currentRequest" class="dapp-overlay">
      <!-- Queue indicator -->
      <div v-if="requestQueue.length > 0" class="queue-indicator mb-2">
        <span class="grey--text text-caption">
          Request 1 of {{ requestQueue.length + 1 }}
        </span>
      </div>

      <!-- DApp Connect -->
      <div v-if="currentRequest.method === 'enable'" class="dapp-connect">
        <v-icon size="48" color="#00c7f3" class="mb-3">mdi-link-variant</v-icon>
        <h3 class="white--text text-h6 mb-1">{{ $t('miniGero.connectRequest') }}</h3>
        <p class="grey--text text-body-2 mb-4">{{ currentRequest.payload?.website }}</p>
        <div class="action-buttons">
          <v-btn outlined rounded dark @click="reject()">{{ $t('miniGero.reject') }}</v-btn>
          <v-btn class="geroButton" rounded depressed @click="approve(true)">
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
                {{ $t('miniGero.authenticate') }}
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
      <div v-else-if="currentRequest.method === 'signData'" class="dapp-sign">
        <v-icon size="48" color="#FDA29B" class="mb-3">mdi-file-sign</v-icon>
        <h3 class="white--text text-h6 mb-1">{{ $t('miniGero.signDataRequest') }}</h3>
        <p class="grey--text text-body-2 mb-4">{{ currentRequest.payload?.website }}</p>
        <div class="message-preview pa-3 mb-4">
          <p class="white--text text-caption" style="word-break: break-all;">
            {{ currentRequest.payload?.message || currentRequest.payload?.payload }}
          </p>
        </div>
        <div class="action-buttons">
          <v-btn outlined rounded dark @click="reject()">{{ $t('miniGero.reject') }}</v-btn>
          <v-btn class="geroButton" rounded depressed @click="handleSign">
            {{ $t('miniGero.sign') }}
          </v-btn>
        </div>
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

async function handleSign() {
  // TODO: Implement signData
  reject('signing_not_implemented');
}
</script>

<style scoped>
.dapp-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
}

.queue-indicator {
  text-align: center;
}

.message-preview {
  background: #111;
  border-radius: 8px;
  max-height: 120px;
  overflow-y: auto;
  width: 100%;
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
