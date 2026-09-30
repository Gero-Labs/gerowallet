<template>
  <BaseDialog
    :is-open="isOpen"
    :title="t('cashback.signTitle')"
    :subtitle="t('cashback.signSubtitle')"
    icon="mdi-draw-pen"
    size="sm"
    :min-height="0"
    :loading="loading"
    @close="cancel"
  >
    <v-card-text class="pt-2 pb-0 px-5">
      <p class="t-caption mb-2">{{ t('cashback.signRequestedBy', { origin }) }}</p>
      <!-- The challenge, verbatim: the user approves exactly what the key signs. -->
      <div class="cashback-sign__message glass-tier g-mono t-body-sm" data-testid="cashback-sign-message">{{ message }}</div>
      <v-form ref="form" v-model="valid" class="mt-4" @submit.prevent>
        <PassKeyPasswordField
          v-if="usesPassword"
          ref="passwordField"
          :value="spendingPassword"
          @input="spendingPassword = $event"
          dense
          outlined
          hide-details
          :placeholder="t('navigation.typeYourSpendingPassword')"
          :label="t('wallet.spendingPassword')"
          :rules="[rules.required()]"
          :disabled="loading"
          required
          @enter="sign()"
          @passkey-autofill-success="sign()"
        />
        <PassKeyAuthButton
          v-else-if="isPrfWallet"
          :disabled="loading"
          block
          @success="signWithPassKey"
          @error="onPassKeyError"
        />
        <ToggleSwitch
          v-else-if="walletType === WalletType.Ledger"
          :text-left="t('wallet.usb')"
          icon-left="mdi-usb"
          :text-right="t('wallet.bluetooth')"
          icon-right="mdi-bluetooth"
          :value="isBluetooth"
          :disabled="loading"
          @input="isBluetooth = $event"
        />
        <v-alert v-else-if="walletType === WalletType.Trezor" type="info" color="primary" text dense class="my-0">
          {{ t('wallet.confirmOnTrezor') }}
        </v-alert>
        <v-alert v-else type="warning" text dense class="my-0" data-testid="cashback-sign-unsupported">
          {{ t('cashback.signUnsupportedWallet') }}
        </v-alert>
      </v-form>
    </v-card-text>
    <v-card-actions class="px-5 pb-5 pt-3">
      <v-btn block outlined color="error" :disabled="loading" data-testid="cashback-sign-cancel" @click="cancel">
        {{ t('common.cancel') }}
      </v-btn>
      <v-btn
        v-if="canSign"
        block
        class="geroButton"
        :loading="loading"
        :disabled="loading || (usesPassword && !valid)"
        data-testid="cashback-sign-confirm"
        @click="sign()"
      >
        {{ t('wallet.sign') }}
      </v-btn>
    </v-card-actions>
  </BaseDialog>
</template>
<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { Messaging, type BackgroundResponse, type SignDataResponse, type VerifyPasswordResponse } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { WalletType } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import hardwareLoading from '@/plugins/hardwareLoading';
import rules from '@/utils/rules';
import networks from '@/utils/networks';
import ledger from '@/shared/utils/ledger';
import { dispatchTrezor } from '@/shared/utils/trezorDispatch';
import { getErrorMessage } from '@/shared/utils/errorHandler';
import { signPayloadHex } from './portalBridge';

/**
 * Approval prompt for a Bring Cashback claim challenge.
 *
 * The portal's `SIGN_MESSAGE` is a first-party request from the wallet's own
 * dashboard page, not a dApp: it goes through the extension-owned `SIGN_DATA`
 * path (the same one the Strike flows use), never the CIP-30 `signData`
 * handler, which rightly refuses anything outside the connected-site allowlist.
 * Signing is a CIP-8 signature over the challenge with the payment key of the
 * base address the claim was initiated for. It moves no funds.
 */
export interface CashbackSignature {
  /** The `requestId` the prompt was showing when the user approved. */
  requestId: number;
  signature: string;
  key: string;
}

/** What the user approved, captured before any await so a request that
 *  replaces it mid-flight is neither signed nor answered with this approval. */
interface ApprovedRequest {
  requestId: number;
  address: string;
  payloadHex: string;
}

interface Props {
  isOpen: boolean;
  /** Identifies the request; echoed back in `signed` so the caller can drop a stale answer. */
  requestId: number;
  /** The challenge, verbatim from `claim-initiate`. */
  message: string;
  /** The bech32 base address the claim was initiated for. */
  address: string;
  /** The portal origin, shown so the user knows who is asking. */
  origin: string;
}
const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'signed', result: CashbackSignature): void;
  (e: 'close'): void;
}>();

const { t } = useTranslation();
const { loggedWallet, keys } = toRefs(walletStore);

const form = ref<{ validate: () => boolean; resetValidation: () => void } | null>(null);
const passwordField = ref<{ showError: (message: string) => void } | null>(null);
const spendingPassword = ref('');
const valid = ref(false);
const loading = ref(false);
const isBluetooth = ref(false);
/** The wallet the prompt opened for; a signature for any other wallet is never returned. */
let openedForWalletId: number | null = null;

