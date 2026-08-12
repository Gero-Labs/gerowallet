<template>
  <v-form ref="form" v-model="valid" class="fill-height">
    <PopupHeader :title="$t('bitcoin.signPsbt')" :show-website="hasWebsite" :disabled="loading">
      <v-card-text class="d-flex flex-column pa-0 fill-height">
        <v-card-title class="pa-0 mb-2" style="color: white; font-size: 14px">
          {{ $t('bitcoin.signPsbtRequest') }}
        </v-card-title>

        <!-- PSBT summary -->
        <v-card flat outlined style="background-color: #141414!important;" class="pa-2 mb-3">
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
        <v-layout>
          <v-row>
            <!-- Password field for normal wallets -->
            <v-col cols="12" v-if="isNormalWallet && !isPrfWallet" class="pb-0">
              <PassKeyPasswordField
                ref="passwordField"
                :value="spendingPassword"
                @input="spendingPassword = $event"
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
                <ToggleSwitch :text-left="$t('wallet.usb')" icon-left="mdi-usb" :text-right="$t('wallet.bluetooth')" icon-right="mdi-bluetooth" :value="isBT" @input="isBT = $event" :disabled="loading" />
              </v-card-subtitle>
            </v-col>

            <!-- Trezor -->
            <v-col cols="12" v-else-if="isTrezor" class="pb-0">
              <v-alert type="info" color="primary" text border="left" dense class="py-1 my-0">
                <span style="color: white; font-size: 12px">{{ $t('wallet.confirmOnTrezor') }}</span>
              </v-alert>
            </v-col>

            <!-- Keystone -->
            <v-col cols="12" v-else-if="isKeystone" class="pb-0">
              <v-alert type="info" color="primary" text border="left" dense class="py-1 my-0">
                <span style="color: white; font-size: 12px">{{ $t('wallet.scanQRWithKeystone') }}</span>
              </v-alert>
            </v-col>

            <!-- Decline / Sign -->
            <v-col :cols="isPrfWallet ? 12 : 6">
              <v-btn block outlined color="error" style="text-transform: capitalize;" @click="decline" :disabled="loading">
                {{ $t('common.decline') }}
              </v-btn>
            </v-col>
            <v-col cols="6" v-if="!isPrfWallet">
              <v-btn block class="geroButton" style="color: black!important;" @click="sign" :loading="loading" :disabled="!canSign || loading">
                {{ $t('wallet.sign') }}
              </v-btn>
            </v-col>
          </v-row>
        </v-layout>
      </v-card-actions>

      <!-- Keystone QR overlay -->
      <v-overlay :absolute="true" opacity="0.99" :value="keystoneOverlay" class="hardwareOverlay">
        <v-alert color="white" dense outlined type="info" border="left" v-if="!keystoneScan" class="mt-2 mb-2" prominent>
          <b style="font-size: 12px">{{ $t('wallet.instructions') }}</b>
          <ul class="text-left" style="line-height: 1.3; font-size: 11px; margin-top: 4px; padding-left: 10px;">
            <li>{{ $t('wallet.unlockKeystone') }}</li>
            <li>{{ $t('wallet.selectScanQR') }} <v-icon x-small>mdi-line-scan</v-icon></li>
            <li>{{ $t('wallet.useKeystoneToScan') }}</li>
            <li>{{ $t('wallet.approveAndScanNext') }}</li>
          </ul>
        </v-alert>
        <v-alert color="white" dense outlined type="info" border="left" v-else class="mt-2 mb-2" prominent>
          <b style="font-size: 12px">{{ $t('wallet.scanQRCode') }}</b>
        </v-alert>
        <div v-if="!keystoneScan && keystoneCbor" style="max-width: 286px; margin: 0 auto;">
          <AnimatedQRCode :type="keystoneType" :cbor="keystoneCbor" :size="286" :capacity="100" />
        </div>
        <div v-else-if="keystoneScan">
          <AnimatedQRScanner purpose="sign" :urTypes="['crypto-psbt']" width="100%" height="220px" @scan="onKeystoneScan" @error="onKeystoneError" />
        </div>
        <div class="text-center pt-2">
          <v-btn text small @click="backKeystoneScan" class="mr-2">
            {{ keystoneScan ? $t('common.back') : $t('common.cancel') }}
          </v-btn>
          <v-btn v-if="!keystoneScan" small class="geroButton" style="color: black!important;" @click="keystoneScan = true">
            {{ $t('common.next') }}
          </v-btn>
        </div>
      </v-overlay>
    </PopupHeader>
  </v-form>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, onMounted, ref } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import rules from '@/utils/rules';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import AnimatedQRCode from '@/shared/components/AnimatedQRCode.vue';
