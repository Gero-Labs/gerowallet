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

          <template v-else>
            <v-progress-circular indeterminate color="primary" size="44" class="mt-2" />

            <!-- ledger.ts publishes a step label for each stage of the signing
                 run; several of those stages are the device waiting on a button
                 press, so showing them is what tells the user to look at it. -->
            <p class="t-body-sm white--text mt-4 mb-0">{{ hardware.text || status }}</p>
            <p class="t-caption text--secondary mt-2">{{ $t('wallet.ledgerCheckDeviceScreen') }}</p>
          </template>

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
 * Ledger Bluetooth signing window.
 *
 * Chromium anchors the Web Bluetooth device chooser to a browser window's
 * toolbar. Anywhere without one — the side panel, and a `popup=1` window —
 * `requestDevice()` rejects immediately with "User cancelled the
 * requestDevice() chooser" and no dialog is ever drawn. Verified by hand on
 * macOS: the same call renders the chooser in a normal browser window and fails
 * silently in both of the others. So BLE signing runs HERE, in a small
 * `type: 'normal'` window opened by the side panel, and reports back.
 *
 * Protocol (chrome.runtime messaging — this window has no window.opener):
 *   tab → panel  LEDGER_BLE_READY   → answered with { txCbor }
 *   tab → panel  LEDGER_BLE_RESULT  { success, witnessCbor? , error?, cancelled? }
 *
 * Only the transaction and the resulting witness set cross this boundary —
 * never key material, which stays on the device.
 *
 * `requestDevice` needs transient user activation, and building the key-path
 * map can outlast the 5s activation window inherited from the tab opening. So
 * the BLE call is fired from an explicit button click here rather than
 * automatically on mount.
 */
import { ref, reactive, onMounted } from 'vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import WalletStore from '@/stores/walletStore';
import { deserializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import ledgerUtils from '@/shared/utils/ledger';
import hardwareLoading from '@/plugins/hardwareLoading';
import networks from '@/utils/networks';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();

// hardwareLoading is a plain singleton that ledger.ts writes step labels into.
// reactive() converts it in place (Vue 2.7 observes the object itself), so the
// writes from ledger.ts drive this template — the device is often sitting on a
// confirmation prompt and the window has to say which one.
const hardware = reactive(hardwareLoading);

const ready = ref(false);
const signing = ref(false);
const status = ref('');
const error = ref('');
const bleUnavailable = ref(false);

const txCbor = ref('');

// Guards the close path: the side panel must receive exactly one result, and
// must never be left waiting out its timeout because this tab went away.
let resultSent = false;

function reportToPanel(payload: Record<string, unknown>) {
  if (resultSent) return;
  resultSent = true;
  // The panel may already be gone (user closed it) — nothing to do about that,
  // and it must not turn into an unhandled rejection here.
  chrome.runtime.sendMessage({ type: 'LEDGER_BLE_RESULT', payload }).catch(() => { /* no listener */ });
}

async function closeSelf() {
  // window.close() only works for a window script opened via window.open, which
  // this is not. Removing the tab takes the whole signing window with it, since
  // it is the only tab in it.
  const self = await chrome.tabs.getCurrent();
  if (self?.id !== undefined) chrome.tabs.remove(self.id);
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

    // isUsb = false — this tab exists precisely to run the BLE transport.
    const signatures: Cardano.Signatures = await ledgerUtils.txToLedger(
      tx,
      WalletStore.state.keys,
      WalletStore.state.utxos as Cardano.Utxo[],
      false,
      networks.resolveNetwork(wallet.chain, wallet.network),
      txCbor.value,
    );

    const witnessSet = Serialization.TransactionWitnessSet.fromCore({ signatures });
    reportToPanel({ success: true, witnessCbor: witnessSet.toCbor() });
    setTimeout(() => { void closeSelf(); }, 300);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : '';
    // Raw transport errors carry bundle paths and line numbers — the previous
    // build rendered a localhost:3303/@fs/... path straight into the UI. Keep
    // the detail in the console and show the user something actionable.
    console.error('[LedgerBleSign] signing failed:', e);
    // The Ledger transport reports a closed chooser as TransportOpenUserCancelled;
    // treat it as a cancel so the side panel can re-offer signing rather than
    // showing it as a failure.
    const cancelled = message.includes('cancel');
    // The transport reports both a genuinely dismissed chooser and a chooser
    // that never appeared as "user cancelled", so say what to check rather than
    // blaming the user for a dialog they may never have seen.
    //
    // Otherwise defer to the shared classifier every other txToLedger caller
    // uses, so a locked device or a closed Cardano app says so instead of a flat
    // "try again". Unrecognized failures still get generic copy — that branch is
    // where raw transport errors live, and those carry bundle paths.
    const classified = ledgerUtils.classifyLedgerError(e);
    error.value = cancelled
      ? t('wallet.ledgerBleSignCancelledHint')
      : (classified.recognized ? classified.message : t('wallet.ledgerBleSignFailed'));
    status.value = '';
    // ledger.ts leaves its last step label behind; clear it so a retry does not
    // start out showing the stage that just failed.
    hardware.setText('');
    signing.value = false;
    // Deliberately NOT reported to the panel. Failure here is usually something
    // the user can fix on the spot — quit Ledger Live, unlock the device, open
    // the Cardano app — so the tab stays open and the button is live again.
    // Reporting now would settle the panel's promise and make a successful
    // retry unable to deliver its witness. Closing the tab is the cancel
    // signal; the panel watches for that.
  }
}

onMounted(async () => {
  // Ask the panel for the transaction. A tab created by chrome.tabs.create has
  // no window.opener, so this goes over runtime messaging rather than postMessage.
  try {
    const response = await chrome.runtime.sendMessage({ type: 'LEDGER_BLE_READY' });
    const cbor = response?.txCbor;
    if (typeof cbor !== 'string' || !cbor) {
      error.value = t('wallet.ledgerBleSignNoTx');
    } else {
      txCbor.value = cbor;
      ready.value = true;
    }
  } catch {
    // No listener answered — the side panel that requested this is gone.
    error.value = t('wallet.ledgerBleSignNoOpener');
  }

  // Surface an unusable radio immediately rather than after a click that can
  // only fail — this is the difference between "Bluetooth is off / Chrome is
  // not allowed to use it" and a chooser the user actually dismissed.
  bleUnavailable.value = !(await checkBluetoothAvailable());
});
</script>
