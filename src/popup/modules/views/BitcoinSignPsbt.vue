<template>
  <v-form ref="form" v-model="valid" class="fill-height">
    <PopupHeader :title="$t('bitcoin.signPsbt')" :show-website="hasWebsite" :disabled="loading">
      <v-card-text class="d-flex flex-column pa-0 fill-height">
        <EmbeddedSiteWarning class="mb-2" :embedded-in="request?.embeddedIn" />
        <v-card-title class="pa-0 mb-2" style="color: white; font-size: 14px">
          {{ $t('bitcoin.signPsbtRequest') }}
        </v-card-title>

        <!-- PSBT summary -->
        <v-card flat variant="outlined" style="background-color: #141414!important;" class="pa-2 mb-3">
          <div class="psbt-row">
            <span class="psbt-label">{{ $t('bitcoin.inputs') }}</span>
            <span class="psbt-value">{{ psbtInfo.inputs }}</span>
          </div>
          <div class="psbt-row">
            <span class="psbt-label">{{ $t('bitcoin.outputs') }}</span>
            <span class="psbt-value">{{ psbtInfo.outputs }}</span>
          </div>
          <div class="psbt-row" v-if="psbtInfo.autoFinalized !== undefined">
            <span class="psbt-label">{{ $t('bitcoin.result') }}</span>
            <span class="psbt-value">{{ psbtInfo.autoFinalized ? $t('bitcoin.finalizedTx') : $t('bitcoin.signedPsbt') }}</span>
          </div>
        </v-card>
      </v-card-text>

      <v-card-actions class="justify-center pb-0 pt-2 px-0">
        <div class="flex-grow-1">
          <v-row>
            <!-- Password field for normal wallets -->
            <v-col cols="12" v-if="isNormalWallet && !isPrfWallet" class="pb-0">
              <PassKeyPasswordField
                ref="passwordField"
                :model-value="spendingPassword"
                @update:model-value="spendingPassword = $event"
                dense outlined hide-details="auto"
                :placeholder="$t('navigation.typeYourSpendingPassword')"
                :label="$t('wallet.spendingPassword')"
                :rules="[rules.required()]"
                required
                @enter="sign"
              />
            </v-col>

            <!-- PRF wallet: PassKey button -->
            <v-col cols="12" v-else-if="isNormalWallet && isPrfWallet" class="pt-2 pb-0">
              <PassKeyAuthButton
                v-if="!signed"
                :disabled="loading"
                @success="handlePassKeyAuthSuccess"
                @error="handlePassKeyAuthError"
                block class="mb-2"
              />
              <v-btn v-else block class="geroButton" style="color: black!important;" @click="returnSigned" :disabled="loading" :loading="loading">
                {{ $t('common.confirm') }}
              </v-btn>
            </v-col>

            <!-- Ledger -->
            <v-col cols="12" v-else-if="isLedger" class="pb-0">
              <v-card-subtitle class="pa-0 text-center pt-0" style="color: white">
                <ToggleSwitch :text-left="$t('wallet.usb')" icon-left="mdi-usb" :text-right="$t('wallet.bluetooth')" icon-right="mdi-bluetooth" :model-value="isBT" @update:model-value="isBT = $event" :disabled="loading" />
              </v-card-subtitle>
            </v-col>

            <!-- Trezor -->
            <v-col cols="12" v-else-if="isTrezor" class="pb-0">
              <v-alert type="info" color="primary" variant="text" border="start" density="compact" class="py-1 my-0">
                <span style="color: white; font-size: 12px">{{ $t('wallet.confirmOnTrezor') }}</span>
              </v-alert>
            </v-col>

            <!-- Keystone -->
            <v-col cols="12" v-else-if="isKeystone" class="pb-0">
              <v-alert type="info" color="primary" variant="text" border="start" density="compact" class="py-1 my-0">
                <span style="color: white; font-size: 12px">{{ $t('wallet.scanQRWithKeystone') }}</span>
              </v-alert>
            </v-col>

            <!-- Decline / Sign -->
            <v-col :cols="isPrfWallet ? 12 : 6">
              <v-btn block variant="outlined" color="error" style="text-transform: capitalize;" @click="decline">
                {{ $t('common.decline') }}
              </v-btn>
            </v-col>
            <v-col cols="6" v-if="!isPrfWallet">
              <v-btn block class="geroButton" style="color: black!important;" @click="sign" :loading="loading" :disabled="!canSign || loading">
                {{ $t('wallet.sign') }}
              </v-btn>
            </v-col>
          </v-row>
        </div>
      </v-card-actions>

      <!-- Keystone QR overlay -->
      <v-overlay  opacity="0.99" :model-value="keystoneOverlay" persistent
        contained
        class="hardwareOverlay align-center justify-center">
        <v-alert color="white" density="compact" variant="outlined" type="info" border="start" v-if="!keystoneScan" class="mt-2 mb-2" prominent>
          <b style="font-size: 12px">{{ $t('wallet.instructions') }}</b>
          <ul class="text-left" style="line-height: 1.3; font-size: 11px; margin-top: 4px; padding-left: 10px;">
            <li>{{ $t('wallet.unlockKeystone') }}</li>
            <li>{{ $t('wallet.selectScanQR') }} <v-icon size="x-small">mdi-line-scan</v-icon></li>
            <li>{{ $t('wallet.useKeystoneToScan') }}</li>
            <li>{{ $t('wallet.approveAndScanNext') }}</li>
          </ul>
        </v-alert>
        <v-alert color="white" density="compact" variant="outlined" type="info" border="start" v-else class="mt-2 mb-2" prominent>
          <b style="font-size: 12px">{{ $t('wallet.scanQRCode') }}</b>
        </v-alert>
        <div v-if="!keystoneScan && keystoneCbor" style="max-width: 286px; margin: 0 auto;">
          <AnimatedQRCode :type="keystoneType" :cbor="keystoneCbor" :size="286" :capacity="100" />
        </div>
        <div v-else-if="keystoneScan">
          <AnimatedQRScanner purpose="sign" :urTypes="['crypto-psbt']" width="100%" height="220px" @scan="onKeystoneScan" @error="onKeystoneError" />
        </div>
        <div class="text-center pt-2">
          <v-btn variant="text" size="small" @click="backKeystoneScan" class="mr-2">
            {{ keystoneScan ? $t('common.back') : $t('common.cancel') }}
          </v-btn>
          <v-btn v-if="!keystoneScan" size="small" class="geroButton" style="color: black!important;" @click="keystoneScan = true">
            {{ $t('common.next') }}
          </v-btn>
        </div>
      </v-overlay>
    </PopupHeader>
  </v-form>
