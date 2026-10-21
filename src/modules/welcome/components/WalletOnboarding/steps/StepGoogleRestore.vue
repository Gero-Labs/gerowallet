<template>
  <div class="step-google-restore">
    <div class="step-scroll">
    <!-- Google sign-in -->
    <div class="t-label mb-2">{{ $t('welcome.onboardingStepGoogleSignIn') }}</div>
    <template v-if="!email">
      <GButton tier="secondary" :loading="signingIn" @click="signIn()">
        <v-avatar size="18" class="mr-2">
          <v-img :src="google"  />
        </v-avatar>
        {{ $t('welcome.googleSignInButton') }}
      </GButton>
    </template>
    <template v-else>
      <div class="signed-in-row">
        <v-icon color="success" size="18" class="mr-1">mdi-check-circle</v-icon>
        <span class="signed-in-row__text t-body">{{ $t('welcome.googleSignedInAs', { email }) }}</span>
        <GButton tier="tertiary" compact class="ml-2" @click="changeAccount()">
          {{ $t('welcome.googleChangeAccount') }}
        </GButton>
      </div>
    </template>

    <!-- This Google account's wallet is already on this device: log in to it, never
         restore a second copy. -->
    <v-alert
      v-if="existingWallet"
      color="info"
      icon="mdi-information-outline"
      variant="outlined"
      density="compact"
      border="start"
      class="mt-3 mb-0"
    >
      <span class="t-body" style="white-space: pre-line;">{{ $t('welcome.googleWalletAlreadyRestored', { name: existingWallet.name }) }}</span>
    </v-alert>

    <v-divider v-if="!existingWallet" class="my-3" style="border-color: var(--g-hairline-1);" />

    <v-form v-if="!existingWallet" ref="restoreForm" v-model="formValid" style="width: 100%;">
      <!-- Wallet name -->
      <label :for="nameId" class="t-label d-block mb-2">{{ $t('welcome.walletName') }}</label>
      <v-text-field
        :id="nameId"
        v-model="name"
        density="compact"
        variant="filled"
        :placeholder="$t('welcome.walletNamePlaceholder')"
        :rules="[rules.required(), rules.minCharacters(1), rules.maxCharacters(50)]"
        class="mb-2"
      ></v-text-field>

      <!-- Recovery password (no file — fileless restore) -->
      <label :for="recoveryPasswordId" class="t-label d-block mb-2">{{ $t('welcome.recoveryPassword') }}</label>
      <div class="field-hint t-caption mb-2">{{ $t('welcome.restoreRecoveryPasswordHint') }}</div>
      <v-text-field
        :id="recoveryPasswordId"
        v-model="recoveryPassword"
        density="compact"
        variant="filled"
        :type="showRecovery ? 'text' : 'password'"
        :append-inner-icon="showRecovery ? 'mdi-eye' : 'mdi-eye-off'"
        @click:append-inner="showRecovery = !showRecovery"
        :rules="[rules.required(), rules.minCharacters(12)]"
        class="mb-2"
      ></v-text-field>

      <v-divider class="my-3" style="border-color: var(--g-hairline-1);" />

      <!-- New spending password (fallback when this device/browser has no WebAuthn PRF) -->
      <template v-if="!passkeyCapable">
        <div class="t-label mb-2">{{ $t('welcome.newSpendingPassword') }}</div>
        <v-text-field
          v-model="spendingPassword"
          density="compact"
          variant="filled"
          :label="$t('welcome.password')"
          :aria-label="$t('welcome.newSpendingPassword')"
          :type="showSpending ? 'text' : 'password'"
          :append-inner-icon="showSpending ? 'mdi-eye' : 'mdi-eye-off'"
          @click:append-inner="showSpending = !showSpending"
          :rules="[
            rules.required(),
            rules.minCharacters(10),
            rules.oneOrMoreNumbers,
            rules.containCapital,
            rules.containLowerCase,
            rules.containSpecialCharacter,
            rules.spaceNotAllowed
          ]"
        ></v-text-field>
        <v-text-field
          v-model="confirmSpendingPassword"
          density="compact"
          variant="filled"
          :label="$t('welcome.confirmNewSpendingPassword')"
          :type="showSpending ? 'text' : 'password'"
          :rules="[
            rules.required(),
            (v) => v === spendingPassword || $t('welcome.passwordsMustMatch')
          ]"
        ></v-text-field>
      </template>

      <!-- Re-enroll a passkey on this (new) device — preferred path, hardware-backed -->
      <template v-else>
        <div class="t-label mb-2">{{ $t('welcome.securityMethod') }}</div>
        <GButton
          tier="secondary"
          block
          :loading="enrollingPasskey"
          @click="setUpPasskey()"
          class="mb-2"
          :style="enrolledPasskey ? { '--g-btn-fg': 'var(--g-success)' } : undefined"
        >
          <v-icon start size="small">{{ enrolledPasskey ? 'mdi-check' : 'mdi-fingerprint' }}</v-icon>
          {{ enrolledPasskey ? $t('welcome.passkeySecured') : $t('welcome.setUpPasskeyThisDevice') }}
        </GButton>
        <v-alert
          v-if="passkeyError"
          color="error"
          icon="mdi-alert-outline"
          variant="outlined"
          density="compact"
          border="start"
          class="mb-2"
        >
          <span class="t-body">{{ passkeyError }}</span>
        </v-alert>
      </template>

      <v-alert
        v-if="errorMessage"
        color="error"
        icon="mdi-alert-outline"
        variant="outlined"
        density="compact"
        border="start"
        class="mt-3 mb-0"
      >
        <span class="t-body">{{ errorMessage }}</span>
      </v-alert>
    </v-form>
    </div>

    <!-- Navigation buttons (footer — outside the scroll region above) -->
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
        v-else
        tier="primary"
        :disabled="!canRestore"
        :loading="restoring"
        @click="restore()"
        class="step-next"
      >
        {{ $t('welcome.restoreGoogleWallet') }}
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
import { ref, computed, onMounted, getCurrentInstance, useId } from 'vue';
import rules from '@/utils/rules';
import { Theme } from '@/models/types';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { generateWalletName } from '@/shared/utils/walletNameGenerator';
import networks, { NetworkInfo } from '@/utils/networks';
import { google } from '@/utils/assets';
import { mpcPasskeyAvailable, enrollMpcPasskey } from '@/shared/utils/mpc/mpcPasskey';
import { authPayloadToWireFields, type GoogleWalletBgResponse, type GoogleAuthPayload } from './googleWalletMessages';
import { useExistingGoogleWallet } from './useExistingGoogleWallet';
import UnlockWalletDialog from '@/modules/dashboard/dialogs/UnlockWalletDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';

