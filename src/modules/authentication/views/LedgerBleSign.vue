<template>
  <v-app>
    <v-container fluid fill-height class="pa-0">
      <v-row align="center" justify="center" class="fill-height">
        <v-col cols="12" class="text-center px-6">
          <div class="mb-4">
            <v-icon size="56" color="primary">mdi-bluetooth</v-icon>
          </div>

          <h2 class="t-heading mb-2">{{ $t('wallet.ledgerBleSignTitle') }}</h2>
          <p class="t-body-sm text--secondary mb-6">{{ $t('wallet.ledgerBleSignHint') }}</p>

          <v-alert v-if="bleUnavailable" type="warning" text class="mb-4 text-left">
            {{ $t('wallet.ledgerBleUnavailable') }}
          </v-alert>

          <v-btn
            v-if="!signing"
            block
            rounded
            depressed
            class="geroButton black--text font-weight-bold"
            :disabled="!ready || bleUnavailable"
            @click="startSigning()"
          >
            {{ $t('wallet.ledgerBleSignAction') }}
          </v-btn>

          <v-progress-circular
            v-else
            indeterminate
            color="primary"
            size="44"
            class="mt-2"
          />

          <p v-if="status" class="t-caption text--secondary mt-4">{{ status }}</p>

          <v-alert v-if="error" type="error" text class="mt-4 text-left">
            {{ error }}
          </v-alert>
        </v-col>
      </v-row>
    </v-container>
  </v-app>
</template>

<script setup lang="ts">
/**
 * Ledger Bluetooth signing popup.
 *
 * Chrome does not present the Web Bluetooth device chooser inside a side
 * panel — `navigator.bluetooth.requestDevice()` there rejects immediately with
 * "User cancelled the requestDevice() chooser" and no dialog is ever drawn.
 * The side panel therefore hands BLE signing off to this real popup window,
 * exactly as it already does for the WebAuthn ceremony (see PassKeyAuth.vue).
 *
 * Protocol with the opener (both directions origin-checked against the
 * extension origin):
 *   popup  → opener  LEDGER_BLE_READY
 *   opener → popup   LEDGER_BLE_REQUEST { txCbor }
 *   popup  → opener  LEDGER_BLE_RESULT  { success, witnessCbor? , error?, cancelled? }
 *
 * Only the transaction and the resulting witness set cross this boundary —
 * never key material, which stays on the device.
 *
 * `requestDevice` needs transient user activation, and building the key-path
 * map can outlast the 5s activation window inherited from `window.open`. So
 * the BLE call is fired from an explicit button click in this window rather
 * than automatically on mount.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import WalletStore from '@/stores/walletStore';
import { deserializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import ledgerUtils from '@/shared/utils/ledger';
import networks from '@/utils/networks';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();

const ready = ref(false);
const signing = ref(false);
const status = ref('');
const error = ref('');
const bleUnavailable = ref(false);

const txCbor = ref('');
const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;

// Guards the close/unload path: the opener must receive exactly one result, and
// must never be left waiting out its timeout because this window went away.
let resultSent = false;

function postToOpener(payload: Record<string, unknown>) {
  if (resultSent || !window.opener) return;
  resultSent = true;
  window.opener.postMessage({ type: 'LEDGER_BLE_RESULT', payload }, extensionOrigin);
}

function onOpenerMessage(event: MessageEvent) {
  // Only the window that opened this one may hand it a transaction to sign;
  // the origin check alone would accept any same-origin extension page.
  if (event.origin !== extensionOrigin || event.source !== window.opener) return;
  if (event.data?.type !== 'LEDGER_BLE_REQUEST') return;
  const cbor = event.data.payload?.txCbor;
  if (typeof cbor !== 'string' || !cbor) {
    error.value = t('wallet.ledgerBleSignNoTx');
    return;
  }
  txCbor.value = cbor;
  ready.value = true;
}

/**
 * Ask the browser whether a Bluetooth radio is actually usable before opening
 * the chooser.
 *
 * `TransportWebBLE.isSupported()` only checks that `navigator.bluetooth` exists,
 * so it reports true even when the OS has denied Chrome access to the adapter or
 * the radio is off. In that state `requestDevice()` rejects with the generic
 * "User cancelled the requestDevice() chooser" and the user is told they
 * cancelled something they never saw. Distinguish the two up front.
 */
async function checkBluetoothAvailable(): Promise<boolean> {
  const ble = (navigator as Navigator & { bluetooth?: { getAvailability?: () => Promise<boolean> } }).bluetooth;
  if (!ble) return false;
  if (typeof ble.getAvailability !== 'function') return true; // can't tell — let the chooser try
  try {
    return await ble.getAvailability();
  } catch {
    return true; // availability probe failed, not the adapter — don't block on it
  }
}

async function startSigning() {
  if (!ready.value || signing.value) return;
  signing.value = true;
  error.value = '';

  try {
    const wallet = WalletStore.state.loggedWallet;
    if (!wallet) throw new Error(t('wallet.ledgerBleSignNoWallet'));

    if (!(await checkBluetoothAvailable())) {
      throw new Error(t('wallet.ledgerBleUnavailable'));
    }

    status.value = t('wallet.ledgerConnectingDevice');
    const tx: Cardano.Tx = deserializeCardanoJsSdkTx(txCbor.value);

    // isUsb = false — this window exists precisely to run the BLE transport.
    const signatures: Cardano.Signatures = await ledgerUtils.txToLedger(
      tx,
      WalletStore.state.keys,
      WalletStore.state.utxos as Cardano.Utxo[],
      false,
      networks.resolveNetwork(wallet.chain, wallet.network),
      txCbor.value,
    );

    const witnessSet = Serialization.TransactionWitnessSet.fromCore({ signatures });
    postToOpener({ success: true, witnessCbor: witnessSet.toCbor() });
    setTimeout(() => window.close(), 300);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : '';
    // The Ledger transport reports a closed chooser as TransportOpenUserCancelled;
    // treat it as a cancel so the side panel can re-offer signing rather than
    // showing it as a failure.
    const cancelled = message.includes('cancel');
    // The transport reports both a genuinely dismissed chooser and a chooser
    // that never appeared as "user cancelled", so say what to check rather than
    // blaming the user for a dialog they may never have seen.
    error.value = cancelled
      ? t('wallet.ledgerBleSignCancelledHint')
      : (message || t('wallet.ledgerBleSignFailed'));
    status.value = '';
    signing.value = false;
    postToOpener({ success: false, cancelled, error: error.value });
    // Leave the message up long enough to read, then hand the side panel back
    // its own error surface.
    setTimeout(() => window.close(), 1800);
  }
}

onMounted(async () => {
  window.addEventListener('message', onOpenerMessage);
  if (window.opener) {
    window.opener.postMessage({ type: 'LEDGER_BLE_READY' }, extensionOrigin);
  } else {
    error.value = t('wallet.ledgerBleSignNoOpener');
  }

  // Surface an unusable radio immediately rather than after a click that can
  // only fail — this is the difference between "Bluetooth is off / Chrome is
  // not allowed to use it" and a chooser the user actually dismissed.
  bleUnavailable.value = !(await checkBluetoothAvailable());
});

onBeforeUnmount(() => {
  window.removeEventListener('message', onOpenerMessage);
});

// Closing this window before a result was posted — the user dismissing it, or
// Chrome tearing it down — must not leave the side panel waiting out its full
// timeout. postToOpener is a no-op once a result has already been sent.
window.addEventListener('beforeunload', () => {
  postToOpener({ success: false, cancelled: true, error: '' });
});
</script>
