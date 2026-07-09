<template>
  <v-form ref="form" v-model="valid" class="fill-height">
    <PopupHeader :title="t('midnight.connector.signData')" :disabled="loading">
      <v-card-text class="d-flex flex-column align-content-space-between pa-0 fill-height">
        <v-card-title class="pa-0" style="color: white; font-size: 14px">
          {{ t('midnight.connector.websiteRequestedSignature') }}
        </v-card-title>
        <v-card flat outlined style="background-color: #141414!important;flex: 1 1 auto; overflow-y: auto; max-height: 100%; height: 0;" class="pa-2" height="157">
          <v-card flat class="overflow-y-auto transparent" height="143">
            <v-card-text class="dapp-sign-details pa-0">
              <div class="encoding-badge">{{ encodingLabel }}</div>
              <template v-if="decodeError">
                <span class="decode-error">{{ t('midnight.connector.malformedSignData') }}</span>
              </template>
              <template v-else>{{ message }}</template>
            </v-card-text>
          </v-card>
        </v-card>
      </v-card-text>
      <v-card-actions class="justify-center pb-0 pt-3 px-0">
        <v-layout>
          <v-row>
            <v-col cols="12" class="pb-0">
              <!-- PRF wallets: TransactionAuthSection renders the PassKey
                   button and, on success, gives us raw PRF bytes directly
                   via @passkey-prf-output — we sign immediately from there,
                   same pattern as MidnightSendDialog.vue. Password wallets:
                   it renders the password field only; the explicit Sign
                   button below triggers submit. -->
              <TransactionAuthSection
                :wallet-type="loggedWallet?.type"
                :is-prf-wallet="isPrfWallet"
                :is-signed="false"
                :loading="loading || !!decodeError"
                :password="spendingPassword"
                @update:password="spendingPassword = $event"
                :password-label="t('wallet.spendingPassword')"
                :password-rules="passwordRules"
                :submit-text="t('wallet.sign')"
                @passkey-prf-output="onPasskeyPrfOutput"
                @passkey-error="onPasskeyError"
                @submit="sign"
                button-style="width: 100%; margin-bottom: 1px;"
                button-class="mb-2"
              />
            </v-col>
            <v-col :cols="isPrfWallet ? 12 : 6">
              <v-btn block outlined color="red" style="text-transform: capitalize;" @click="decline" :disabled="loading">
                {{ t('navigation.decline') }}
              </v-btn>
            </v-col>
            <v-col cols="6" v-if="!isPrfWallet">
              <v-btn
                block
                class="geroButton"
                style="color: black!important;"
                @click="sign"
                :loading="loading"
                :disabled="!valid || loading || !!decodeError">
                {{ t('wallet.sign') }}
              </v-btn>
            </v-col>
          </v-row>
        </v-layout>
      </v-card-actions>
    </PopupHeader>
  </v-form>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, onMounted, ref, toRefs } from 'vue';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';