const props = defineProps<{
  network: NetworkInfo;
  /** When routed here after already signing in (enrolled-account detection), the
   *  Google session is passed in so this step skips a second "Sign in with Google". */
  prefillIdToken?: string;
  prefillEmail?: string;
  prefillPicture?: string;
  prefillName?: string;
}>();
defineEmits<{ (e: 'back'): void }>();

const vmProxy = getCurrentInstance()!.proxy;
const router = vmProxy?.$router;
const formValid = ref(false);

const signingIn = ref(false);
// Seed from a Google session passed in by the enrolled-account detection flow, so
// a pre-signed-in user isn't asked to sign in again (email set ⇒ sign-in button hidden).
const idToken = ref(props.prefillIdToken ?? '');
const email = ref(props.prefillEmail ?? '');
const picture = ref(props.prefillPicture ?? '');

const name = ref(props.prefillName?.trim() || generateWalletName());
const nameId = useId();
const recoveryPassword = ref('');
const recoveryPasswordId = useId();
const spendingPassword = ref('');
const confirmSpendingPassword = ref('');
const showRecovery = ref(false);
const showSpending = ref(false);

const restoring = ref(false);
const errorMessage = ref('');

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

// Passkey-first, same as the create flow's Secure step: capability is probed once
// on mount so the form doesn't jump between layouts while the user is typing. On a
// fresh device there is no existing passkey to reuse — restore enrolls a NEW one.
const passkeyCapable = ref(false);
const enrolledPasskey = ref<{ credentialId: string; mpcPrfSaltId: string; prfOutputHex: string } | null>(null);
const enrollingPasskey = ref(false);
const passkeyError = ref('');

onMounted(async () => {
  passkeyCapable.value = await mpcPasskeyAvailable();
  if (idToken.value) await findExistingWallet(idToken.value);
});

async function setUpPasskey(): Promise<void> {
  enrollingPasskey.value = true;
  passkeyError.value = '';
  try {
    enrolledPasskey.value = await enrollMpcPasskey(name.value || 'Gero Google Wallet');
  } catch (error: unknown) {
    passkeyError.value = error instanceof Error ? error.message : (vmProxy.$t('errors.unknownError') as string);
  } finally {
    enrollingPasskey.value = false;
  }
}

// The secret this step sends to the background — either the freshly re-enrolled
// passkey (PRF) material or a new spending password.
const authPayload = computed<GoogleAuthPayload>(() => (
  enrolledPasskey.value
    ? { authMethod: 'passkey', ...enrolledPasskey.value }
    : { authMethod: 'password', spendingPassword: spendingPassword.value }
));

const secretReady = computed(() => (
  passkeyCapable.value
    ? !!enrolledPasskey.value
    : spendingPassword.value.length >= 10 && spendingPassword.value === confirmSpendingPassword.value
));

const canRestore = computed(() => (
  formValid.value && !!email.value && recoveryPassword.value.length >= 12 && secretReady.value && !restoring.value
));