</template>

<script setup lang="ts">
import { useApprovalFreshness, awaitFreshApproval, StaleApprovalError } from "@/shared/composables/useApprovalFreshness";
import { computed, getCurrentInstance, onMounted, ref } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import rules from '@/utils/rules';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import EmbeddedSiteWarning from '@/shared/components/EmbeddedSiteWarning.vue';
import { getErrorMessage } from '@/shared/utils/errorHandler';
import type { Psbt } from 'bitcoinjs-lib';
import { assertApprovedPsbt } from '@/chains/bitcoin/psbtApproval';

interface BtcSignPsbtOptions {
  autoFinalized?: boolean;
  toSignInputs?: unknown[];
}
/** What the background hands this popup (see BITCOIN_METHOD.signPsbt / signPsbts). */
interface BtcSignPsbtRequest {
  /** Browser-derived embedding site, set by the background. */
  embeddedIn?: string | null;
  data?: { psbtHex: string; options?: BtcSignPsbtOptions };
}
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import AnimatedQRCode from '@/shared/components/AnimatedQRCode.vue';
import AnimatedQRScanner from '@/shared/components/AnimatedQRScanner.vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { WalletType } from '@/models/types';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { walletStore } from '@/stores/walletStore';
import snackbar from '@/plugins/snackbar';
import hardwareLoading from '@/plugins/hardwareLoading';
import { toRefs } from 'vue';
import { UR } from '@keystonehq/keystone-sdk';

const { t } = useTranslation();
const vmProxy = getCurrentInstance()!.proxy;
const { loggedWallet } = toRefs(walletStore);

const form = ref(null);
const valid = ref(false);
const loading = ref(false);
const spendingPassword = ref('');

const privateKeyBytes = ref<Uint8Array | null>(null);
const controller = ref(null);
const request = ref<BtcSignPsbtRequest | null>(null);
const signed = ref(false);
const signedHex = ref('');
const isBT = ref(false);

// Keystone state
const keystoneOverlay = ref(false);
const keystoneScan = ref(false);
const keystoneType = ref('');
const keystoneCbor = ref('');
let keystoneApprovalCurrent: (() => boolean) | null = null;

const psbtInfo = ref({ inputs: 0, outputs: 0, autoFinalized: undefined as boolean | undefined });

