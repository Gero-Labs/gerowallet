<template>
  <div class="step-google-secure">
    <v-form ref="secureForm" v-model="formValid" style="width: 100%;">

      <!-- Wallet name field -->
      <div class="step-section-label mb-2">{{ $t('welcome.walletName') }}</div>
      <v-text-field
        v-model="name"
        dense
        filled
        :label="$t('welcome.walletName')"
        :placeholder="$t('welcome.walletNamePlaceholder')"
        :rules="[rules.required(), rules.minCharacters(1), rules.maxCharacters(50)]"
        class="mb-2"
      ></v-text-field>

      <v-divider class="my-3" style="border-color: rgba(255, 255, 255, 0.08);" />

      <!-- Spending password (fallback when the device/browser has no WebAuthn PRF) -->
      <template v-if="!passkeyCapable">
        <div class="step-section-label mb-2">{{ $t('welcome.spendingPassword') }}</div>
        <div class="field-hint mb-2">{{ $t('welcome.spendingPasswordMpcHint') }}</div>
        <v-text-field
          v-model="spendingPassword"
          dense
          filled
          :label="$t('welcome.spendingPassword')"
          :type="showSpending ? 'text' : 'password'"
          :append-icon="showSpending ? 'mdi-eye' : 'mdi-eye-off'"
          @click:append="showSpending = !showSpending"
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
          dense
          filled
          :label="$t('welcome.confirmPassword')"
          :type="showSpending ? 'text' : 'password'"
          :rules="[
            rules.required(),
            (v) => v === spendingPassword || $t('welcome.passwordsMustMatch')
          ]"
          class="mb-2"
        ></v-text-field>
      </template>

      <!-- Passkey (preferred path — hardware-backed, no password to remember) -->
      <template v-else>
        <div class="step-section-label mb-2">{{ $t('welcome.securityMethod') }}</div>
        <div class="field-hint mb-2">{{ $t('welcome.secureWithPasskeyHint') }}</div>
        <v-btn
          class="passkey-auth-button mb-2"
          block
          depressed
          :color="passkey ? 'success' : 'primary'"
          :loading="enrolling"
          @click="secureWithPasskey()"
        >
          <v-icon left small>{{ passkey ? 'mdi-check' : 'mdi-fingerprint' }}</v-icon>
          {{ passkey ? $t('welcome.passkeySecured') : $t('welcome.secureWithPasskey') }}
        </v-btn>
        <v-alert
          v-if="passkeyError"
          color="error"
          icon="mdi-alert-outline"
          outlined
          dense
          border="left"
          class="mb-2"
        >
          <span class="text-body-2">{{ passkeyError }}</span>
        </v-alert>
      </template>

      <v-divider class="my-3" style="border-color: rgba(255, 255, 255, 0.08);" />

      <!-- Recovery password -->
      <div class="step-section-label mb-2">{{ $t('welcome.recoveryPassword') }}</div>
      <div class="field-hint mb-2">{{ $t('welcome.recoveryPasswordHint') }}</div>
      <v-text-field
        v-model="recoveryPassword"
        dense
        filled
        :label="$t('welcome.recoveryPassword')"
        :type="showRecovery ? 'text' : 'password'"
        :append-icon="showRecovery ? 'mdi-eye' : 'mdi-eye-off'"
        @click:append="showRecovery = !showRecovery"
        :rules="[
          rules.required(),
          rules.minCharacters(10),
          rules.oneOrMoreNumbers,
          rules.containCapital,
          rules.containLowerCase,
          rules.containSpecialCharacter,
          rules.spaceNotAllowed,
          (v) => passkeyCapable || v !== spendingPassword || $t('welcome.recoveryPasswordMustDiffer')
        ]"
      ></v-text-field>
      <v-text-field
        v-model="confirmRecoveryPassword"
        dense
        filled
        :label="$t('welcome.confirmRecoveryPassword')"
        :type="showRecovery ? 'text' : 'password'"
        :rules="[
          rules.required(),
          (v) => v === recoveryPassword || $t('welcome.passwordsMustMatch')
        ]"
      ></v-text-field>

      <v-alert
        v-if="errorMessage"
        color="error"
        icon="mdi-alert-outline"
        outlined
        dense
        border="left"
        class="mt-3 mb-0"
      >
        <span class="text-body-2">{{ errorMessage }}</span>
      </v-alert>
    </v-form>

    <!-- Navigation buttons -->
    <div class="onboarding-actions d-flex" style="gap: 12px;">
      <v-btn text @click="$emit('back')">{{ $t('common.back') }}</v-btn>
      <v-spacer />
      <v-btn
        color="primary"
        :disabled="!canContinue"
        :loading="creating"
        @click="createWallet()"
      >
        {{ $t('common.continue') }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, getCurrentInstance } from 'vue';
