<template>
  <div class="lock-screen">
    <div class="content">
      <v-icon size="48" :color="primaryColor" class="mb-4">mdi-lock-outline</v-icon>
      <h2 class="white--text text-h6 mb-1">{{ $t('miniGero.walletLocked') }}</h2>
      <p class="grey--text text-body-2 mb-4">{{ walletName }}</p>

      <!-- Loading config -->
      <div v-if="!configLoaded" class="text-center py-4">
        <v-progress-circular indeterminate size="24" :color="primaryColor" />
      </div>

      <template v-else>
        <!-- MPC "Sign in with Google" unlock (takes precedence — MPC wallets
             have no unlockMethod config row, so they'd otherwise fall to the
             password default and be stranded here). -->
        <template v-if="isMpcWallet">
          <p class="text-caption grey--text mb-3 text-center">
            {{ mpcSessionActive
              ? $t(mpcUsesPasskey ? 'welcome.unlockApprovePasskeyOnly' : 'welcome.unlockPasswordOnly')
              : $t(mpcUsesPasskey ? 'welcome.unlockApprovePasskey' : 'welcome.unlockGoogleWalletDescription') }}
          </p>

          <template v-if="!googleEmail && !mpcSessionActive">
            <v-btn
              block
              outlined
              class="mb-1 mpc-google-btn"
              :loading="signingInGoogle"
              @click="signInWithGoogle"
            >
              <v-avatar size="18" class="mr-2">
                <v-img :src="assets.google" contain />
              </v-avatar>
              {{ $t('welcome.googleSignInButton') }}
            </v-btn>
            <p v-if="error" class="red--text text-caption mt-2 mb-0">{{ error }}</p>
          </template>

          <template v-else-if="mpcUsesPasskey">
            <p v-if="googleEmail" class="text-caption grey--text mb-3 text-center">{{ $t('welcome.googleSignedInAs', { email: googleEmail }) }}</p>
            <p v-if="error" class="red--text text-caption mb-2">{{ error }}</p>

            <v-btn
              class="geroButton"
              block
              rounded
              depressed
              :loading="loading"
              @click="handleMpcUnlock"
            >
              <v-icon left small>mdi-fingerprint</v-icon>
              {{ $t('security.usePassKey') }}
            </v-btn>
          </template>

          <template v-else>
            <p v-if="googleEmail" class="text-caption grey--text mb-3 text-center">{{ $t('welcome.googleSignedInAs', { email: googleEmail }) }}</p>
            <v-text-field
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              :placeholder="$t('miniGero.enterPassword')"
              outlined
              dense
              dark
              hide-details
              class="mb-3"
              :append-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
              @click:append="showPassword = !showPassword"
              @keydown.enter="handleMpcUnlock"
              :error="!!error"
            />

            <p v-if="error" class="red--text text-caption mb-2">{{ error }}</p>

            <v-btn
              class="geroButton"
              block
              rounded
              depressed
              :loading="loading"
              :disabled="!password"
              @click="handleMpcUnlock"
            >
              {{ $t('miniGero.unlock') }}
            </v-btn>
          </template>
        </template>

        <!-- PIN unlock -->
        <template v-else-if="unlockMethod === 'pin'">
          <p class="text-caption grey--text mb-3 text-center">{{ $t('security.enterPinToUnlock') }}</p>
          <NumericOtpInput
            ref="pinInputRef"
            v-model="pinCode"
            :length="pinLength"
            :error="pinError"
            @finish="handlePinFinish"
          />
        </template>

        <!-- Pattern unlock — redirect to dashboard -->
        <template v-else-if="unlockMethod === 'pattern'">
          <p class="text-caption grey--text mb-3 text-center">{{ $t('security.drawPatternToUnlock') }}</p>
          <v-btn
            block
            outlined
            class="mb-3 dashboard-btn"
            @click="openDashboard"
          >
            <v-icon small class="mr-2">mdi-open-in-new</v-icon>
            {{ $t('miniGero.unlockInDashboard') }}
          </v-btn>
        </template>

        <!-- Password unlock (default / fallback) -->
        <template v-else>
          <v-text-field
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            :placeholder="$t('miniGero.enterPassword')"
            outlined
            dense
            dark
            hide-details
            class="mb-3"
            :append-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
            @click:append="showPassword = !showPassword"
            @keydown.enter="handlePasswordUnlock"
            :error="!!error"
          />

          <p v-if="error" class="red--text text-caption mb-2">{{ error }}</p>

          <v-btn
            class="geroButton"
            block
            rounded
            depressed
            :loading="loading"
            :disabled="!password"
            @click="handlePasswordUnlock"
          >
            {{ $t('miniGero.unlock') }}
          </v-btn>
        </template>

        <!-- Cancel the switch (pre-switch) or logout (normal lock) -->
        <v-btn text small class="mt-4 logout-btn" @click="onFooterAction" :loading="loggingOut">
          {{ isPreSwitch ? $t('common.cancel') : $t('security.logoutInstead') }}
        </v-btn>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import NumericOtpInput from '@/shared/components/NumericOtpInput.vue';