import AnimatedQRScanner from '@/shared/components/AnimatedQRScanner.vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { WalletType } from '@/models/types';
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
const passwordField = ref(null);
const privateKeyBytes = ref<Uint8Array | null>(null);
const controller = ref(null);
const request = ref<any>(null);
const signed = ref(false);
const signedHex = ref('');
const isBT = ref(false);

// Keystone state
const keystoneOverlay = ref(false);
const keystoneScan = ref(false);
const keystoneType = ref('');
const keystoneCbor = ref('');

const psbtInfo = ref({ inputs: 0, outputs: 0, autoFinalized: undefined as boolean | undefined });

const hasWebsite = computed(() => {
  const q = vmProxy.$route?.query;
  return !(q?.website === 'undefined' || !q || Object.keys(q).length === 0);
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

const handlePassKeyAuthSuccess = async (pkBytes: Uint8Array) => {
  privateKeyBytes.value = pkBytes;
  await doSign();
};

const handlePassKeyAuthError = (error: Error) => {
  snackbar.setError(error.message || t('security.passKeyAuthFailed'));
  privateKeyBytes.value = null;
};

const decline = async () => {
  await controller.value.returnData({ error: { code: 4001, message: 'User rejected the request' } });
  window.close();
};

const returnSigned = async () => {
  await controller.value.returnData({ data: signedHex.value });
  window.close();
};

const doSign = async () => {
  loading.value = true;
  try {
    const { psbtHex, options } = request.value.data;
    const signingData: any = { psbtHex, options };

    if (isPrfWallet.value && privateKeyBytes.value) {
      signingData.privateKeyBytes = Array.from(privateKeyBytes.value);
    } else {
      signingData.password = spendingPassword.value;
    }

    const response: any = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.BITCOIN_DAPP_SIGN_PSBT,
      data: signingData,
    });

    if (!response.data.success) throw new Error(response.data.error || 'Signing failed');

    signedHex.value = response.data.signedHex;
    signed.value = true;

    // Auto-confirm (txAutoSubmit or after PRF)
    await controller.value.returnData({ data: signedHex.value });
    window.close();
  } catch (e: any) {
    snackbar.setError(e.message || 'Failed to sign PSBT');
    loading.value = false;
  }
};

const sign = async () => {
  if (isNormalWallet.value) {
    if (isPrfWallet.value) {
      // PRF handled by PassKeyAuthButton → handlePassKeyAuthSuccess
      return;
    }
    if (!form.value?.validate()) return;
    await doSign();
  } else if (isLedger.value) {
    await signWithLedger();
  } else if (isTrezor.value) {
    await signWithTrezor();
  } else if (isKeystone.value) {
    await showKeystoneQR();
  }
};

const signWithLedger = async () => {
  loading.value = true;
  // The device holds the PSBT on its own screen; without this the view shows
  // only a spinner that cannot resolve until the user acts on it.
  hardwareLoading.begin('Ledger', t('wallet.ledgerPleaseConfirmDevice') as string);
  try {
    const { signPsbtWithLedger } = await import('@/chains/bitcoin/bitcoinHardwareSigner');
    const result = await signPsbtWithLedger(
      request.value.data.psbtHex,
      loggedWallet.value.publicKey,
      loggedWallet.value.network,
      loggedWallet.value.addressType,
      !isBT.value
    );
    if (!result.success || !result.signedPsbtHex) throw new Error(result.error || 'Ledger signing failed');

    const options = request.value.data.options;
    let returnHex = result.signedPsbtHex;
    if (options?.autoFinalized !== false) {
      // Finalize in browser context
      const bitcoin = await import('bitcoinjs-lib');
      const { getBitcoinNetwork } = await import('@/chains/bitcoin/bitcoinPsbtBuilder');
      const network = getBitcoinNetwork(loggedWallet.value.network);
      const psbt = bitcoin.Psbt.fromHex(result.signedPsbtHex, { network });
      psbt.finalizeAllInputs();
      returnHex = psbt.extractTransaction().toHex();
    }

    await controller.value.returnData({ data: returnHex });
    window.close();
  } catch (e: any) {
    snackbar.setError(e.message || t('wallet.ledgerDeviceError', { message: '' }));
    loading.value = false;
  } finally {
    hardwareLoading.end();
  }
};