import rules from '@/utils/rules';
import { Theme } from '@/models/types';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { generateWalletName } from '@/shared/utils/walletNameGenerator';
import networks, { NetworkInfo } from '@/utils/networks';
import { mpcPasskeyAvailable, enrollMpcPasskey } from '@/shared/utils/mpc/mpcPasskey';
import { authPayloadToWireFields, type GoogleWalletBgResponse, type GoogleAuthPayload } from './googleWalletMessages';

interface Props {
  network: NetworkInfo;
  idToken: string;
  /** Google profile picture URL — used as the wallet icon when present. */
  googlePicture?: string;
  /** Google display name — prefills the wallet name when present. */
  googleName?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'back'): void;
  (e: 'created', payload: {
    walletId: number;
    recoveryShare: string;
    publicKey: string;
    authPayload: GoogleAuthPayload;
    recoveryPassword: string;
    name: string;
  }): void;
}>();

const vmProxy = getCurrentInstance()!.proxy;

const secureForm = ref<{ resetValidation: () => void } | null>(null);
const formValid = ref(false);

const name = ref(props.googleName?.trim() || generateWalletName());
const spendingPassword = ref('');
const confirmSpendingPassword = ref('');
const recoveryPassword = ref('');
const confirmRecoveryPassword = ref('');
const showSpending = ref(false);
const showRecovery = ref(false);
const creating = ref(false);
const errorMessage = ref('');

// Passkey-first: capability is probed once on mount and never re-checked mid-flow,
// so the form doesn't jump between layouts while the user is typing.
const passkeyCapable = ref(false);
const passkey = ref<{ credentialId: string; mpcPrfSaltId: string; prfOutputHex: string } | null>(null);
const enrolling = ref(false);
const passkeyError = ref('');

onMounted(async () => {
  passkeyCapable.value = await mpcPasskeyAvailable();
});

async function secureWithPasskey(): Promise<void> {
  enrolling.value = true;
  passkeyError.value = '';
  try {
    passkey.value = await enrollMpcPasskey(name.value || 'Gero Google Wallet');
  } catch (error: unknown) {
    passkeyError.value = error instanceof Error ? error.message : (vmProxy.$t('errors.unknownError') as string);
  } finally {
    enrolling.value = false;
  }
}

// The secret this step yields to its parent — either the freshly-enrolled
// passkey (PRF) material or the spending password. Threaded unchanged all the
// way to the Confirm step so it can unlock with the very same secret.
const authPayload = computed<GoogleAuthPayload>(() => (
  passkey.value
    ? { authMethod: 'passkey', ...passkey.value }
    : { authMethod: 'password', spendingPassword: spendingPassword.value }
));

const secretReady = computed(() => (
  passkeyCapable.value
    ? !!passkey.value
    : spendingPassword.value.length >= 10 && spendingPassword.value === confirmSpendingPassword.value
));

const canContinue = computed(() => formValid.value && !creating.value && secretReady.value);

const createWallet = async (): Promise<void> => {
  if (!canContinue.value) return;
  creating.value = true;
  errorMessage.value = '';
  try {
    // Prefer the Google profile picture as the wallet icon; fall back to the
    // network-colored default when there is no picture. resolveIcon renders an
    // http/data icon directly, so no other render site needs changing.
    const walletIcon = props.googlePicture || networks.resolveIconColor(props.network?.blockchain || '', props.network?.network || '');
    const payload = authPayload.value;

    // Note: never log request payload — contains idToken/spendingPassword/prfOutputHex
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.CREATE_MPC_GOOGLE_WALLET,
      data: {
        name: name.value,
        icon: walletIcon,
        theme: Theme.GERO,
        chain: props.network?.blockchain,
        network: props.network?.network,
        idToken: props.idToken,
        ...authPayloadToWireFields(payload),
      },
    }) as GoogleWalletBgResponse;

    if (!response?.data?.success || response.data.walletId == null || response.data.recoveryShare == null || response.data.publicKey == null) {
      throw new Error(response?.data?.error || (vmProxy.$t('errors.unknownError') as string));
    }

    emit('created', {
      walletId: response.data.walletId,
      recoveryShare: response.data.recoveryShare,
      publicKey: response.data.publicKey,
      authPayload: payload,
      recoveryPassword: recoveryPassword.value,
      name: name.value,
    });
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : (vmProxy.$t('errors.unknownError') as string);
  } finally {
    creating.value = false;
  }
};
</script>

<style scoped lang="scss">
.step-section-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: white;
}

.field-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  line-height: 1.4;
}

.passkey-auth-button {
  text-transform: none;
  font-weight: 500;
  border-radius: 8px !important;
  box-shadow: none !important;
}
</style>