import { useChainContext } from '../composables/useChainContext';
import { useTranslation } from '@/shared/composables/useTranslation';
import { getErrorMessage } from '@/shared/utils/errorHandler';
import assets from '@/utils/assets';

/** Shape of the `{ id, data, target, sender }` envelope background handlers reply with. */
interface BackgroundMessageResponse {
  data?: {
    success?: boolean;
    error?: string;
    tokens?: { idToken: string; accessToken: string };
  };
  error?: string;
}

const { t } = useTranslation();

// When `targetWallet` is provided, this is a PRE-SWITCH unlock: the user picked a
// DIFFERENT (still-locked) MPC wallet to switch to, and we authenticate it WITHOUT
// logging out the current wallet. On success we emit `switch-unlocked` (the parent
// then does LOGIN); `cancel` aborts the switch and keeps the current wallet. With no
// prop, this is the normal lock screen for the logged-in wallet.
const props = defineProps<{ targetWallet?: import('@/models/types').Wallet | null }>();
const emit = defineEmits<{
  (e: 'switch-unlocked', wallet: import('@/models/types').Wallet): void;
  (e: 'cancel'): void;
}>();

const lockWallet = computed(() => props.targetWallet ?? walletStore.loggedWallet);
const isPreSwitch = computed(() => !!props.targetWallet);

const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

const password = ref('');
const showPassword = ref(false);
const loading = ref(false);
const loggingOut = ref(false);
const error = ref('');

// MPC "Sign in with Google" unlock state — never logged (idToken).
const isMpcWallet = computed(() => lockWallet.value?.encryptionMethod === 'mpc');
// Passkey material lives on the wallet record (Task 5); present only when the
// wallet was secured with a passkey at creation, undefined for password wallets.
const mpcUsesPasskey = computed(() => (
  !!lockWallet.value?.webAuthnCredentialId && !!lockWallet.value?.mpcPrfSaltId
));
const googleIdToken = ref('');
const googleEmail = ref('');
const signingInGoogle = ref(false);
// True when the background still holds this wallet's login share from an earlier
// unlock this session — re-unlock then needs only the device secret, no Google.
const mpcSessionActive = ref(false);

const pinCode = ref('');
const pinLength = ref(6);
const pinError = ref('');
const pinInputRef = ref<{ resetValidation?: () => void } | null>(null);

const unlockMethod = ref<string | null>(null);
const configLoaded = ref(false);

const walletName = computed(() => lockWallet.value?.name || 'Wallet');

onMounted(async () => {
  await loadSecurityConfig();
});

async function loadSecurityConfig() {
  try {
    const walletId = lockWallet.value?.id;
    if (!walletId) {
      configLoaded.value = true;
      return;
    }

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(walletId);
    const configTable = db.table('config');

    const unlockMethodConfig = await configTable.where({ key: 'unlockMethod' }).first();
    const pinLengthConfig = await configTable.where({ key: 'pinLength' }).first();

    unlockMethod.value = unlockMethodConfig?.value || null;
    pinLength.value = pinLengthConfig?.value || 6;

    // MPC: if the login share is still cached in the background, re-unlock can
    // skip Google and use only the device secret.
    if (isMpcWallet.value) {
      try {
        const sessionResp = await Messaging.sendToBackgroundFromOptions({
          method: MessageTypes.HAS_MPC_SESSION,
          data: { walletId },
        }) as { data?: { hasSession?: boolean } };
        mpcSessionActive.value = !!sessionResp?.data?.hasSession;
      } catch {
        mpcSessionActive.value = false;
      }
    }

    configLoaded.value = true;
  } catch (e) {
    console.error('Failed to load security config:', e);
    configLoaded.value = true;
  }
}