const walletType = computed<string | undefined>(() => loggedWallet.value?.type);
const isPrfWallet = computed(() =>
  walletType.value === WalletType.Normal && (
    loggedWallet.value?.encryptionMethod === 'prf' ||
    (!!loggedWallet.value?.prfEncryptedPrivateKey && !!loggedWallet.value?.webAuthnCredentialId)
  ),
);
const usesPassword = computed(() => walletType.value === WalletType.Normal && !isPrfWallet.value);
const canSign = computed(() =>
  usesPassword.value || walletType.value === WalletType.Ledger || walletType.value === WalletType.Trezor,
);

// A new request, whether by opening or by replacing the one shown, starts from
// a clean prompt: nothing typed for the old challenge carries over.
watch(() => [props.isOpen, props.requestId] as const, ([open]) => {
  spendingPassword.value = '';
  valid.value = false;
  openedForWalletId = open ? (loggedWallet.value?.id ?? null) : null;
  form.value?.resetValidation();
});

function cancel() {
  if (loading.value) return;
  emit('close');
}

type Signed = Omit<CashbackSignature, 'requestId'>;

function finish(approved: ApprovedRequest, result: Signed) {
  if (loggedWallet.value?.id !== openedForWalletId) {
    snackbar.setError(t('cashback.signWalletChanged'));
    emit('close');
    return;
  }
  emit('signed', { requestId: approved.requestId, ...result });
}

function unwrapSignData(res: unknown): Signed {
  const response = res as { data?: { signature?: string; key?: string; error?: string }; error?: string } | undefined;
  if (response?.error) throw new Error(response.error);
  if (response?.data?.error) throw new Error(response.data.error);
  if (!response?.data?.signature || !response.data.key) throw new Error(t('cashback.signFailed'));
  return { signature: response.data.signature, key: response.data.key };
}

async function signWithPassword(approved: ApprovedRequest): Promise<Signed> {
  const verification = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.VERIFY_SPENDING_PASSWORD,
    data: { password: spendingPassword.value },
  }) as BackgroundResponse<VerifyPasswordResponse>;
  if (!verification?.data?.success) {
    passwordField.value?.showError(t('errors.wrongPassword'));
    throw new Error(t('errors.wrongPassword'));
  }
  return unwrapSignData(await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.SIGN_DATA,
    data: { address: approved.address, payload: approved.payloadHex, password: spendingPassword.value, accountIndex: 0, isUsb: false },
  }));
}

async function signWithLedger(approved: ApprovedRequest): Promise<Signed> {
  const network = networks.resolveNetwork(loggedWallet.value.chain, loggedWallet.value.network);
  hardwareLoading.begin('Ledger', t('wallet.ledgerPleaseConfirmDevice') as string);
  try {
    const known = ledger.createKnownAddressesFromKeys(keys.value, network);
    const signed = await ledger.signData(approved.address, approved.payloadHex, network, 0, !isBluetooth.value, known);
    return { signature: signed.signatureHex, key: signed.signingPublicKeyHex };
  } finally {
    hardwareLoading.end();
  }
}

async function signWithTrezor(approved: ApprovedRequest): Promise<Signed> {
  const data = { method: 'signData', address: approved.address, payload: approved.payloadHex, accountIndex: 0 };
  hardwareLoading.begin('Trezor', t('wallet.confirmOnTrezor') as string);
  try {
    const response = (featureFlagsStore.state.flags.isTrezorWebUsbEnabled
      ? await dispatchTrezor(data)
      : await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.TREZOR, data })) as BackgroundResponse<SignDataResponse>;
    if (!response?.data?.success) throw new Error(response?.data?.error || t('wallet.trezorSigningFailed'));
    return { signature: response.data.signatureData.signatureHex, key: response.data.signatureData.signingPublicKeyHex };
  } finally {
    hardwareLoading.end();
  }
}

async function run(signer: (approved: ApprovedRequest) => Promise<Signed>) {
  if (loading.value) return;
  // Snapshot what is on screen now: this is what the user approved.
  const approved: ApprovedRequest = {
    requestId: props.requestId,
    address: props.address,
    payloadHex: signPayloadHex(props.message),
  };
  loading.value = true;
  try {
    finish(approved, await signer(approved));
  } catch (error: unknown) {
    console.error('Cashback claim signing failed:', error);
    snackbar.setError(getErrorMessage(error, t('cashback.signFailed')));
  } finally {
    loading.value = false;
  }
}

async function sign() {
  if (usesPassword.value) {
    if (!form.value?.validate()) return;
    await run(signWithPassword);
  } else if (walletType.value === WalletType.Ledger) {
    await run(signWithLedger);
  } else if (walletType.value === WalletType.Trezor) {
    await run(signWithTrezor);
  }
}

async function signWithPassKey(privateKeyBytes: Uint8Array) {
  await run(async approved => {
    try {
      return unwrapSignData(await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SIGN_DATA,
        data: { address: approved.address, payload: approved.payloadHex, password: '', privateKeyBytes: Array.from(privateKeyBytes), accountIndex: 0, isUsb: false },
      }));
    } finally {
      privateKeyBytes.fill(0);
    }
  });
}

function onPassKeyError(error: Error) {
  snackbar.setError(error.message || t('security.passKeyAuthFailed'));
}
</script>
<style scoped lang="scss">
.cashback-sign__message {
  max-height: 160px;
  overflow-y: auto;
  padding: var(--g-s-3);
  border-radius: var(--g-r-control);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
