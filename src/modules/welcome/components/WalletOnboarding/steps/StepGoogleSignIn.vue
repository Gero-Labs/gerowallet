<template>
  <div class="step-google-signin">
    <div class="step-scroll">
    <div class="google-signin-panel">
      <div class="google-signin-icon">
        <v-avatar size="56" color="rgba(255,255,255,0.05)">
          <v-img :src="google" contain width="28" />
        </v-avatar>
      </div>

      <template v-if="!email">
        <div class="google-signin-title">{{ $t('welcome.googleSignInButton') }}</div>
        <div class="google-signin-desc">{{ $t('welcome.onboardingDescGoogleSignIn') }}</div>
        <v-btn
          class="onb-btn google-signin-btn"
          depressed
          outlined
          :loading="signingIn"
          @click="signIn()"
        >
          <v-avatar size="18" class="mr-2">
            <v-img :src="google" contain />
          </v-avatar>
          {{ $t('welcome.googleSignInButton') }}
        </v-btn>
        <v-alert
          v-if="errorMessage"
          color="error"
          icon="mdi-alert-outline"
          outlined
          dense
          border="left"
          class="mt-3 mb-0"
        >
          <span class="text-body-2">{{ $t(errorMessage) }}</span>
        </v-alert>
      </template>

      <template v-else>
        <div class="google-signin-title">{{ $t('welcome.googleSignedInAs', { email }) }}</div>
        <v-btn text small color="primary" class="mt-1" @click="changeAccount()">
          {{ $t('welcome.googleChangeAccount') }}
        </v-btn>
        <v-alert
          v-if="existingWallet"
          color="info"
          icon="mdi-information-outline"
          outlined
          dense
          border="left"
          class="mpc-info-alert mt-3 mb-0"
        >
          <span class="text-body-2" style="white-space: pre-line;">{{ $t('welcome.googleWalletAlreadyExists', { name: existingWallet.name }) }}</span>
        </v-alert>
        <v-alert
          v-else-if="enrolledOnBackend"
          color="info"
          icon="mdi-information-outline"
          outlined
          dense
          border="left"
          class="mpc-info-alert mt-3 mb-0"
        >
          <span class="text-body-2" style="white-space: pre-line;">{{ $t('welcome.googleWalletEnrolledRestore') }}</span>
        </v-alert>
      </template>
    </div>
    </div>

    <!-- Navigation (footer — outside the scroll region above) -->
    <div class="onboarding-actions d-flex" style="gap: 12px;">
      <v-btn text @click="$emit('back')">{{ $t('common.back') }}</v-btn>
      <v-spacer />
      <v-btn
        v-if="existingWallet"
        class="onb-btn"
        depressed
        color="primary"
        @click="openUnlockExisting()"
      >
        {{ $t('welcome.logInToThisWallet') }}
      </v-btn>
      <v-btn
        v-else-if="enrolledOnBackend"
        class="onb-btn"
        depressed
        color="primary"
        @click="restoreExisting()"
      >
        {{ $t('welcome.restoreThisWallet') }}
      </v-btn>
      <v-btn
        v-else
        class="onb-btn"
        depressed
        color="primary"
        :disabled="!email"
        @click="onContinue()"
      >
        {{ $t('common.continue') }}
      </v-btn>
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
import { ref, watch, getCurrentInstance } from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { google } from '@/utils/assets';
import { findMpcGoogleWallet } from '@/db/gero-db';
import { walletStore } from '@/stores/walletStore';
import type { Wallet } from '@/models/types';
import type { NetworkInfo } from '@/utils/networks';
import UnlockWalletDialog from '@/modules/dashboard/dialogs/UnlockWalletDialog.vue';
import type { GoogleWalletBgResponse } from './googleWalletMessages';

const props = defineProps<{ network?: NetworkInfo }>();
const vmProxy = getCurrentInstance()!.proxy;

/** Decode the JWT payload's `sub` (does NOT verify — used only to match a local wallet). */
function subFromToken(token: string): string {
  try {
    const seg = token.split('.')[1];
    if (!seg) return '';
    const json = atob(seg.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json) as { sub?: string }).sub || '';
  } catch {
    return '';
  }
}

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