async function handlePinFinish(pin: string) {
  pinCode.value = pin;
  loading.value = true;
  pinError.value = '';

  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.UNLOCK,
      data: { unlockCredential: pin, unlockMethod: 'pin' },
    });

    if (!response.data.success) {
      pinError.value = response.data.error || 'Incorrect PIN';
      pinCode.value = '';
    }
  } catch (e: unknown) {
    pinError.value = getErrorMessage(e, 'Unlock failed');
    pinCode.value = '';
  } finally {
    loading.value = false;
  }
}

async function handlePasswordUnlock() {
  if (!password.value) return;
  loading.value = true;
  error.value = '';

  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.UNLOCK,
      data: {
        unlockCredential: password.value,
        unlockMethod: unlockMethod.value || 'password',
        password: password.value,
      },
    });

    if (!response.data.success) {
      error.value = response.data.error || 'Invalid password';
    }
  } catch (e: unknown) {
    error.value = getErrorMessage(e, 'Unlock failed');
  } finally {
    password.value = '';
    loading.value = false;
  }
}

async function signInWithGoogle() {
  signingInGoogle.value = true;
  error.value = '';
  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_WITH_GOOGLE,
      data: {},
    }) as BackgroundMessageResponse;
    if (!response?.data?.success || !response.data.tokens?.idToken || !response.data.tokens?.accessToken) {
      throw new Error(t('welcome.googleSignInFailed'));
    }
    const { accessToken, idToken } = response.data.tokens;
    const profileResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileResp.ok) {
      throw new Error(t('welcome.googleSignInFailed'));
    }
    const profile = await profileResp.json();
    if (!profile?.email_verified || !profile?.email) {
      throw new Error(t('welcome.googleSignInFailed'));
    }
    googleIdToken.value = idToken;
    googleEmail.value = profile.email;
  } catch (e: unknown) {
    console.error('Google sign-in failed:', getErrorMessage(e, 'unknown error'));
    error.value = getErrorMessage(e, t('welcome.googleSignInFailed'));
  } finally {
    signingInGoogle.value = false;
  }
}

// WebAuthn cannot run directly in a Chrome side panel, so the MPC passkey PRF
// ceremony runs in a popup window (index.html?mode=mpcPrf#/passkey-auth) — the
// same popup-delegation the dapp-sign flow uses. Returns the UNLOCK_MPC_WALLET
// `extra` fields (raw prfOutputHex + credential/salt ids). Never logged.
function evaluateMpcPasskeyViaPopup(): Promise<{ prfOutputHex: string; webAuthnCredentialId: string; mpcPrfSaltId: string }> {
  return new Promise((resolve, reject) => {
    // Pass the target wallet id so the popup evaluates the RIGHT wallet's passkey
    // (during a pre-switch the logged-in wallet is still the old one).
    const popupUrl = chrome.runtime.getURL(`index.html?mode=mpcPrf&walletId=${lockWallet.value?.id}#/passkey-auth`);
    const popup = window.open(popupUrl, 'PassKeyAuth', 'width=400,height=500,popup=1');
    if (!popup) {
      reject(new Error(t('errors.popupBlocked')));
      return;
    }
    const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
    const handler = (event: MessageEvent) => {
      if (event.origin !== extensionOrigin) return;
      if (event.data?.type !== 'PASSKEY_AUTH_RESULT') return;
      window.removeEventListener('message', handler);
      const { success, prfOutputHex, webAuthnCredentialId, mpcPrfSaltId, error: err } = event.data.payload || {};
      if (success && prfOutputHex) {
        resolve({ prfOutputHex, webAuthnCredentialId, mpcPrfSaltId });
      } else {
        reject(new Error(err || t('security.passKeyAuthFailed')));
      }
      try { popup.close(); } catch { /* already closed */ }
    };
    window.addEventListener('message', handler);
    setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error(t('errors.authenticationTimeout')));
      try { popup.close(); } catch { /* already closed */ }
    }, 120000);
  });
}

