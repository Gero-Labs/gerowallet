<template>
  <div class="step-google-signin">
    <div class="step-scroll">
    <div class="google-signin-panel glass-tier">
      <div class="google-signin-icon">
        <v-avatar size="56" color="rgba(255,255,255,0.05)">
          <v-img :src="google"  width="28" />
        </v-avatar>
      </div>

      <template v-if="!email">
        <div class="google-signin-title t-body-lg">{{ $t('welcome.googleSignInButton') }}</div>
        <div class="google-signin-desc t-body-sm">{{ $t('welcome.onboardingDescGoogleSignIn') }}</div>
        <GButton
          tier="secondary"
          :loading="signingIn"
          @click="signIn()"
        >
          <v-avatar size="18" class="mr-2">
            <v-img :src="google"  />
          </v-avatar>
          {{ $t('welcome.googleSignInButton') }}
        </GButton>
        <v-alert
          v-if="errorMessage"
          color="error"
          icon="mdi-alert-outline"
          variant="outlined"
          density="compact"
          border="start"
          class="mt-3 mb-0"
        >
          <span class="t-body">{{ $t(errorMessage) }}</span>
        </v-alert>
      </template>

      <template v-else>
        <div class="google-signin-title t-body-lg">{{ $t('welcome.googleSignedInAs', { email }) }}</div>
        <GButton tier="tertiary" compact class="mt-1" @click="changeAccount()">
          {{ $t('welcome.googleChangeAccount') }}
        </GButton>
        <v-alert
          v-if="existingWallet"
          color="info"
          icon="mdi-information-outline"
          variant="outlined"
          density="compact"
          border="start"
          class="mpc-info-alert mt-3 mb-0"
        >
          <span class="t-body" style="white-space: pre-line;">{{ $t('welcome.googleWalletAlreadyExists', { name: existingWallet.name }) }}</span>
        </v-alert>
        <v-alert
          v-else-if="enrolledOnBackend"
          color="info"
          icon="mdi-information-outline"
          variant="outlined"
          density="compact"
          border="start"
          class="mpc-info-alert mt-3 mb-0"
        >
          <span class="t-body" style="white-space: pre-line;">{{ $t('welcome.googleWalletEnrolledRestore') }}</span>
        </v-alert>
      </template>
    </div>
    </div>

    <!-- Navigation (footer — outside the scroll region above) -->
    <div class="onboarding-actions d-flex">
      <GButton tier="tertiary" @click="$emit('back')">{{ $t('common.back') }}</GButton>
      <v-spacer />
      <GButton
        v-if="existingWallet"
        tier="primary"
        @click="openUnlockExisting()"
        class="step-next"
      >
        {{ $t('welcome.logInToThisWallet') }}
      </GButton>
      <GButton
        v-else-if="enrolledOnBackend"
        tier="primary"
        @click="restoreExisting()"
        class="step-next"
      >
        {{ $t('welcome.restoreThisWallet') }}
      </GButton>
      <GButton
        v-else
        tier="primary"
        :disabled="!email"
        @click="onContinue()"
        class="step-next"
      >
        {{ $t('common.continue') }}
      </GButton>
    </div>

    <UnlockWalletDialog
      v-model="showUnlockDialog"
      :pre-login-wallet-id="preLoginWalletId"
      :pre-login-wallet-name="preLoginWalletName"
      :pre-login-wallet-icon="preLoginWalletIcon"
      :mpc-prefill-id-token="idToken"
      :mpc-prefill-email="email"
      @unlocked="onUnlocked"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { google } from '@/utils/assets';
import type { NetworkInfo } from '@/utils/networks';
import UnlockWalletDialog from '@/modules/dashboard/dialogs/UnlockWalletDialog.vue';
import type { GoogleWalletBgResponse } from './googleWalletMessages';
import { useExistingGoogleWallet } from './useExistingGoogleWallet';
import GButton from '@/shared/components/GButton/GButton.vue';

const props = defineProps<{ network?: NetworkInfo }>();

const emit = defineEmits<{
  (e: 'signed-in', payload: { idToken: string; email: string; picture: string; name: string }): void;
  (e: 'restore', payload: { idToken: string; email: string; picture: string; name: string }): void;
  (e: 'back'): void;
}>();