const hasWebsite = computed(() => {
  const q = vmProxy.$route?.query;
  return !(q?.['website'] === 'undefined' || !q || Object.keys(q).length === 0);
});

const isNormalWallet = computed(() => loggedWallet.value?.type === WalletType.Normal);
const isPrfWallet = computed(() =>
  loggedWallet.value?.encryptionMethod === 'prf' ||
  (!!loggedWallet.value?.prfEncryptedPrivateKey && !!loggedWallet.value?.webAuthnCredentialId)
);
const isLedger = computed(() => loggedWallet.value?.type === WalletType.Ledger);
const isTrezor = computed(() => loggedWallet.value?.type === WalletType.Trezor);
const isKeystone = computed(() => loggedWallet.value?.type === WalletType.Keystone);

const canSign = computed(() => {
  if (isNormalWallet.value && !isPrfWallet.value) return valid.value;
  return true;
});


const approval = useApprovalFreshness(
  () => [request.value, loggedWallet.value?.id, loggedWallet.value?.chain, loggedWallet.value?.network, loggedWallet.value?.webAuthnCredentialId, loggedWallet.value?.encryptionMethod],
  () => !!request.value && !!loggedWallet.value && !walletStore.isLocked,
  () => { privateKeyBytes.value?.fill(0); privateKeyBytes.value = null; keystoneApprovalCurrent = null; keystoneOverlay.value = false; keystoneScan.value = false; keystoneCbor.value = ''; signed.value = false; signedHex.value = ""; },
);
const handlePassKeyAuthSuccess = async (pkBytes: Uint8Array) => {
  privateKeyBytes.value = pkBytes;
  await sign();
};

const handlePassKeyAuthError = (error: Error) => {
  snackbar.setError(error.message || t('security.passKeyAuthFailed'));
  privateKeyBytes.value = null;
};

const decline = async () => {
  approval.invalidate();
  await controller.value.returnData({ error: { code: 4001, message: 'User rejected the request' } });
  window.close();
};

const returnSigned = async () => {
  const approvalCurrent = approval.capture();
  if (!approvalCurrent()) return;
  await awaitFreshApproval(async () => (controller.value.returnData({ data: signedHex.value })), approvalCurrent);
  window.close();
};

const doSign = async () => {
  const approvalCurrent = approval.capture();
  if (!approvalCurrent()) return;
  loading.value = true;
  try {
    const { psbtHex, options } = request.value.data;
    const signingData: { psbtHex: string; options?: BtcSignPsbtOptions; privateKeyBytes?: number[]; password?: string } = { psbtHex, options };

    if (isPrfWallet.value && privateKeyBytes.value) {
      signingData.privateKeyBytes = Array.from(privateKeyBytes.value);
    } else {
      signingData.password = spendingPassword.value;
    }

    const response = await awaitFreshApproval(async () => (Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.BITCOIN_DAPP_SIGN_PSBT,
      data: signingData,
    })), approvalCurrent) as { data: { success: boolean; error?: string; signedHex?: string } };

    if (!response.data.success) throw new Error(response.data.error || 'Signing failed');

    signedHex.value = response.data.signedHex;
    signed.value = true;

    // Auto-confirm (txAutoSubmit or after PRF)
    await awaitFreshApproval(async () => (controller.value.returnData({ data: signedHex.value })), approvalCurrent);
    window.close();
  } catch (e: unknown) {
    if (e instanceof StaleApprovalError) return;
    snackbar.setError(getErrorMessage(e, 'Failed to sign PSBT') || 'Failed to sign PSBT');
    loading.value = false;
  }
};

const sign = () => approval.run(async () => {
  const approvalCurrent = approval.capture();
  if (!approvalCurrent()) return;
  if (isNormalWallet.value) {
    if (isPrfWallet.value) {
      if (privateKeyBytes.value) await awaitFreshApproval(() => doSign(), approvalCurrent);
      return;
    }
    if (!(await awaitFreshApproval(async () => (form.value?.validate()), approvalCurrent))?.valid) return;
    await awaitFreshApproval(async () => (doSign()), approvalCurrent);
  } else if (isLedger.value) {
    await awaitFreshApproval(async () => (signWithLedger()), approvalCurrent);
  } else if (isTrezor.value) {
    await awaitFreshApproval(async () => (signWithTrezor()), approvalCurrent);
  } else if (isKeystone.value) {
    await awaitFreshApproval(async () => (showKeystoneQR()), approvalCurrent);
  }
});