async function handleMpcUnlock() {
  if (loading.value) return;
  const walletId = lockWallet.value?.id;
  // Either a fresh Google idToken or a cached session login share is required.
  if (!walletId || (!googleIdToken.value && !mpcSessionActive.value)) return;
  if (!mpcUsesPasskey.value && !password.value) return;

  loading.value = true;
  error.value = '';

  try {
    // Re-unlocking via a cached session (no fresh idToken): the MV3 service
    // worker may have died since the lock screen opened, dropping the login
    // share. Re-verify BEFORE any passkey ceremony so we fall back to Google
    // cleanly instead of consuming a biometric prompt and dead-ending.
    if (mpcSessionActive.value && !googleIdToken.value) {
      let stillActive = false;
      try {
        const resp = await Messaging.sendToBackgroundFromOptions({
          method: MessageTypes.HAS_MPC_SESSION,
          data: { walletId },
        }) as { data?: { hasSession?: boolean } };
        stillActive = !!resp?.data?.hasSession;
      } catch {
        stillActive = false;
      }
      if (!stillActive) {
        mpcSessionActive.value = false; // re-show the Google sign-in button
        error.value = t('security.mpcSessionExpired');
        loading.value = false;
        return;
      }
    }
    // Passkey wallets re-derive the PRF output via a passkey ceremony; password
    // wallets send the entered spending password. WebAuthn can't run in a Chrome
    // side panel, so the passkey ceremony runs in a popup window (same mechanism
    // as dapp signing). Never log request.data — contains idToken/spendingPassword/prfOutputHex.
    const extra = mpcUsesPasskey.value
      ? await evaluateMpcPasskeyViaPopup()
      : { spendingPassword: password.value };

    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.UNLOCK_MPC_WALLET,
      data: {
        walletId,
        idToken: googleIdToken.value,
        ...extra,
      },
    }) as BackgroundMessageResponse;

    if (!response?.data?.success) {
      error.value = response?.data?.error || t('security.unlockFailed');
    } else if (isPreSwitch.value && props.targetWallet) {
      // Pre-switch: the target's key is now reconstructed in the session cache.
      // Hand off to the parent to actually switch (LOGIN) to it — login() finds
      // the cached key and activates it unlocked, without a Welcome flash.
      emit('switch-unlocked', props.targetWallet);
    }
  } catch (e: unknown) {
    error.value = getErrorMessage(e, t('security.unlockFailed'));
  } finally {
    password.value = '';
    loading.value = false;
  }
}

// Footer action: on a pre-switch, "Cancel" aborts the switch (keeps the current
// wallet); on a normal lock, "Logout Instead" logs the wallet out.
function onFooterAction() {
  if (isPreSwitch.value) {
    emit('cancel');
  } else {
    handleLogout();
  }
}

async function handleLogout() {
  try {
    loggingOut.value = true;
    await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGOUT,
      data: {},
    });
  } catch (e) {
    console.error('Logout error:', e);
  } finally {
    loggingOut.value = false;
  }
}

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
}
</script>

<style scoped>
.lock-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: #0a0a0a;
}

.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px;
  width: 100%;
  max-width: 320px;
}

.dashboard-btn {
  border-color: #333 !important;
  color: var(--chain-primary) !important;
  text-transform: none !important;
  font-weight: 600 !important;
  font-size: 13px !important;
  letter-spacing: 0 !important;
  border-radius: 10px !important;
  height: 40px !important;
}

.mpc-google-btn {
  border-color: #333 !important;
  color: #fff !important;
  text-transform: none !important;
  font-weight: 600 !important;
  font-size: 13px !important;
  letter-spacing: 0 !important;
  border-radius: 10px !important;
  height: 40px !important;
}

.logout-btn {
  color: #F97066 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.5px !important;
}
</style>