const restoreExisting = (): void => {
  emit('restore', { idToken: idToken.value, email: email.value, picture: picture.value, name: displayName.value });
};

/** True when this Google account is enrolled on the BACKEND but has no wallet on
 *  this device — the user must restore rather than create. */
const enrolledOnBackend = ref(false);

async function checkBackendEnrollment(token: string): Promise<void> {
  enrolledOnBackend.value = false;
  if (existingWallet.value) return; // a local wallet exists → login path handles it
  const chain = props.network?.blockchain;
  const network = props.network?.network;
  if (!chain || !network) return;
  try {
    const resp = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.CHECK_MPC_ENROLLMENT,
      data: { idToken: token, chain, network },
    }) as GoogleWalletBgResponse;
    enrolledOnBackend.value = resp?.data?.success === true
      && (resp.data as { enrolled?: boolean }).enrolled === true;
  } catch {
    enrolledOnBackend.value = false;
  }
}

const signingIn = ref(false);
const errorMessage = ref('');
const idToken = ref('');
const email = ref('');
const picture = ref('');
const displayName = ref('');

const {
  existingWallet,
  findExistingWallet,
  showUnlockDialog,
  preLoginWalletId,
  preLoginWalletName,
  preLoginWalletIcon,
  openUnlockExisting,
  onUnlocked,
} = useExistingGoogleWallet(() => props.network);

const signIn = async (): Promise<void> => {
  signingIn.value = true;
  errorMessage.value = '';
  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_WITH_GOOGLE,
      data: {},
    }) as GoogleWalletBgResponse;

    if (!response?.data?.success || !response.data.tokens?.idToken || !response.data.tokens?.accessToken) {
      throw new Error('welcome.googleSignInFailed');
    }

    const { accessToken, idToken: token } = response.data.tokens;

    const profileResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileResp.ok) {
      throw new Error('welcome.googleSignInFailed');
    }
    const profile = await profileResp.json();
    if (!profile?.email_verified || !profile?.email) {
      throw new Error('welcome.googleSignInFailed');
    }

    idToken.value = token;
    email.value = profile.email;
    // Google profile picture (a googleusercontent https URL) — used as the wallet icon.
    picture.value = typeof profile.picture === 'string' ? profile.picture : '';
    // Google display name — prefills the wallet name.
    displayName.value = typeof profile.name === 'string' ? profile.name : '';
    // Already have a wallet for this account on this device? Offer login instead of create.
    await findExistingWallet(token);
    // Else, if the account is enrolled on the backend (fresh device), offer restore.
    await checkBackendEnrollment(token);
  } catch (error: unknown) {
    console.error('Google sign-in failed:', error instanceof Error ? error.message : 'unknown error');
    errorMessage.value = 'welcome.googleSignInFailed';
  } finally {
    signingIn.value = false;
  }
};

const changeAccount = (): void => {
  idToken.value = '';
  email.value = '';
  picture.value = '';
  displayName.value = '';
  existingWallet.value = null;
  enrolledOnBackend.value = false;
};

const onContinue = (): void => {
  if (idToken.value && email.value) {
    emit('signed-in', { idToken: idToken.value, email: email.value, picture: picture.value, name: displayName.value });
  }
};
</script>

<style scoped>
.step-google-signin {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.google-signin-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--g-s-5) var(--g-s-4);
  /* The surface is the glass-tier class in the markup: a pane nested in the
     onboarding panel. */
}

.google-signin-icon {
  margin-bottom: var(--g-s-4);
}

/* Type comes from the ramp classes in the markup; these rules only space. */
.google-signin-title {
  margin-bottom: var(--g-s-1);
}

.google-signin-desc {
  max-width: 360px;
  margin-bottom: var(--g-s-5);
  line-height: 1.5;
}

/* Solid, high-contrast info alert — the default outlined/info blue is unreadable
   against the blue glass onboarding card. */
:deep(.mpc-info-alert.v-alert--outlined) {
  background: rgba(8, 12, 20, 0.82) !important;
  border-color: rgba(125, 180, 255, 0.6) !important;
}
:deep(.mpc-info-alert .v-alert__content),
:deep(.mpc-info-alert .t-body) {
  color: #eaf2ff !important;
}
:deep(.mpc-info-alert .v-icon) {
  color: #7db4ff !important;
}
</style>
