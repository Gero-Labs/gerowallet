<template>
  <BaseDialog
    :is-open="isOpen"
    :title="t('security.mpcRevealTitle')"
    :subtitle="t('security.mpcRevealSubtitle')"
    :width="480"
    :min-height="0"
    icon="mdi-key-alert-outline"
    :loading="busy"
    @close="handleClose"
  >
    <v-card-text class="px-3 pb-4">
      <v-alert type="warning" text dense class="mb-4">
        {{ t('security.mpcRevealWarning') }}
      </v-alert>

      <!-- Pre-reveal: require re-auth -->
      <template v-if="!mnemonic">
        <v-alert v-if="errorMessage" type="error" text dense class="mb-2">
          {{ errorMessage }}
        </v-alert>

        <!-- Re-auth, one gesture per step: Google sign-in first (its own click,
             so the browser popup isn't blocked), then the device secret. -->
        <template v-if="!googleIdToken">
          <v-btn block outlined :loading="signingInGoogle" @click="handleGoogleSignIn">
            <v-avatar size="18" class="mr-2">
              <v-img :src="assets.google" contain />
            </v-avatar>
            {{ t('welcome.googleSignInButton') }}
          </v-btn>
        </template>
        <template v-else-if="isMpcPasskeyWallet && !passkeySecret">
          <v-btn block outlined color="primary" :loading="verifyingPasskey" @click="handleVerifyPasskey">
            <v-icon left small>mdi-fingerprint</v-icon>
            {{ t('security.usePassKey') }}
          </v-btn>
        </template>
        <template v-else>
          <v-text-field
            v-if="!isMpcPasskeyWallet"
            v-model="devicePassword"
            :label="t('security.spendingPassword')"
            :type="showDevicePw ? 'text' : 'password'"
            :append-icon="showDevicePw ? 'mdi-eye-off' : 'mdi-eye'"
            @click:append="showDevicePw = !showDevicePw"
            outlined
            dense
            :disabled="busy"
            class="mb-2"
            @keydown.enter.stop="reveal"
          />
          <v-btn block color="primary" :loading="revealing" :disabled="!canReveal" @click="reveal">
            {{ t('security.mpcRevealAction') }}
          </v-btn>
        </template>
      </template>

      <!-- Post-reveal: shown once, never persisted -->
      <template v-else>
        <div class="phrase-box pa-3 rounded" :class="{ blurred: !revealed }">
          <span v-for="(word, i) in words" :key="i" class="mr-2 mb-1 d-inline-block">
            <span class="text--secondary caption mr-1">{{ i + 1 }}.</span>{{ word }}
          </span>
        </div>
        <div class="d-flex justify-space-between align-center mt-2">
          <v-btn small text color="primary" @click="revealed = !revealed">
            <v-icon left small>{{ revealed ? 'mdi-eye-off' : 'mdi-eye' }}</v-icon>
            {{ revealed ? t('security.mpcRevealHide') : t('security.mpcRevealShow') }}
          </v-btn>
          <CopyButton :value="mnemonic" x-small />
        </div>
        <v-btn block outlined color="primary" class="mt-4" @click="handleClose">
          {{ t('security.mpcRevealDone') }}
        </v-btn>
      </template>
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { Messaging, BackgroundResponse } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { evaluateMpcPasskeyViaPopup, MpcPasskeySecret } from '@/shared/composables/useMpcPasskeyPopup';
import assets from '@/utils/assets';

const { t } = useTranslation();
defineProps<{ isOpen: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const errorMessage = ref('');
const mnemonic = ref('');   // held in-memory only; never persisted/logged
const revealed = ref(false);
const devicePassword = ref('');
const showDevicePw = ref(false);
const revealing = ref(false);

// Re-auth state — never logged.
const googleIdToken = ref('');
const signingInGoogle = ref(false);
const passkeySecret = ref<MpcPasskeySecret | null>(null);
const verifyingPasskey = ref(false);

const busy = computed(() => signingInGoogle.value || verifyingPasskey.value || revealing.value);

const words = computed(() => (mnemonic.value ? mnemonic.value.split(' ') : []));
const isMpcPasskeyWallet = computed(() =>
  !!walletStore.loggedWallet?.webAuthnCredentialId && !!walletStore.loggedWallet?.mpcPrfSaltId,
);
const canReveal = computed(() =>
  !busy.value
  && !!googleIdToken.value
  && (isMpcPasskeyWallet.value ? !!passkeySecret.value : devicePassword.value.length > 0),
);

async function handleGoogleSignIn() {
  signingInGoogle.value = true;
  errorMessage.value = '';
  try {
    const resp = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_WITH_GOOGLE,
      data: {},
    }) as BackgroundResponse<{ success: boolean; tokens?: { idToken: string } }>;
    const idToken = resp?.data?.success ? resp.data.tokens?.idToken : undefined;
    if (!idToken) throw new Error(t('welcome.googleSignInFailed'));
    googleIdToken.value = idToken;
  } catch (e: unknown) {
    errorMessage.value = e instanceof Error ? e.message : t('welcome.googleSignInFailed');
  } finally {
    signingInGoogle.value = false;
  }
}

