<template>
  <BaseDialog
    :is-open="isOpen"
    :title="t('security.mpcRecoveryChangeTitle')"
    :subtitle="t('security.mpcRecoveryChangeSubtitle')"
    :width="480"
    :min-height="0"
    icon="mdi-form-textbox-password"
    :loading="busy"
    @close="handleClose"
  >
    <v-card-text class="px-3 pb-4">
      <v-alert type="info" text dense class="mb-4">
        {{ t('security.mpcRecoveryChangeInfo') }}
      </v-alert>

      <v-text-field
        v-model="newPassword"
        :label="t('security.mpcRecoveryNewPassword')"
        :type="showPw ? 'text' : 'password'"
        :append-icon="showPw ? 'mdi-eye-off' : 'mdi-eye'"
        @click:append="showPw = !showPw"
        outlined
        dense
        :disabled="busy"
        :error-messages="lengthError"
      />

      <!-- Strength meter (Task 11 shared validator) -->
      <v-progress-linear
        :value="(strength.score + 1) * 20"
        :color="strengthColor"
        height="6"
        rounded
        class="mb-1"
      />
      <div class="caption mb-3" :class="`${strengthColor}--text`">
        {{ t(strength.labelKey) }}
      </div>

      <v-text-field
        v-model="confirmPassword"
        :label="t('security.mpcRecoveryConfirmPassword')"
        :type="showPw ? 'text' : 'password'"
        outlined
        dense
        :disabled="busy"
        :error-messages="mismatchError"
      />

      <v-divider class="my-3" />

      <v-alert v-if="errorMessage" type="error" text dense class="mb-2">
        {{ errorMessage }}
      </v-alert>

      <!-- Re-auth, one gesture per step: Google sign-in first (its own click, so
           the browser popup isn't blocked), then the device secret. Combining
           these into a single async chain would open the passkey popup after an
           awaited round-trip and risk the browser treating it as an unrequested
           popup — same reason LockScreen.vue keeps them as separate buttons. -->
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
      <v-text-field
        v-else-if="!isMpcPasskeyWallet"
        v-model="devicePassword"
        :label="t('security.spendingPassword')"
        :type="showDevicePw ? 'text' : 'password'"
        :append-icon="showDevicePw ? 'mdi-eye-off' : 'mdi-eye'"
        @click:append="showDevicePw = !showDevicePw"
        outlined
        dense
        :disabled="busy"
        @keydown.enter.stop="submit"
      />

      <v-btn
        block
        color="primary"
        class="mt-2"
        :loading="submitting"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ t('security.mpcRecoveryChangeConfirm') }}
      </v-btn>
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { Messaging, BackgroundResponse } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { isAcceptableRecoveryPassword, scoreRecoveryPassword } from '@/shared/utils/mpc/recoveryPasswordStrength';
import { evaluateMpcPasskeyViaPopup, MpcPasskeySecret } from '@/shared/composables/useMpcPasskeyPopup';
import assets from '@/utils/assets';
import snackbar from '@/plugins/snackbar';

const { t } = useTranslation();
defineProps<{ isOpen: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const newPassword = ref('');
const confirmPassword = ref('');
const devicePassword = ref('');
const showPw = ref(false);
const showDevicePw = ref(false);
const submitting = ref(false);
const errorMessage = ref('');

// Re-auth state — never logged.
const googleIdToken = ref('');
const signingInGoogle = ref(false);
const passkeySecret = ref<MpcPasskeySecret | null>(null);
const verifyingPasskey = ref(false);

const busy = computed(() => signingInGoogle.value || verifyingPasskey.value || submitting.value);

// MPC passkey wallets carry both a credential id and a PRF salt id on the wallet
// record (vs. a password-secured MPC wallet, which has neither).
const isMpcPasskeyWallet = computed(() =>
  !!walletStore.loggedWallet?.webAuthnCredentialId && !!walletStore.loggedWallet?.mpcPrfSaltId,
);

const strength = computed(() => scoreRecoveryPassword(newPassword.value));
const strengthColor = computed(() => (['error', 'error', 'warning', 'success', 'success'][strength.value.score]));
const lengthError = computed(() =>
  newPassword.value && newPassword.value.length < 12 ? t('security.mpcRecoveryMinLength') : '',
);
const mismatchError = computed(() =>
  confirmPassword.value && confirmPassword.value !== newPassword.value ? t('security.mpcRecoveryMismatch') : '',
);
const canSubmit = computed(() =>
  !busy.value
  && isAcceptableRecoveryPassword(newPassword.value)
  && newPassword.value === confirmPassword.value
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

async function submit() {
  if (!canSubmit.value) return;
  const wallet = walletStore.loggedWallet;
  if (!wallet || !googleIdToken.value) return;
  submitting.value = true;
  errorMessage.value = '';
  try {
    // The background's SET_RECOVERY_PASSWORD handler reads the device-secret
    // fields directly off request.data (buildDeviceShareSecret), not nested
    // under a `secret` key — spread them flat here.
    const secretFields = isMpcPasskeyWallet.value
      ? (passkeySecret.value as MpcPasskeySecret)
      : { spendingPassword: devicePassword.value };

    const resp = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SET_RECOVERY_PASSWORD,
      data: {
        walletId: wallet.id,
        idToken: googleIdToken.value,
        newRecoveryPassword: newPassword.value,
        ...secretFields,
      },
    }) as BackgroundResponse<{ success: boolean; error?: string }>;

    if (!resp?.data?.success) throw new Error(resp?.data?.error || t('security.mpcRecoveryChangeFailed'));
    snackbar.fireSuccess(t('security.mpcRecoveryChangeSuccess'));
    handleClose();
  } catch (e: unknown) {
    errorMessage.value = e instanceof Error ? e.message : t('security.mpcRecoveryChangeFailed');
  } finally {
    submitting.value = false;
  }
}

function handleClose() {
  newPassword.value = '';
  confirmPassword.value = '';
  devicePassword.value = '';
  showPw.value = false;
  showDevicePw.value = false;
  errorMessage.value = '';
  googleIdToken.value = '';
  passkeySecret.value = null;
  emit('close');
}
</script>