const signWithTrezor = async () => {
  loading.value = true;
  // Trezor reports no intermediate stages, so this one label covers the whole
  // call — connecting through the confirmation it is waiting on.
  hardwareLoading.begin('Trezor', t('wallet.confirmOnTrezor') as string);
  try {
    const { signPsbtWithTrezor } = await import('@/chains/bitcoin/bitcoinHardwareSigner');
    const result = await signPsbtWithTrezor(
      request.value.data.psbtHex,
      loggedWallet.value.addressType,
      loggedWallet.value.network
    );
    if (!result.success || !result.signedPsbtHex) throw new Error(result.error || 'Trezor signing failed');

    const options = request.value.data.options;
    let returnHex = result.signedPsbtHex;
    if (options?.autoFinalized !== false) {
      const bitcoin = await import('bitcoinjs-lib');
      const { getBitcoinNetwork } = await import('@/chains/bitcoin/bitcoinPsbtBuilder');
      const network = getBitcoinNetwork(loggedWallet.value.network);
      const psbt = bitcoin.Psbt.fromHex(result.signedPsbtHex, { network });
      psbt.finalizeAllInputs();
      returnHex = psbt.extractTransaction().toHex();
    }

    await controller.value.returnData({ data: returnHex });
    window.close();
  } catch (e: any) {
    snackbar.setError(e.message || t('wallet.trezorSigningFailed'));
    loading.value = false;
  } finally {
    hardwareLoading.end();
  }
};

const showKeystoneQR = async () => {
  try {
    const { generateKeystonePsbtQR } = await import('@/chains/bitcoin/bitcoinHardwareSigner');
    const result = await generateKeystonePsbtQR(request.value.data.psbtHex);
    if (!result.success) throw new Error(result.error || 'QR generation failed');
    keystoneType.value = result.keystoneQrType!;
    keystoneCbor.value = result.keystoneQrCbor!;
    keystoneOverlay.value = true;
    keystoneScan.value = false;
  } catch (e: any) {
    snackbar.setError(e.message || 'Failed to generate Keystone QR code');
  }
};

const onKeystoneScan = async (ur: UR) => {
  try {
    const { parseKeystoneSignedPsbt } = await import('@/chains/bitcoin/bitcoinHardwareSigner');
    const result = await parseKeystoneSignedPsbt(ur, request.value.data.psbtHex, loggedWallet.value.network);
    if (!result.success || !result.signedPsbtHex) throw new Error(result.error || 'Failed to parse Keystone signature');

    keystoneOverlay.value = false;
    keystoneScan.value = false;

    const options = request.value.data.options;
    let returnHex = result.signedPsbtHex;
    if (options?.autoFinalized !== false) {
      const bitcoin = await import('bitcoinjs-lib');
      const { getBitcoinNetwork } = await import('@/chains/bitcoin/bitcoinPsbtBuilder');
      const network = getBitcoinNetwork(loggedWallet.value.network);
      const psbt = bitcoin.Psbt.fromHex(result.signedPsbtHex, { network });
      psbt.finalizeAllInputs();
      returnHex = psbt.extractTransaction().toHex();
    }

    await controller.value.returnData({ data: returnHex });
    window.close();
  } catch (e: any) {
    snackbar.setError(e.message || t('wallet.keystoneQRScanError'));
    keystoneOverlay.value = false;
    keystoneScan.value = false;
  }
};

const onKeystoneError = (error: string) => {
  snackbar.setError(error || t('wallet.keystoneScanError'));
};

const backKeystoneScan = () => {
  if (keystoneScan.value) keystoneScan.value = false;
  else keystoneOverlay.value = false;
};

const decodePsbt = async (psbtHex: string, options: any) => {
  try {
    const bitcoin = await import('bitcoinjs-lib');
    let psbt: any;
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
