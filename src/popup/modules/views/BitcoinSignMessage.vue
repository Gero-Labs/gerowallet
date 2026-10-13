<template>
  <v-form ref="form" v-model="valid" class="fill-height">
    <PopupHeader :title="$t('bitcoin.signMessage')" :show-website="hasWebsite" :disabled="loading">
      <v-card-text class="d-flex flex-column pa-0 fill-height">
        <EmbeddedSiteWarning class="mb-2" :embedded-in="request?.embeddedIn" />
        <v-card-title class="pa-0 mb-2" style="color: white; font-size: 14px">
          {{ $t('bitcoin.signMessageRequest') }}
        </v-card-title>

        <!-- Signing type badge -->
        <div class="mb-2">
          <v-chip size="x-small" color="orange darken-2" text-color="white">
            {{ signingType === 'bip322-simple' ? 'BIP-322' : 'ECDSA' }}
          </v-chip>
        </div>

        <!-- Message content -->
        <v-card flat variant="outlined" style="background-color: #141414!important; flex: 1 1 auto; overflow-y: auto; max-height: 120px;" class="pa-2 mb-3">
          <v-card-text class="btc-message-text pa-0">{{ messageText }}</v-card-text>
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
              <v-btn v-else block class="geroButton" style="color: black!important;" @click="sign" :disabled="loading" :loading="loading">
                {{ $t('common.confirm') }}
              </v-btn>
            </v-col>

            <!-- Hardware wallets: not supported for message signing -->
            <v-col cols="12" v-else class="pb-0">
              <v-alert type="warning" density="compact" variant="text" border="start" class="py-1 my-0">
                <span style="font-size: 12px">{{ $t('bitcoin.hardwareMessageSigningNotSupported') }}</span>
              </v-alert>
            </v-col>

            <!-- Decline / Sign -->
            <v-col :cols="isPrfWallet ? 12 : 6">
              <v-btn block variant="outlined" color="error" style="text-transform: capitalize;" @click="decline">
                {{ $t('common.decline') }}
              </v-btn>
            </v-col>
            <v-col cols="6" v-if="!isPrfWallet && isNormalWallet">
              <v-btn block class="geroButton" style="color: black!important;" @click="sign" :loading="loading" :disabled="!valid || loading">
                {{ $t('wallet.sign') }}
              </v-btn>
            </v-col>
          </v-row>
        </div>
      </v-card-actions>
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

/** What the background hands this popup (see BITCOIN_METHOD.signMessage). */
interface BtcSignMessageRequest {
  /** Browser-derived embedding site, set by the background. */
  embeddedIn?: string | null;
  data?: { message?: string; type?: 'ecdsa' | 'bip322-simple' };
}
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import snackbar from '@/plugins/snackbar';
import { toRefs } from 'vue';

const { t } = useTranslation();
const vmProxy = getCurrentInstance()!.proxy;
const { loggedWallet } = toRefs(walletStore);

const form = ref(null);
const valid = ref(false);
const loading = ref(false);
const spendingPassword = ref('');
const privateKeyBytes = ref<Uint8Array | null>(null);
const controller = ref(null);
const request = ref<BtcSignMessageRequest | null>(null);
const messageText = ref('');
const signingType = ref<'ecdsa' | 'bip322-simple'>('ecdsa');
const signed = ref(false);

const hasWebsite = computed(() => {
  const q = vmProxy.$route?.query;
  return !(q?.['website'] === 'undefined' || !q || Object.keys(q).length === 0);
});

const isNormalWallet = computed(() => loggedWallet.value?.type === WalletType.Normal);
const isPrfWallet = computed(() =>
  loggedWallet.value?.encryptionMethod === 'prf' ||
  (!!loggedWallet.value?.prfEncryptedPrivateKey && !!loggedWallet.value?.webAuthnCredentialId)
);


const approval = useApprovalFreshness(
  () => [request.value, loggedWallet.value?.id, loggedWallet.value?.chain, loggedWallet.value?.network, loggedWallet.value?.webAuthnCredentialId, loggedWallet.value?.encryptionMethod],
  () => !!request.value && !!loggedWallet.value && !walletStore.isLocked,
  () => { privateKeyBytes.value?.fill(0); privateKeyBytes.value = null; signed.value = false; },
);
const handlePassKeyAuthSuccess = (pkBytes: Uint8Array) => {
  const approvalCurrent = approval.capture();
  privateKeyBytes.value = pkBytes;
  setTimeout(() => approvalCurrent() && sign(), 300);
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

const sign = () => approval.run(async () => {
  const approvalCurrent = approval.capture();
  if (!approvalCurrent()) return;
  if (signed.value) {
    // Already signed — confirm was already done in handlePassKeyAuthSuccess path
    return;
  }

  loading.value = true;
  try {
    const signingData: { message?: string; type: 'ecdsa' | 'bip322-simple'; privateKeyBytes?: number[]; password?: string } = {
      message: request.value.data.message,
      type: signingType.value,
    };

    if (isPrfWallet.value && privateKeyBytes.value) {
      signingData.privateKeyBytes = Array.from(privateKeyBytes.value);
    } else {
      if (!(await awaitFreshApproval(async () => (form.value?.validate()), approvalCurrent))?.valid) { loading.value = false; return; }
      signingData.password = spendingPassword.value;
    }

    const response = await awaitFreshApproval(async () => (Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.BITCOIN_DAPP_SIGN_MESSAGE,
      data: signingData,
    })), approvalCurrent) as { data: { success: boolean; error?: string; signature?: string } };

    if (!response.data.success) throw new Error(response.data.error || 'Signing failed');

    await awaitFreshApproval(async () => (controller.value.returnData({ data: response.data.signature })), approvalCurrent);
    window.close();
  } catch (e: unknown) {
    if (e instanceof StaleApprovalError) return;
    snackbar.setError(getErrorMessage(e, 'Failed to sign message') || 'Failed to sign message');
    loading.value = false;
  }
});

onMounted(async () => {
  // This view is only ever opened inside a standalone popup window (see the
  // BITCOIN_METHOD.signMessage popup fallback in background.ts, which always
  // targets index.html) — never inside the side panel, which renders
  // DAppOverlay.vue instead. It must always speak the popup port protocol.
  // It used to branch on the now-retired Prompt Display Mode setting
  // instead, which connected the wrong port name and hung forever whenever
  // this fallback view was reached.
  controller.value = Messaging.createInternalController();

  try {
    request.value = await controller.value.requestData();
    messageText.value = request.value?.data?.message ?? '';
    signingType.value = request.value?.data?.type ?? 'ecdsa';
  } catch (e) {
    console.error('[BitcoinSignMessage] Failed to get request data:', e);
  }

  document.title = 'Gero | Sign Bitcoin Message';
});
</script>

<style scoped>
.btc-message-text {
  font-size: 14px;
  font-weight: 400;
  text-align: left;
  line-height: 1.5;
  word-wrap: break-word;
  white-space: pre-wrap;
  color: white !important;
}
</style>
