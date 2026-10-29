<template>
  <v-form ref="form" v-model="valid" class="fill-height">
    <PopupHeader :title="$t('bitcoin.signMessage')" :show-website="hasWebsite" :disabled="loading">
      <v-card-text class="d-flex flex-column pa-0 fill-height">
        <EmbeddedSiteWarning class="mb-2" :embedded-in="request?.embeddedIn" />
        <div class="btc-message__head">
          <p class="t-body-lg btc-message__title">{{ $t('bitcoin.signMessageRequest') }}</p>
          <!-- The signature scheme, named like a transaction tag (neutral, not painted) -->
          <span class="btc-message__scheme">{{ signingType === 'bip322-simple' ? 'BIP-322' : 'ECDSA' }}</span>
        </div>

        <!-- The message is a read-only control: solid raised fill so long text stays legible -->
        <div class="btc-message__text">{{ messageText }}</div>
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
                @prf-output="handlePrfOutput"
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
/**
 * The PassKey's raw PRF output: the Bitcoin signer decrypts the recovery phrase with it
 * (WalletBg.signBitcoinDappMessage). PassKeyAuthButton emits it as `prf-output` just before `success`,
 * whose PRF-decrypted private key cannot open the phrase and is wiped on arrival.
 */
const prfOutput = ref<Uint8Array | null>(null);
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
  () => { prfOutput.value?.fill(0); prfOutput.value = null; signed.value = false; },
);
// A copy: the button's array is a view over the buffer it goes on to decrypt with.
const handlePrfOutput = (bytes: Uint8Array) => {
  prfOutput.value?.fill(0);
  prfOutput.value = new Uint8Array(bytes);
};

const handlePassKeyAuthSuccess = (decryptedKey: Uint8Array) => {
  decryptedKey.fill(0);
  if (!prfOutput.value) {
    snackbar.setError(t('security.passKeyAuthFailed'));
    return;
  }
  const approvalCurrent = approval.capture();
  setTimeout(() => approvalCurrent() && sign(), 300);
};

const handlePassKeyAuthError = (error: Error) => {
  snackbar.setError(error.message || t('security.passKeyAuthFailed'));
  prfOutput.value?.fill(0);
  prfOutput.value = null;
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

    // `privateKeyBytes` is the wire name the background reads the raw PRF output under.
    if (isPrfWallet.value && prfOutput.value) {
      signingData.privateKeyBytes = Array.from(prfOutput.value);
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
    if (e instanceof StaleApprovalError) { loading.value = false; return; }
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
.btc-message__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
  margin-bottom: var(--g-s-2);
}

.btc-message__title {
  margin: 0;
}

.btc-message__scheme {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border: 1px solid var(--g-hairline-3);
  border-radius: var(--g-r-chip);
  color: var(--g-text-2);
  font-size: 11px;
  font-weight: 500;
}

.btc-message__text {
  flex: 1 1 auto;
  max-height: 120px;
  margin-bottom: var(--g-s-3);
  overflow-y: auto;
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  color: var(--g-text-1);
  font-size: 14px;
  line-height: 1.5;
  text-align: left;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