const signIn = async (): Promise<void> => {
  signingIn.value = true;
  errorMessage.value = '';
  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_WITH_GOOGLE,
      data: {},
    }) as GoogleWalletBgResponse;
    if (!response?.data?.success || !response.data.tokens?.idToken || !response.data.tokens?.accessToken) {
      throw new Error(vmProxy.$t('welcome.googleSignInFailed') as string);
    }
    const { accessToken, idToken: token } = response.data.tokens;
    const profileResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileResp.ok) {
      throw new Error(vmProxy.$t('welcome.googleSignInFailed') as string);
    }
    const profile = await profileResp.json();
    if (!profile?.email_verified || !profile?.email) {
      throw new Error(vmProxy.$t('welcome.googleSignInFailed') as string);
    }
    idToken.value = token;
    email.value = profile.email;
    // Prefill the restored wallet's icon (Google picture) and name (Google name).
    picture.value = typeof profile.picture === 'string' ? profile.picture : '';
    if (typeof profile.name === 'string' && profile.name.trim()) {
      name.value = profile.name.trim();
    }
    // Already have this account's wallet on this device? Offer login instead of restore.
    await findExistingWallet(token);
  } catch (error: unknown) {
    console.error('Google sign-in failed:', error instanceof Error ? error.message : 'unknown error');
    errorMessage.value = error instanceof Error ? error.message : (vmProxy.$t('welcome.googleSignInFailed') as string);
  } finally {
    signingIn.value = false;
  }
};

const changeAccount = (): void => {
  idToken.value = '';
  email.value = '';
  existingWallet.value = null;
};

const restore = async (): Promise<void> => {
  if (!canRestore.value) return;
  restoring.value = true;
  errorMessage.value = '';
  try {
    // Prefer the Google profile picture as the restored wallet's icon.
    const walletIcon = picture.value || networks.resolveIconColor(props.network?.blockchain || '', props.network?.network || '');
    const payload = authPayload.value;

    // Note: never log request payload — carries idToken/recoveryPassword and the new device secret.
    // Fileless: the background fetches the recovery blob + xpub anchor from the
    // backend itself (keyed by the verified Google subject) — no file to parse here.
    const recoverResponse = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.RECOVER_MPC_GOOGLE_WALLET,
      data: {
        name: name.value,
        icon: walletIcon,
        theme: Theme.GERO,
        chain: props.network?.blockchain,
        network: props.network?.network,
        idToken: idToken.value,
        recoveryPassword: recoveryPassword.value,
        ...authPayloadToWireFields(payload),
      },
    }) as GoogleWalletBgResponse;

    if (!recoverResponse?.data?.success || recoverResponse.data.walletId == null) {
      // A missing backend recovery blob (account never backed up / predates the
      // feature) gets a clear, actionable message instead of the generic error.
      if (recoverResponse?.data?.code === 'no_recovery_backup') {
        throw new Error(vmProxy.$t('welcome.noRecoveryBackup') as string);
      }
      // The wallet is already on this device (nothing was written): offer login to it.
      if (recoverResponse?.data?.code === 'wallet_exists' && recoverResponse.data.walletId != null) {
        const { getAllWallets } = await import('@/db/gero-db');
        existingWallet.value = (await getAllWallets())[recoverResponse.data.walletId] ?? null;
        if (existingWallet.value) return;
      }
      throw new Error(recoverResponse?.data?.error || (vmProxy.$t('errors.unknownError') as string));
    }

    const walletId = recoverResponse.data.walletId;

    const unlockResponse = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.UNLOCK_MPC_WALLET,
      data: {
        walletId,
        idToken: idToken.value,
        ...authPayloadToWireFields(payload),
      },
    }) as GoogleWalletBgResponse;
    if (!unlockResponse?.data?.success) {
      throw new Error(unlockResponse?.data?.error || (vmProxy.$t('errors.unknownError') as string));
    }

    const { getAllWallets } = await import('@/db/gero-db');
    const wallets = await getAllWallets();
    const wallet = wallets[walletId];

    const loginResponse = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: { wallet },
    });

    const hasError = loginResponse && typeof loginResponse === 'object' && 'error' in loginResponse;
    if (loginResponse && !hasError) {
      vmProxy.$nextTick(() => {
        router.push('/').catch((err: Error) => {
          if (err.name !== 'NavigationDuplicated' && !err.message?.includes('Redirected')) {
            console.warn('Navigation error:', err);
          }
        });
      });
    } else {
      vmProxy.$nextTick(() => {
        router.push('/').catch(() => {});
      });
    }
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : (vmProxy.$t('errors.unknownError') as string);
  } finally {
    restoring.value = false;
  }
};
</script>

<style scoped lang="scss">
// Type comes from the ramp classes in the markup; these rules only space and
// lift the signed-in account to the primary tone.
.field-hint {
  line-height: 1.4;
}

.signed-in-row {
  display: flex;
  align-items: center;
}

.signed-in-row__text {
  color: var(--g-text-1);
}
</style>