import { Messaging } from '@/chrome/messaging';
import { MidnightErrorCode } from '@/chrome/config';
import { MessageTypes } from '@/models/MessageTypes';
import { WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import snackbar from '@/plugins/snackbar';
import rules from '@/utils/rules';
import { decodedPayloadHexPreview, type MidnightSignDataEncoding } from '@/chrome/midnightSignDataCodec';

const { t } = useTranslation();

const { loggedWallet, config } = toRefs(walletStore);
const passwordRules = [rules.required()];

const spendingPassword = ref('');
const request = ref<{ data?: { data: string; options: { encoding: string; keyType: string } } } | null>(null);
const message = ref('');
const encodingLabel = ref('');
// Set when the dapp-supplied (data, encoding) pair fails strict decoding —
// blocks signing entirely rather than risk showing a preview that doesn't
// match what would actually get signed (see midnightSignDataCodec.ts).
const decodeError = ref(false);
const valid = ref(false);
const loading = ref(false);
const controller = ref(null);
const tabId = ref<number | null>(null);
const form = ref(null);

const useSidePanel = computed(() => config.value?.useSidePanel);

const isPrfWallet = computed(() =>
  loggedWallet.value?.type === WalletType.Normal &&
  (loggedWallet.value?.encryptionMethod === 'prf' || !!loggedWallet.value?.webAuthnCredentialId)
);

const decline = async () => {
  await controller.value.returnData({
    data: undefined,
    error: { type: 'DAppConnectorAPIError', code: MidnightErrorCode.Rejected, reason: 'User declined the signing request', message: 'User declined the signing request' },
  });
  window.close();
};

async function signWithCredentials(password?: string, prfSecret?: Uint8Array) {
  loading.value = true;
  try {
    const res = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_MIDNIGHT_CONNECTOR_DATA,
      data: {
        data: request.value?.data?.data,
        options: request.value?.data?.options,
        password,
        prfSecret: prfSecret ? Array.from(prfSecret) : undefined,
      },
    }) as { data: { success: boolean; signature?: unknown; error?: string } };

    if (!res?.data?.success) {
      throw new Error(res?.data?.error || 'Failed to sign data');
    }
    await controller.value.returnData({ data: res.data.signature, error: undefined });
    window.close();
  } catch (e: unknown) {
    console.error('[MidnightDappSignData] Error:', e);
    snackbar.setError(e instanceof Error ? e.message : String(e));
  } finally {
    loading.value = false;
  }
}

const sign = async () => {
  if (isPrfWallet.value) return; // handled by onPasskeyPrfOutput
  if (!form.value?.validate()) return;
  await signWithCredentials(spendingPassword.value, undefined);
};

async function onPasskeyPrfOutput(prfBytes: Uint8Array) {
  if (!isPrfWallet.value) return;
  await signWithCredentials(undefined, prfBytes);
}

function onPasskeyError(error: Error) {
  console.error('[MidnightDappSignData] PassKey error:', error);
  snackbar.setError(error?.message || t('security.passKeyAuthFailed'));
}

onMounted(async () => {
  if (useSidePanel.value) {
    const params = new URLSearchParams(window.location.href);
    tabId.value = Number(params.get('tabId'));
    controller.value = Messaging.createInternalSidePanelController(tabId.value);
  } else {
    controller.value = Messaging.createInternalController();
  }

  try {
    const requestData = await controller.value.requestData();
    request.value = requestData;
    const encoding = (requestData?.data?.options?.encoding ?? 'text') as MidnightSignDataEncoding;
    encodingLabel.value = encoding;
    const raw = requestData?.data?.data ?? '';
    if (encoding === 'text') {
      // For text, the raw string IS what gets UTF-8 encoded — no decode step,
      // no truncation risk, so showing it directly is both safe and clearer
      // than a hex dump.
      message.value = raw;
    } else {
      // For hex/base64, show the ACTUAL bytes that will be signed (strictly
      // decoded, re-rendered as hex) — never the raw un-decoded wire string.
      // Buffer.from(str,'hex'|'base64') silently truncates/skips invalid
      // characters instead of throwing, so displaying the raw string here
      // could show the user a long, plausible string while a malicious dapp
      // gets only a short, attacker-chosen prefix actually signed. Reject
      // outright on malformed input rather than render a partial preview.
      try {
        message.value = `0x${decodedPayloadHexPreview(raw, encoding)}`;
      } catch (decodeErr) {
        console.error('[MidnightDappSignData] Malformed signData payload:', decodeErr);
        decodeError.value = true;
      }
    }
  } catch (e) {
    console.error('[MidnightDappSignData] Error initializing:', e);
  }

  document.title = 'Gero Dashboard | Sign Data';
});
</script>
<style scoped>
.dapp-sign-details {
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  line-height: 20px;
  word-wrap: break-word;
  white-space: pre-line;
  color: white !important;
}
.encoding-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: #00DFF3;
  background: rgba(0, 223, 243, 0.1);
  border-radius: 4px;
  padding: 2px 6px;
  margin-bottom: 6px;
}
.decode-error {
  color: #F97066;
  font-weight: 600;
}
</style>