const signWithLedger = async () => {
  const approvalCurrent = approval.capture();
  if (!approvalCurrent()) return;
  loading.value = true;
  // The device holds the PSBT on its own screen; without this the view shows
  // only a spinner that cannot resolve until the user acts on it.
  hardwareLoading.begin('Ledger', t('wallet.ledgerPleaseConfirmDevice') as string);
  try {
    const { default: ledger } = await awaitFreshApproval(() => import('@/shared/utils/ledger'), approvalCurrent);
    const signedPsbtHex = await awaitFreshApproval(() => ledger.signBitcoinTransaction(
      request.value.data.psbtHex, loggedWallet.value.addressType, 0, !isBT.value,
    ), approvalCurrent);

    assertApprovedPsbt(request.value.data.psbtHex, signedPsbtHex);
    const options = request.value.data.options;
    let returnHex = signedPsbtHex;
    if (options?.autoFinalized !== false) {
      // Finalize in browser context
      const bitcoin = await awaitFreshApproval(async () => (import('bitcoinjs-lib')), approvalCurrent);
      const { getBitcoinNetwork } = await awaitFreshApproval(async () => (import('@/chains/bitcoin/bitcoinPsbtBuilder')), approvalCurrent);
      const network = getBitcoinNetwork(loggedWallet.value.network);
      const psbt = bitcoin.Psbt.fromHex(signedPsbtHex, { network });
      psbt.finalizeAllInputs();
      returnHex = psbt.extractTransaction().toHex();
    }

    await awaitFreshApproval(async () => (controller.value.returnData({ data: returnHex })), approvalCurrent);
    window.close();
  } catch (e: unknown) {
    if (e instanceof StaleApprovalError) return;
    snackbar.setError(getErrorMessage(e, t('wallet.ledgerDeviceError', { message: '' })) || t('wallet.ledgerDeviceError', { message: '' }));
    loading.value = false;
  } finally {
    hardwareLoading.end();
  }
};

const signWithTrezor = async () => {
  const approvalCurrent = approval.capture();
  if (!approvalCurrent()) return;
  loading.value = true;
  // Trezor reports no intermediate stages, so this one label covers the whole
  // call — connecting through the confirmation it is waiting on.
  hardwareLoading.begin('Trezor', t('wallet.confirmOnTrezor') as string);
  try {
    let signedPsbtHex: string;
    if (featureFlagsStore.state.flags.isTrezorWebUsbEnabled) {
      const { default: trezor } = await awaitFreshApproval(() => import('@/shared/utils/trezorWeb'), approvalCurrent);
      signedPsbtHex = await awaitFreshApproval(() => trezor.signTransaction(request.value.data.psbtHex, loggedWallet.value.addressType), approvalCurrent);
    } else {
      const { default: trezor } = await awaitFreshApproval(() => import('@/shared/utils/trezor'), approvalCurrent);
      signedPsbtHex = await awaitFreshApproval(() => trezor.signBitcoinTransaction(request.value.data.psbtHex, loggedWallet.value.addressType), approvalCurrent);
    }

    assertApprovedPsbt(request.value.data.psbtHex, signedPsbtHex);
    const options = request.value.data.options;
    let returnHex = signedPsbtHex;
    if (options?.autoFinalized !== false) {
      const bitcoin = await awaitFreshApproval(async () => (import('bitcoinjs-lib')), approvalCurrent);
      const { getBitcoinNetwork } = await awaitFreshApproval(async () => (import('@/chains/bitcoin/bitcoinPsbtBuilder')), approvalCurrent);
      const network = getBitcoinNetwork(loggedWallet.value.network);
      const psbt = bitcoin.Psbt.fromHex(signedPsbtHex, { network });
      psbt.finalizeAllInputs();
      returnHex = psbt.extractTransaction().toHex();
    }

    await awaitFreshApproval(async () => (controller.value.returnData({ data: returnHex })), approvalCurrent);
    window.close();
  } catch (e: unknown) {
    if (e instanceof StaleApprovalError) return;
    snackbar.setError(getErrorMessage(e, t('wallet.trezorSigningFailed')) || t('wallet.trezorSigningFailed'));
    loading.value = false;
  } finally {
    hardwareLoading.end();
  }
};