// WebAuthn cannot run reliably in a side panel, so this delegates to a popup
// (index.html?mode=mpcPrf#/passkey-auth) triggered by ITS OWN click — never
// chained after an awaited Google round-trip, so the popup isn't blocked.
async function handleVerifyPasskey() {
  const wallet = walletStore.loggedWallet;
  if (!wallet) return;
  verifyingPasskey.value = true;
  errorMessage.value = '';
  try {
    passkeySecret.value = await evaluateMpcPasskeyViaPopup(wallet.id);
  } catch (e: unknown) {
    if (!(e instanceof Error && e.message === 'cancelled')) {
      errorMessage.value = e instanceof Error ? e.message : t('security.passKeyAuthFailed');
    }
  } finally {
    verifyingPasskey.value = false;
  }
}

async function reveal() {
  if (!canReveal.value) return;
  const wallet = walletStore.loggedWallet;
  if (!wallet || !googleIdToken.value) return;
  revealing.value = true;
  errorMessage.value = '';
  try {
    // The background's REVEAL_MPC_SRP handler reads the device-secret fields
    // directly off request.data (buildDeviceShareSecret), not nested under a
    // `secret` key — spread them flat here.
    const secretFields = isMpcPasskeyWallet.value
      ? (passkeySecret.value as MpcPasskeySecret)
      : { spendingPassword: devicePassword.value };

    const resp = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.REVEAL_MPC_SRP,
      data: { walletId: wallet.id, idToken: googleIdToken.value, ...secretFields },
    }) as BackgroundResponse<{ success: boolean; mnemonic?: string; error?: string }>;

    if (!resp?.data?.success || !resp.data.mnemonic) {
      throw new Error(resp?.data?.error || t('security.mpcRevealFailed'));
    }
    mnemonic.value = resp.data.mnemonic;
    revealed.value = false; // start hidden behind the blur toggle
  } catch (e: unknown) {
    errorMessage.value = e instanceof Error ? e.message : t('security.mpcRevealFailed');
  } finally {
    revealing.value = false;
  }
}

function handleClose() {
  mnemonic.value = '';   // never persisted; drop from memory on close
  revealed.value = false;
  devicePassword.value = '';
  showDevicePw.value = false;
  errorMessage.value = '';
  googleIdToken.value = '';
  passkeySecret.value = null;
  emit('close');
}
</script>

<style scoped>
.phrase-box {
  background: rgba(255, 255, 255, 0.04);
  line-height: 1.9;
  font-family: 'Roboto Mono', monospace;
  transition: filter 0.2s ease;
}
.phrase-box.blurred {
  filter: blur(6px);
  user-select: none;
}
</style>