/** An MPC wallet already on THIS device for the signed-in Google account ON THIS
 *  NETWORK (matched by JWT `sub` === wallet.userId AND chain+network). If present,
 *  the user should log in rather than create a duplicate (the backend would reject
 *  a same-network enroll with a 409 anyway). The match is network-scoped because the
 *  backend enrolls per `(sub, chain, network)`, so the SAME account can hold a
 *  separate wallet on each network (e.g. Cardano mainnet AND preprod).
 *  DB-backed (queried on sign-in) so it doesn't depend on the store being hydrated. */
const existingWallet = ref<Wallet | null>(null);

async function findExistingWallet(token: string): Promise<void> {
  existingWallet.value = null;
  const sub = subFromToken(token);
  if (!sub) return;
  const chain = props.network?.blockchain;
  const network = props.network?.network;
  if (!chain || !network) return;
  try {
    existingWallet.value = await findMpcGoogleWallet(sub, chain, network);
  } catch {
    existingWallet.value = null;
  }
}

// Pre-login unlock dialog — logs into the already-enrolled wallet on this device.
const showUnlockDialog = ref(false);
const preLoginWalletId = ref<number | null>(null);
const preLoginWalletName = ref<string | null>(null);
const preLoginWalletIcon = ref<string | null>(null);

const openUnlockExisting = (): void => {
  const w = existingWallet.value;
  if (!w) return;
  preLoginWalletId.value = w.id ?? null;
  preLoginWalletName.value = w.name || 'Wallet';
  preLoginWalletIcon.value = w.icon || 'mdi-wallet';
  showUnlockDialog.value = true;
};

// Unlock only reconstructs + caches the root key; we still have to LOG IN the wallet
// (set loggedWallet) before navigating, or the dashboard bounces back.
async function loginAndNavigate(wallet: Wallet): Promise<void> {
  const resp = await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.LOGIN, data: { wallet } });
  if (!resp || (resp as { error?: unknown }).error) {
    console.error('Login after unlock failed');
    return;
  }
  await new Promise<void>((resolve) => {
    if (walletStore.loggedWallet?.id === wallet.id) return resolve();
    const unwatch = watch(() => walletStore.loggedWallet?.id, (id) => {
      if (id === wallet.id) { unwatch(); resolve(); }
    });
    setTimeout(() => { unwatch(); resolve(); }, 6000);
  });
  await vmProxy.$router.push('/').catch(() => { /* NavigationDuplicated is fine */ });
}

const onUnlocked = async (): Promise<void> => {
  showUnlockDialog.value = false;
  const wallet = existingWallet.value;
  if (!wallet) {
    await vmProxy.$router.push('/').catch(() => { /* NavigationDuplicated is fine */ });
    return;
  }
  try {
    await loginAndNavigate(wallet);
  } catch (error) {
    console.error('Login after unlock error:', error instanceof Error ? error.message : 'unknown error');
  }
};

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
  padding: 24px 16px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
}

.google-signin-icon {
  margin-bottom: 16px;
}

.google-signin-title {
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  margin-bottom: 4px;
}

.google-signin-desc {
  font-size: 13px;
  color: #94979c;
  max-width: 360px;
  margin-bottom: 20px;
  line-height: 1.5;
}

.google-signin-btn {
  text-transform: none;
  border-color: rgba(255, 255, 255, 0.2) !important;
}

.onb-btn {
  border-radius: 8px !important;
  box-shadow: none !important;
}

/* Solid, high-contrast info alert — the default outlined/info blue is unreadable
   against the blue glass onboarding card. */
::v-deep .mpc-info-alert.v-alert--outlined {
  background: rgba(8, 12, 20, 0.82) !important;
  border-color: rgba(125, 180, 255, 0.6) !important;
}
::v-deep .mpc-info-alert .v-alert__content,
::v-deep .mpc-info-alert .text-body-2 {
  color: #eaf2ff !important;
}
::v-deep .mpc-info-alert .v-icon {
  color: #7db4ff !important;
}
</style>