const showKeystoneQR = async () => {
  const approvalCurrent = approval.capture();
  if (!approvalCurrent()) return;
  try {
    const { generateBitcoinPSBTQR } = await awaitFreshApproval(() => import('@/shared/utils/keystone'), approvalCurrent);
    const { URDecoder } = await awaitFreshApproval(() => import('@ngraveio/bc-ur'), approvalCurrent);
    const decoder = new URDecoder();
    decoder.receivePart(String(generateBitcoinPSBTQR(request.value.data.psbtHex).data));
    const ur = decoder.resultUR();
    keystoneType.value = ur.type;
    keystoneCbor.value = ur.cbor.toString('hex');
    keystoneApprovalCurrent = approvalCurrent;
    keystoneOverlay.value = true;
    keystoneScan.value = false;
  } catch (e: unknown) {
    if (e instanceof StaleApprovalError) return;
    snackbar.setError(getErrorMessage(e, 'Failed to generate Keystone QR code') || 'Failed to generate Keystone QR code');
  }
};

const onKeystoneScan = (ur: UR) => approval.run(async () => {
  const approvalCurrent = keystoneApprovalCurrent;
  if (!approvalCurrent?.() || !keystoneOverlay.value) return;
  keystoneApprovalCurrent = null;
  try {
    const { parseBitcoinSignature } = await awaitFreshApproval(() => import('@/shared/utils/keystone'), approvalCurrent);
    const signedPsbtHex = parseBitcoinSignature(ur);

    keystoneOverlay.value = false;
    keystoneScan.value = false;

    assertApprovedPsbt(request.value.data.psbtHex, signedPsbtHex);
    const options = request.value.data.options;
    let returnHex = signedPsbtHex;
    if (options?.autoFinalized !== false) {
      const bitcoin = await awaitFreshApproval(async () => (import('bitcoinjs-lib')), approvalCurrent);
      const { getBitcoinNetwork } = await awaitFreshApproval(async () => (import('@/chains/bitcoin/bitcoinPsbtBuilder')), approvalCurrent);
      const network = getBitcoinNetwork(loggedWallet.value.network);
      const psbt = bitcoin.Psbt.fromHex(signedPsbtHex, { network });
      psbt.finalizeAllInputs();
      returnHex = psbt.extractTransaction().toHex();
    }

    await awaitFreshApproval(async () => (controller.value.returnData({ data: returnHex })), approvalCurrent);
    window.close();
  } catch (e: unknown) {
    if (e instanceof StaleApprovalError) return;
    snackbar.setError(getErrorMessage(e, t('wallet.keystoneQRScanError')) || t('wallet.keystoneQRScanError'));
    keystoneOverlay.value = false;
    keystoneScan.value = false;
  }
});

const onKeystoneError = (error: string) => {
  snackbar.setError(error || t('wallet.keystoneScanError'));
};

const backKeystoneScan = () => {
  if (keystoneScan.value) keystoneScan.value = false;
  else { approval.invalidate(); keystoneOverlay.value = false; }
};

const decodePsbt = async (psbtHex: string, options: BtcSignPsbtOptions | undefined) => {
  try {
    const bitcoin = await import('bitcoinjs-lib');
    let psbt: Psbt;
    try { psbt = bitcoin.Psbt.fromHex(psbtHex); }
    catch { psbt = bitcoin.Psbt.fromBase64(psbtHex); }
    psbtInfo.value = {
      inputs: psbt.data.inputs.length,
      outputs: psbt.data.outputs.length,
      autoFinalized: options?.autoFinalized,
    };
  } catch {
    psbtInfo.value = { inputs: 0, outputs: 0, autoFinalized: options?.autoFinalized };
  }
};

onMounted(async () => {
  // This view is only ever opened inside a standalone popup window (see the
  // BITCOIN_METHOD.signPsbt(s) popup fallback in background.ts, which always
  // targets index.html) — never inside the side panel, which renders
  // DAppOverlay.vue instead. It must always speak the popup port protocol.
  // It used to branch on the now-retired Prompt Display Mode setting
  // instead, which connected the wrong port name and hung forever whenever
  // this fallback view was reached.
  controller.value = Messaging.createInternalController();

  try {
    request.value = await controller.value.requestData();
    const { psbtHex, options } = request.value?.data || {};
    if (psbtHex) await decodePsbt(psbtHex, options);
  } catch (e) {
    console.error('[BitcoinSignPsbt] Failed to get request data:', e);
  }

  document.title = 'Gero | Sign Bitcoin PSBT';
});
</script>

<style scoped>
.psbt-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 13px;
}
.psbt-label {
  color: rgba(255, 255, 255, 0.6);
}
.psbt-value {
  color: white;
  font-weight: 500;
}
</style>
